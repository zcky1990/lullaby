import { log } from "../../core/logger.ts";
import {
  type ChatRunRow,
  deleteChatRun,
  findLatestPendingChatRun,
  getChatRun,
  getProject,
  listPendingChatRuns,
  markInterruptedChatRuns,
  pruneChatRuns,
  upsertChatRun,
} from "../../db/db.ts";
import type { ChatChange, LlmProviderRow } from "../../db/db.ts";
import { diffLines, type DiffHunk } from "../diff.ts";
import { findRunByProject, getPendingReviewTtlMs, getRun, setRun } from "./state.ts";
import type { PendingChange, Run } from "./types.ts";

/** Status baris `chat_runs`; `review` = run selesai tapi masih ada perubahan. */
export type PersistedChatRunStatus = "running" | "review" | "interrupted";

interface PersistedPendingChange {
  callId: string;
  name: string;
  arguments: string;
  path: string;
  action: "create" | "update";
  before: string;
  after: string;
  hunks: DiffHunk[];
  added: number;
  removed: number;
  decisions: Array<[number, boolean]>;
  touched?: boolean;
}

/** Provider placeholder untuk run hasil rehidrasi (tidak dipakai saat review). */
const PERSISTED_PROVIDER: LlmProviderRow = {
  id: "persisted",
  name: "persisted",
  provider: "persisted",
  model: null,
  base_url: null,
  api_key: null,
  mode: "api",
  config: "{}",
  created_at: "",
  updated_at: "",
};

function sqliteFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function parseSqliteTime(value: string | null): number | undefined {
  if (!value) return undefined;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const ms = Date.parse(normalized.endsWith("Z") ? normalized : `${normalized}Z`);
  return Number.isFinite(ms) ? ms : undefined;
}

function isExpired(run: Run): boolean {
  return Date.now() - (run.finishedAt ?? run.createdAt) > getPendingReviewTtlMs();
}

/**
 * Hanya perubahan yang sudah diterapkan ke disk yang dipersist: itulah yang
 * perlu bisa di-revert setelah restart. Hunk mode "before" belum menyentuh disk
 * sehingga tidak berguna (dan berisiko) bila diputar ulang.
 */
export function pendingChangesForPersistence(run: Run): PersistedPendingChange[] {
  return [...run.pendingChanges.values()]
    .filter((change) => change.applied === true)
    .map((change) => ({
      callId: change.call.id,
      name: change.call.name,
      arguments: change.call.arguments,
      path: change.path,
      action: change.action,
      before: change.before,
      after: change.after,
      hunks: change.hunks,
      added: change.added,
      removed: change.removed,
      decisions: [...change.decisions.entries()],
      ...(change.touched ? { touched: true } : {}),
    }));
}

function parseDecisions(raw: unknown): Map<number, boolean> {
  const decisions = new Map<number, boolean>();
  if (!Array.isArray(raw)) return decisions;
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const index = Number(entry[0]);
    if (!Number.isInteger(index) || index < 0) continue;
    decisions.set(index, entry[1] === true);
  }
  return decisions;
}

export function parsePendingChanges(json: string): Map<string, PendingChange> {
  const pending = new Map<string, PendingChange>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    log.debug("corrupt chat_runs pending_changes JSON", { error: String(error) });
    return pending;
  }
  if (!Array.isArray(parsed)) return pending;
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Partial<PersistedPendingChange>;
    if (typeof row.callId !== "string" || typeof row.path !== "string") continue;
    if (typeof row.before !== "string" || typeof row.after !== "string") continue;
    if (!Array.isArray(row.hunks)) continue;
    pending.set(row.callId, {
      call: {
        id: row.callId,
        name: typeof row.name === "string" ? row.name : "write_file",
        arguments: typeof row.arguments === "string" ? row.arguments : "{}",
      },
      path: row.path,
      action: row.action === "create" ? "create" : "update",
      before: row.before,
      after: row.after,
      hunks: row.hunks as DiffHunk[],
      added: Number(row.added ?? 0),
      removed: Number(row.removed ?? 0),
      decisions: parseDecisions(row.decisions),
      applied: true,
      ...(row.touched ? { touched: true } : {}),
    });
  }
  return pending;
}

/**
 * Menulis snapshot run ke `chat_runs`.
 * - `running`: record dibuat saat run mulai dan diperbarui setiap kali ada
 *   perubahan yang diterapkan (agar crash di tengah run masih bisa di-revert).
 * - `review` / `interrupted`: record final; bila tidak ada perubahan applied
 *   yang tersisa, barisnya dihapus (perilaku run normal tidak berubah).
 */
export async function persistChatRun(
  run: Run,
  status: PersistedChatRunStatus,
): Promise<void> {
  try {
    const changes = pendingChangesForPersistence(run);
    if (changes.length === 0 && status !== "running") {
      await deleteChatRun(run.id);
      return;
    }
    await upsertChatRun({
      id: run.id,
      projectId: run.projectId,
      sessionId: run.sessionId,
      status,
      pendingChanges: JSON.stringify(changes),
      finishedAt: status === "running"
        ? null
        : sqliteFromMs(run.finishedAt ?? Date.now()),
    });
  } catch (error) {
    log.warn("chat run persistence skipped", { runId: run.id, error: String(error) });
  }
}

export async function persistChatRunSettled(runId: string): Promise<void> {
  try {
    await deleteChatRun(runId);
  } catch (error) {
    log.warn("chat run cleanup skipped", { runId, error: String(error) });
  }
}

async function hydrateRow(row: ChatRunRow): Promise<Run | undefined> {
  const cached = getRun(row.id);
  if (cached) return cached;
  const pending = parsePendingChanges(row.pending_changes);
  if (pending.size === 0) return undefined;
  const project = await getProject(row.project_id);
  const createdAt = parseSqliteTime(row.created_at) ?? Date.now();
  const changes: ChatChange[] = [];
  for (const change of pending.values()) {
    const diff = diffLines(change.before, change.after);
    changes.push({
      path: change.path,
      action: change.action,
      diff: diff.diff,
      added: diff.added,
      removed: diff.removed,
    });
  }
  const run: Run = {
    id: row.id,
    provider: PERSISTED_PROVIDER,
    workspace: project?.workspace_path ?? null,
    sessionId: row.session_id,
    turns: [],
    pendingBatch: [],
    pendingChanges: pending,
    batchResults: new Map(),
    changes,
    projectId: row.project_id,
    mode: "build",
    skills: new Map(),
    mcpTools: new Map(),
    createdTickets: [],
    createdAt,
    finishedAt: parseSqliteTime(row.finished_at) ?? createdAt,
    interrupted: row.status === "interrupted",
  };
  if (isExpired(run)) {
    await deleteChatRun(row.id);
    return undefined;
  }
  setRun(run);
  return run;
}

/** Rehidrasi satu run (dipakai juga oleh API Review sebagai fallback). */
export async function hydrateChatRun(runId: string): Promise<Run | undefined> {
  const cached = getRun(runId);
  if (cached) return cached;
  const row = await getChatRun(runId);
  if (!row) return undefined;
  return await hydrateRow(row);
}

/** Run review terbaru milik project (memory dulu, lalu `chat_runs`). */
export async function hydrateLatestChatRun(projectId: string): Promise<Run | undefined> {
  const active = findRunByProject(projectId);
  if (active && active.pendingChanges.size > 0) return active;
  const row = await findLatestPendingChatRun(projectId);
  if (!row) return active;
  return (await hydrateRow(row)) ?? active;
}

/**
 * Bootstrap: tandai run yang masih `running` sebagai `interrupted` (pola
 * `workflow_runs`), buang record kedaluwarsa, lalu muat ulang run yang masih
 * punya perubahan untuk di-review. Mengembalikan jumlah run yang dipulihkan.
 */
export async function rehydrateChatRuns(): Promise<number> {
  await markInterruptedChatRuns();
  const keepHours = Math.max(1, Math.ceil(getPendingReviewTtlMs() / 3_600_000));
  await pruneChatRuns(keepHours);
  const rows = await listPendingChatRuns();
  let restored = 0;
  for (const row of rows) {
    const run = await hydrateRow(row);
    if (!run) continue;
    restored++;
  }
  return restored;
}
