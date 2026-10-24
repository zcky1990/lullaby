import type { ChatChange } from "../../db/db.ts";
import { readWorkspaceFile, writeWorkspaceFile } from "../../fs/workspace.ts";
import { applyHunks, diffHunks, diffLines } from "../diff.ts";
import { safeParse } from "./llm.ts";
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

function serializePendingChanges(run: Run): PendingFileChange[] {
  return [...run.pendingChanges.values()].map((change) => ({
    callId: change.call.id,
    path: change.path,
    action: change.action,
    added: change.added,
    removed: change.removed,
    hunks: change.hunks.map((hunk, index) => ({
      ...hunk,
      decision: change.decisions.has(index)
        ? (change.decisions.get(index) ? "accepted" : "rejected")
        : "pending",
    })),
  }));
}

export function approvalResponse(run: Run): ChatResponse {
  const changes = serializePendingChanges(run);
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

async function settle(run: Run): Promise<ChatResponse> {
  for (const change of [...run.pendingChanges.values()]) {
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

  if (run.pendingChanges.size > 0) return approvalResponse(run);

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

export async function decideChatChange(
  runId: string,
  callId: string,
  hunk: number,
  accept: boolean,
): Promise<ChatResponse> {
  pruneRuns();
  const run = getRun(runId);
  if (!run) return { status: "error", error: "run_not_found" };
  const change = run.pendingChanges.get(callId);
  if (!change) return { status: "error", error: "change_not_found" };
  if (hunk < 0 || hunk >= change.hunks.length) {
    return { status: "error", error: "hunk_not_found" };
  }
  change.decisions.set(hunk, accept);
  return await settle(run);
}

export async function decideAllChatChanges(
  runId: string,
  accept: boolean,
): Promise<ChatResponse> {
  pruneRuns();
  const run = getRun(runId);
  if (!run) return { status: "error", error: "run_not_found" };
  if (run.pendingChanges.size === 0) return { status: "error", error: "change_not_found" };
  for (const change of run.pendingChanges.values()) {
    for (let index = 0; index < change.hunks.length; index++) {
      change.decisions.set(index, accept);
    }
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
