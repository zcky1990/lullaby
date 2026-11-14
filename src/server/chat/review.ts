import type { ChatChange } from "../../db/db.ts";
import { readWorkspaceFile, removeWorkspaceFile, writeWorkspaceFile } from "../../fs/workspace.ts";
import { applyHunks, diffHunks, diffLines } from "../diff.ts";
import { safeParse } from "./llm.ts";
import { scheduleSkillLearn } from "./skill-learn.ts";
import { deleteRun, getRun, pruneRuns, setRun } from "./state.ts";
import type { ChatResponse, PendingChange, PendingFileChange, Run, ToolCall } from "./types.ts";

type AdvanceFn = (run: Run) => Promise<ChatResponse>;

let advanceFn: AdvanceFn | null = null;

export function setAdvance(fn: AdvanceFn): void {
  advanceFn = fn;
}

export async function prepareWriteChange(
  run: Run,
  call: ToolCall,
): Promise<{ change?: PendingChange; result: string }> {
  if (!run.workspace) return { result: "No workspace configured." };
  const args = safeParse(call.arguments);
  const path = typeof args.path === "string" ? args.path : "";
  const after = String(args.content ?? "");

  let before = "";
  let exists = false;
  try {
    const file = await readWorkspaceFile(run.workspace, path);
    exists = true;
    before = file.binary ? "" : file.content;
  } catch {
    exists = false;
  }

  const result = diffHunks(before, after);
  if (result.hunks.length === 0) return { result: "Tidak ada perubahan." };
  return {
    change: {
      call,
      path,
      action: exists ? "update" : "create",
      before,
      after,
      hunks: result.hunks,
      added: result.added,
      removed: result.removed,
      decisions: new Map(),
    },
    result: "",
  };
}

export function pendingChangesPayload(run: Run): PendingFileChange[] {
  return [...run.pendingChanges.values()].map((change) => ({
    callId: change.call.id,
    path: change.path,
    action: change.action,
    added: change.added,
    removed: change.removed,
    ...(change.applied ? { applied: true } : {}),
    hunks: change.hunks.map((hunk, index) => ({
      ...hunk,
      decision: change.decisions.has(index)
        ? (change.decisions.get(index) ? "accepted" : "rejected")
        : "pending",
    })),
  }));
}

export function approvalResponse(run: Run): ChatResponse {
  const changes = pendingChangesPayload(run);
  return {
    status: "approval_required",
    runId: run.id,
    sessionId: run.sessionId,
    changes: run.changes,
    createdTickets: run.createdTickets,
    pendingChanges: changes,
    pending: changes.map((change) => ({
      id: change.callId,
      tool: "write_file",
      summary: `write_file(${change.path})`,
    })),
  };
}

function updateChangeEntry(
  run: Run,
  path: string,
  action: "create" | "update",
  before: string,
  content: string,
): void {
  const diff = diffLines(before, content);
  const index = run.changes.findIndex((item) => item.path === path);
  if (diff.added === 0 && diff.removed === 0) {
    if (index >= 0) run.changes.splice(index, 1);
    return;
  }
  const entry: ChatChange = {
    path,
    action,
    diff: diff.diff,
    added: diff.added,
    removed: diff.removed,
  };
  if (index >= 0) run.changes[index] = entry;
  else run.changes.push(entry);
}

/**
 * Record a write that was already applied to disk.
 * When `deferReview` is set the change stays queued so the user can review it
 * after the run finishes (reject = revert that hunk).
 */
export function recordAppliedWrite(
  run: Run,
  change: PendingChange,
  deferReview: boolean,
): void {
  const previous = deferReview
    ? [...run.pendingChanges.values()].find((item) => item.path === change.path)
    : undefined;
  if (previous) run.pendingChanges.delete(previous.call.id);
  const before = previous?.before ?? change.before;
  const action = previous?.action ?? change.action;
  updateChangeEntry(run, change.path, action, before, change.after);
  if (!deferReview) return;

  const result = diffHunks(before, change.after);
  if (result.hunks.length === 0) return;

  const decisions = new Map<number, boolean>();
  result.hunks.forEach((_, index) => decisions.set(index, true));
  change.before = before;
  change.action = action;
  change.hunks = result.hunks;
  change.added = result.added;
  change.removed = result.removed;
  change.decisions = decisions;
  change.applied = true;
  change.touched = false;
  run.pendingChanges.set(change.call.id, change);
}

/** Final response for a finished run that still has review items to settle. */
export function deferredReviewResponse(run: Run, message: string): ChatResponse {
  return {
    status: "done",
    message,
    sessionId: run.sessionId,
    changes: run.changes,
    createdTickets: run.createdTickets,
    runId: run.id,
    pendingChanges: pendingChangesPayload(run),
    reviewDeferred: true,
  };
}

async function settleAppliedChange(run: Run, change: PendingChange): Promise<string> {
  if (!run.workspace) return "No workspace configured.";
  const accepted = new Set(
    [...change.decisions.entries()].filter(([, value]) => value).map(([index]) => index),
  );
  const content = applyHunks(
    change.before,
    change.hunks,
    accepted,
    change.after.endsWith("\n"),
  );
  if (content === change.after) return "";

  let current: string | null = null;
  try {
    current = (await readWorkspaceFile(run.workspace, change.path)).content;
  } catch {
    current = null;
  }
  if (current !== change.after) {
    return `Revert ${change.path} dilewati: file sudah berubah setelah perubahan AI.`;
  }

  try {
    if (change.action === "create" && content.length === 0) {
      await removeWorkspaceFile(run.workspace, change.path);
      updateChangeEntry(run, change.path, change.action, change.before, content);
      return `Revert ${change.path}: file baru dihapus.`;
    }
    await writeWorkspaceFile(run.workspace, change.path, content);
    updateChangeEntry(run, change.path, change.action, change.before, content);
    if (accepted.size === 0) {
      return `Revert ${change.path}: kembali ke versi sebelum chat.`;
    }
    const reverted = change.hunks.length - accepted.size;
    return `Revert sebagian ${change.path}: ${reverted} hunk dikembalikan.`;
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

async function settle(run: Run): Promise<ChatResponse> {
  const notes: string[] = [];

  for (const change of [...run.pendingChanges.values()]) {
    if (change.applied) {
      if (!change.touched) continue;
      if (change.decisions.size < change.hunks.length) continue;
      const note = await settleAppliedChange(run, change);
      if (note) notes.push(note);
      run.pendingChanges.delete(change.call.id);
      continue;
    }
    if (change.decisions.size < change.hunks.length) continue;
    const accepted = new Set(
      [...change.decisions.entries()].filter(([, value]) => value).map(([index]) => index),
    );
    let result: string;
    if (accepted.size === 0) {
      result = `Semua perubahan ${change.path} ditolak.`;
    } else if (!run.workspace) {
      result = "No workspace configured.";
    } else {
      try {
        const content = applyHunks(
          change.before,
          change.hunks,
          accepted,
          change.after.endsWith("\n"),
        );
        await writeWorkspaceFile(run.workspace, change.path, content);
        const diff = diffLines(change.before, content);
        const applied: ChatChange = {
          path: change.path,
          action: change.action,
          diff: diff.diff,
          added: diff.added,
          removed: diff.removed,
        };
        const index = run.changes.findIndex((item) => item.path === change.path);
        if (index >= 0) run.changes[index] = applied;
        else run.changes.push(applied);
        result = `Wrote ${change.path} (${accepted.size}/${change.hunks.length} hunks, ` +
          `+${diff.added}/-${diff.removed})`;
      } catch (error) {
        result = `Error: ${(error as Error).message}`;
      }
    }
    run.batchResults.set(change.call.id, result);
    run.pendingChanges.delete(change.call.id);
  }

  const message = notes.join("\n");

  if (run.pendingChanges.size > 0) {
    if (run.finishedAt) return deferredReviewResponse(run, message);
    return approvalResponse(run);
  }

  if (run.finishedAt) {
    deleteRun(run.id);
    return {
      status: "done",
      message,
      sessionId: run.sessionId,
      changes: run.changes,
      createdTickets: run.createdTickets,
    };
  }

  for (const call of run.pendingBatch) {
    run.turns.push({
      role: "tool",
      toolCallId: call.id,
      content: run.batchResults.get(call.id) ?? "Tidak dijalankan.",
    });
  }
  run.pendingBatch = [];
  run.batchResults.clear();
  if (run.provider.id === "test" || !run.turns.some((turn) => turn.role !== "tool")) {
    scheduleSkillLearn(run);
    deleteRun(run.id);
    return {
      status: "done",
      message: "Perubahan diterapkan.",
      sessionId: run.sessionId,
      changes: run.changes,
      createdTickets: run.createdTickets,
    };
  }
  if (!advanceFn) throw new Error("advance not registered");
  return await advanceFn(run);
}

function reviewMissingError(
  code: "run_not_found" | "change_not_found" | "hunk_not_found",
): ChatResponse {
  const messages: Record<typeof code, string> = {
    run_not_found: "Sesi review sudah tidak tersedia (habis waktu atau app di-restart). " +
      "Perubahan di disk tetap ada; buka file di Explorer bila perlu dicek manual.",
    change_not_found: "Perubahan ini sudah tidak ada di antrean review.",
    hunk_not_found: "Hunk tidak ditemukan.",
  };
  return { status: "error", error: messages[code] };
}

export async function decideChatChange(
  runId: string,
  callId: string,
  hunk: number,
  accept: boolean,
): Promise<ChatResponse> {
  pruneRuns();
  const run = getRun(runId);
  if (!run) return reviewMissingError("run_not_found");
  const change = run.pendingChanges.get(callId);
  if (!change) return reviewMissingError("change_not_found");
  if (hunk < 0 || hunk >= change.hunks.length) {
    return reviewMissingError("hunk_not_found");
  }
  change.decisions.set(hunk, accept);
  change.touched = true;
  return await settle(run);
}

export async function decideAllChatChanges(
  runId: string,
  accept: boolean,
): Promise<ChatResponse> {
  pruneRuns();
  const run = getRun(runId);
  if (!run) return reviewMissingError("run_not_found");
  if (run.pendingChanges.size === 0) return reviewMissingError("change_not_found");
  for (const change of run.pendingChanges.values()) {
    for (let index = 0; index < change.hunks.length; index++) {
      change.decisions.set(index, accept);
    }
    change.touched = true;
  }
  return await settle(run);
}

/** Seeds a pending write review for unit tests (no LLM). */
export async function seedPendingWriteForTest(opts: {
  workspace: string;
  path: string;
  before: string;
  after: string;
}): Promise<{ runId: string; callId: string; hunkCount: number }> {
  pruneRuns();
  await Deno.mkdir(opts.workspace, { recursive: true });
  const abs = `${opts.workspace}/${opts.path}`;
  const parent = abs.includes("/") ? abs.slice(0, abs.lastIndexOf("/")) : opts.workspace;
  await Deno.mkdir(parent, { recursive: true });
  if (opts.before.length > 0) await Deno.writeTextFile(abs, opts.before);
  else {
    try {
      await Deno.remove(abs);
    } catch {
      // ignore
    }
  }

  const call: ToolCall = {
    id: crypto.randomUUID(),
    name: "write_file",
    arguments: JSON.stringify({ path: opts.path, content: opts.after }),
  };
  const run: Run = {
    id: crypto.randomUUID(),
    provider: {
      id: "test",
      name: "test",
      provider: "openai",
      model: null,
      base_url: null,
      api_key: null,
      mode: "api",
      config: "{}",
      created_at: "",
      updated_at: "",
    },
    workspace: opts.workspace,
    sessionId: "test-session",
    turns: [],
    pendingBatch: [call],
    pendingChanges: new Map(),
    batchResults: new Map(),
    changes: [],
    projectId: "test-project",
    mode: "build",
    skills: new Map(),
    mcpTools: new Map(),
    createdTickets: [],
    createdAt: Date.now(),
  };
  const prepared = await prepareWriteChange(run, call);
  if (!prepared.change) throw new Error(prepared.result || "no_change");
  run.pendingChanges.set(call.id, prepared.change);
  setRun(run);
  return {
    runId: run.id,
    callId: call.id,
    hunkCount: prepared.change.hunks.length,
  };
}
