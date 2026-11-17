import { equal } from "node:assert/strict";
import { join } from "node:path";
import type { LlmProviderRow } from "../src/db/db.ts";
import type { Run } from "../src/server/chat/types.ts";

const dataDir = await Deno.makeTempDir();
Deno.env.set("RND_APP_DATA_DIR", dataDir);

const db = await import("../src/db/db.ts");
db.closeDb();
const { closeDb, createProject, getChatRun, listPendingChatRuns } = db;
const { decideAllChatChanges, prepareWriteChange, recordAppliedWrite } = await import(
  "../src/server/chat/review.ts"
);
const { hydrateChatRun, parsePendingChanges, persistChatRun, rehydrateChatRuns } = await import(
  "../src/server/chat/persist.ts"
);
const { deleteRun, getRun, setRun } = await import("../src/server/chat/state.ts");
const { writeWorkspaceFile } = await import("../src/fs/workspace.ts");

const PROVIDER: LlmProviderRow = {
  id: "persist-test",
  name: "persist-test",
  provider: "openai",
  model: null,
  base_url: null,
  api_key: null,
  mode: "api",
  config: "{}",
  created_at: "",
  updated_at: "",
};

function makeRun(projectId: string, workspace: string): Run {
  return {
    id: crypto.randomUUID(),
    provider: PROVIDER,
    workspace,
    sessionId: "persist-session",
    turns: [],
    pendingBatch: [],
    pendingChanges: new Map(),
    batchResults: new Map(),
    changes: [],
    projectId,
    mode: "build",
    skills: new Map(),
    mcpTools: new Map(),
    createdTickets: [],
    createdAt: Date.now(),
  };
}

async function makeProject(workspacePath: string): Promise<string> {
  const project = await createProject({
    id: crypto.randomUUID(),
    name: "Chat Run Persist",
    workspacePath,
  });
  return project.id;
}

async function applyDeferredWrite(run: Run, path: string, after: string): Promise<void> {
  const workspace = run.workspace;
  if (!workspace) throw new Error("workspace required");
  const call = {
    id: crypto.randomUUID(),
    name: "write_file",
    arguments: JSON.stringify({ path, content: after }),
  };
  const prepared = await prepareWriteChange(run, call);
  if (!prepared.change) throw new Error(prepared.result || "no_change");
  await writeWorkspaceFile(workspace, path, after);
  await recordAppliedWrite(run, prepared.change, true);
}

Deno.test("chat_runs: review mode `end` tetap bisa di-revert setelah restart", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(root, "note.txt"), "alpha\nbeta\n");
    const projectId = await makeProject(root);
    const run = makeRun(projectId, root);
    setRun(run);
    await persistChatRun(run, "running");
    await applyDeferredWrite(run, "note.txt", "alpha\ngamma\n");
    run.finishedAt = Date.now();
    await persistChatRun(run, "review");

    const stored = await getChatRun(run.id);
    equal(stored?.status, "review");
    equal(parsePendingChanges(stored?.pending_changes ?? "[]").size, 1);

    // Simulasi restart: memory hilang, record tetap ada di `chat_runs`.
    deleteRun(run.id);
    equal(getRun(run.id), undefined);
    equal((await listPendingChatRuns()).some((row) => row.id === run.id), true);

    await rehydrateChatRuns();
    const hydrated = getRun(run.id);
    equal(hydrated?.pendingChanges.size, 1);
    equal(hydrated?.interrupted, false);
    equal(hydrated?.changes.length, 1);

    const response = await decideAllChatChanges(run.id, false);
    equal(response.status, "done");
    equal(await Deno.readTextFile(join(root, "note.txt")), "alpha\nbeta\n");
    equal(await getChatRun(run.id), null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("chat_runs: run terputus ditandai interrupted dan bisa di-Keep", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(root, "app.ts"), "export const a = 1;\n");
    const projectId = await makeProject(root);
    const run = makeRun(projectId, root);
    setRun(run);
    await persistChatRun(run, "running");
    await applyDeferredWrite(run, "app.ts", "export const a = 2;\n");

    // App mati sebelum run selesai (tidak pernah `review`/`finish`).
    deleteRun(run.id);
    await rehydrateChatRuns();

    const stored = await getChatRun(run.id);
    equal(stored?.status, "interrupted");
    const hydrated = getRun(run.id);
    equal(hydrated?.interrupted, true);
    equal(hydrated?.pendingChanges.size, 1);

    const response = await decideAllChatChanges(run.id, true);
    equal(response.status, "done");
    equal(await Deno.readTextFile(join(root, "app.ts")), "export const a = 2;\n");
    equal(await getChatRun(run.id), null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("chat_runs: run selesai normal tidak meninggalkan record", async () => {
  const projectId = await makeProject("");
  const run = makeRun(projectId, "");
  setRun(run);
  await persistChatRun(run, "running");
  equal((await getChatRun(run.id))?.status, "running");

  run.finishedAt = Date.now();
  await persistChatRun(run, "review");
  equal(await getChatRun(run.id), null);
  deleteRun(run.id);
});

Deno.test("chat_runs: hunk mode `before` (belum applied) tidak dipersist", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(root, "x.txt"), "one\n");
    const projectId = await makeProject(root);
    const run = makeRun(projectId, root);
    setRun(run);
    await persistChatRun(run, "running");

    const call = {
      id: crypto.randomUUID(),
      name: "write_file",
      arguments: JSON.stringify({ path: "x.txt", content: "two\n" }),
    };
    const prepared = await prepareWriteChange(run, call);
    if (!prepared.change) throw new Error("no_change");
    run.pendingChanges.set(call.id, prepared.change);
    await persistChatRun(run, "running");

    const stored = await getChatRun(run.id);
    equal(parsePendingChanges(stored?.pending_changes ?? "[]").size, 0);

    run.finishedAt = Date.now();
    await persistChatRun(run, "review");
    equal(await getChatRun(run.id), null);
    deleteRun(run.id);
    equal(await Deno.readTextFile(join(root, "x.txt")), "one\n");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("chat_runs: hydrateChatRun memulihkan run tanpa bootstrap", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(root, "lazy.txt"), "v0\n");
    const projectId = await makeProject(root);
    const run = makeRun(projectId, root);
    setRun(run);
    await persistChatRun(run, "running");
    await applyDeferredWrite(run, "lazy.txt", "v1\n");
    run.finishedAt = Date.now();
    await persistChatRun(run, "review");
    deleteRun(run.id);

    const hydrated = await hydrateChatRun(run.id);
    equal(hydrated?.id, run.id);
    equal(hydrated?.workspace, root);
    const response = await decideAllChatChanges(run.id, false);
    equal(response.status, "done");
    equal(await Deno.readTextFile(join(root, "lazy.txt")), "v0\n");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test({
  name: "chat_runs: cleanup temp data dir",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    closeDb();
    Deno.env.delete("RND_APP_DATA_DIR");
    await Deno.remove(dataDir, { recursive: true });
  },
});
