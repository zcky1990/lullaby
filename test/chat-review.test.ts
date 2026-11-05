import { deepEqual, equal, notEqual } from "node:assert/strict";
import { join } from "node:path";
import type { LlmProviderRow } from "../src/db/db.ts";
import { writeWorkspaceFile } from "../src/fs/workspace.ts";
import {
  decideAllChatChanges,
  decideChatChange,
  pendingChangesPayload,
  prepareWriteChange,
  recordAppliedWrite,
} from "../src/server/chat/review.ts";
import { getRun, setRun } from "../src/server/chat/state.ts";
import type { PendingChange, Run, ToolCall } from "../src/server/chat/types.ts";

const PROVIDER: LlmProviderRow = {
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
};

function makeRun(workspace: string): Run {
  return {
    id: crypto.randomUUID(),
    provider: PROVIDER,
    workspace,
    sessionId: "review-test-session",
    turns: [],
    pendingBatch: [],
    pendingChanges: new Map(),
    batchResults: new Map(),
    changes: [],
    projectId: "review-test-project",
    mode: "build",
    skills: new Map(),
    mcpTools: new Map(),
    createdTickets: [],
    createdAt: Date.now(),
    finishedAt: Date.now(),
  };
}

async function applyDeferredWrite(
  run: Run,
  path: string,
  after: string,
): Promise<PendingChange> {
  const workspace = run.workspace;
  if (!workspace) throw new Error("workspace required");
  const call: ToolCall = {
    id: crypto.randomUUID(),
    name: "write_file",
    arguments: JSON.stringify({ path, content: after }),
  };
  const prepared = await prepareWriteChange(run, call);
  if (!prepared.change) throw new Error(prepared.result || "no_change");
  await writeWorkspaceFile(workspace, path, after);
  recordAppliedWrite(run, prepared.change, true);
  return prepared.change;
}

Deno.test("deferred review: revert all restores files and clears the run", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(root, "note.txt"), "alpha\nbeta\n");
    const run = makeRun(root);
    setRun(run);
    const change = await applyDeferredWrite(run, "note.txt", "alpha\ngamma\n");

    const payload = pendingChangesPayload(run);
    equal(payload.length, 1);
    equal(payload[0].applied, true);
    equal(payload[0].path, "note.txt");
    equal(payload[0].hunks.every((hunk) => hunk.decision === "accepted"), true);

    const response = await decideAllChatChanges(run.id, false);
    equal(response.status, "done");
    equal(await Deno.readTextFile(join(root, "note.txt")), "alpha\nbeta\n");
    equal(run.pendingChanges.size, 0);
    equal(run.changes.length, 0);
    equal(getRun(run.id), undefined);
    equal("pendingChanges" in response, false);
    equal(change.path, "note.txt");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("deferred review: rejecting one hunk keeps the rest applied", async () => {
  const root = await Deno.makeTempDir();
  try {
    const before = `${Array.from({ length: 20 }, (_, index) => `line${index + 1}`).join("\n")}\n`;
    await Deno.writeTextFile(join(root, "big.txt"), before);
    const run = makeRun(root);
    setRun(run);
    const after = before.replace("line1", "LINE1").replace("line20", "LINE20");
    const change = await applyDeferredWrite(run, "big.txt", after);
    equal(change.hunks.length >= 2, true);

    const response = await decideChatChange(run.id, change.call.id, 0, false);
    equal(response.status, "done");
    const content = await Deno.readTextFile(join(root, "big.txt"));
    equal(content.includes("line1"), true);
    equal(content.includes("LINE1"), false);
    equal(content.includes("LINE20"), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("deferred review: untouched files stay queued for review", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(root, "a.txt"), "a\n");
    await Deno.writeTextFile(join(root, "b.txt"), "b\n");
    const run = makeRun(root);
    setRun(run);
    const a = await applyDeferredWrite(run, "a.txt", "A\n");
    await applyDeferredWrite(run, "b.txt", "B\n");
    equal(run.pendingChanges.size, 2);

    const response = await decideChatChange(run.id, a.call.id, 0, false);
    equal(response.status, "done");
    const pending = "pendingChanges" in response ? response.pendingChanges ?? [] : [];
    deepEqual(pending.map((item) => item.path), ["b.txt"]);
    equal("reviewDeferred" in response ? response.reviewDeferred : false, true);
    equal(await Deno.readTextFile(join(root, "a.txt")), "a\n");
    equal(await Deno.readTextFile(join(root, "b.txt")), "B\n");
    notEqual(getRun(run.id), undefined);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("deferred review: revert is skipped when the file changed afterwards", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(root, "note.txt"), "alpha\n");
    const run = makeRun(root);
    setRun(run);
    const change = await applyDeferredWrite(run, "note.txt", "alpha\nbeta\n");
    await Deno.writeTextFile(join(root, "note.txt"), "manual edit\n");

    const response = await decideAllChatChanges(run.id, false);
    equal(response.status, "done");
    equal(response.status === "done" ? response.message.includes("dilewati") : false, true);
    equal(await Deno.readTextFile(join(root, "note.txt")), "manual edit\n");
    equal(run.pendingChanges.size, 0);
    equal(change.applied, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("deferred review: repeated writes to one path produce one cumulative review", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(root, "note.md"), "v0\n");
    const run = makeRun(root);
    setRun(run);
    await applyDeferredWrite(run, "note.md", "v1\n");
    await applyDeferredWrite(run, "note.md", "v2\n");

    equal(run.pendingChanges.size, 1);
    const payload = pendingChangesPayload(run);
    equal(payload.length, 1);
    equal(payload[0].added >= 1, true);

    await decideAllChatChanges(run.id, false);
    equal(await Deno.readTextFile(join(root, "note.md")), "v0\n");
    equal(run.changes.length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
