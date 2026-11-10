import { deepEqual, equal } from "node:assert/strict";
import { join } from "node:path";
import {
  bootstrapCursorPrompt,
  collectCursorWrites,
  conversationFromSdkTurns,
  type CursorStreamEvent,
  isCloudCursorAgentId,
  latestUserPrompt,
  mapCursorDelta,
  revertWorkspaceToSnapshot,
  sendCursorPrompt,
  snapshotWorkspaceFiles,
} from "../src/server/chat/cursor.ts";
import { ChatInput } from "../src/config/schema.ts";
import {
  createChatSession,
  createLlmProvider,
  createProject,
  findChatSessionByCursorAgentId,
  getDb,
  getLlmProvider,
  upsertImportedCursorSession,
} from "../src/db/db.ts";
import { cursorModelsAreFresh, storeCursorModels } from "../src/server/chat/cursor-models.ts";
import {
  CursorPhaseTimeoutError,
  isCursorCancellation,
  rewriteCursorTransportError,
  runCursorPhase,
} from "../src/server/chat/cursor-sdk.ts";
import { serializeLlm } from "../src/server/serializers.ts";
import type { ChatTurn } from "../src/server/chat/types.ts";

const workspace = await Deno.makeTempDir();
const temp = await Deno.makeTempDir();

await Deno.mkdir(join(workspace, "src"), { recursive: true });
await Deno.writeTextFile(join(workspace, "src", "a.ts"), "export const a = 1;\n");
await Deno.writeTextFile(join(workspace, "src", "same.ts"), "export const same = 1;\n");
await Deno.writeFile(join(workspace, "big.bin"), new Uint8Array([0, 1, 2, 3]));

await Deno.mkdir(join(temp, "src"), { recursive: true });
await Deno.writeTextFile(join(temp, "src", "a.ts"), "export const a = 2;\n");
await Deno.writeTextFile(join(temp, "src", "same.ts"), "export const same = 1;\n");
await Deno.writeTextFile(join(temp, "src", "new.ts"), "export const created = true;\n");
await Deno.writeFile(join(temp, "big.bin"), new Uint8Array([0, 9, 9, 9]));
await Deno.mkdir(join(temp, ".cursor"), { recursive: true });
await Deno.writeTextFile(join(temp, ".cursor", "state.json"), "{}");

Deno.test("collectCursorWrites returns changed and new text files only", async () => {
  const result = await collectCursorWrites(temp, workspace);
  deepEqual(result.writes.map((write) => write.path).sort(), ["src/a.ts", "src/new.ts"]);
  equal(result.writes.find((write) => write.path === "src/a.ts")?.content, "export const a = 2;\n");
  equal(result.notes.some((note) => note.includes("biner")), true);
});

Deno.test("snapshot + collect + revert restores real cwd workspace", async () => {
  const live = await Deno.makeTempDir();
  await Deno.mkdir(join(live, "src"), { recursive: true });
  await Deno.writeTextFile(join(live, "src", "a.ts"), "export const a = 1;\n");
  await Deno.writeTextFile(join(live, "keep.ts"), "keep\n");
  const snap = await snapshotWorkspaceFiles(live);
  await Deno.writeTextFile(join(live, "src", "a.ts"), "export const a = 2;\n");
  await Deno.writeTextFile(join(live, "src", "new.ts"), "created\n");
  await Deno.remove(join(live, "keep.ts"));
  const diff = await collectCursorWrites(live, snap);
  deepEqual(diff.writes.map((write) => write.path).sort(), ["src/a.ts", "src/new.ts"]);
  await revertWorkspaceToSnapshot(live, snap);
  equal(await Deno.readTextFile(join(live, "src", "a.ts")), "export const a = 1;\n");
  equal(await Deno.readTextFile(join(live, "keep.ts")), "keep\n");
  let missing = false;
  try {
    await Deno.stat(join(live, "src", "new.ts"));
  } catch {
    missing = true;
  }
  equal(missing, true);
  await Deno.remove(live, { recursive: true });
});

Deno.test("isCloudCursorAgentId detects bc- prefix", () => {
  equal(isCloudCursorAgentId("bc-abc123"), true);
  equal(isCloudCursorAgentId("BC-xyz"), true);
  equal(isCloudCursorAgentId("agent-local-1"), false);
  equal(isCloudCursorAgentId(""), false);
});

Deno.test("collectCursorWrites cleanup", async () => {
  await Deno.remove(workspace, { recursive: true });
  await Deno.remove(temp, { recursive: true });
});

Deno.test("latestUserPrompt uses only the latest user turn", () => {
  const turns: ChatTurn[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "first" },
    { role: "assistant", content: "ack" },
    { role: "user", content: "second" },
  ];
  equal(latestUserPrompt(turns), "second");
  equal(bootstrapCursorPrompt(turns).includes("second"), true);
  equal(bootstrapCursorPrompt(turns).includes("first"), false);
});

Deno.test("conversationFromSdkTurns maps assistant text steps", () => {
  const mapped = conversationFromSdkTurns([
    {
      type: "agentConversationTurn",
      turn: {
        userMessage: { text: "hi" },
        steps: [
          { type: "toolCall", message: { name: "read" } },
          { type: "assistantMessage", message: { text: "done" } },
        ],
      },
    },
  ]);
  deepEqual(mapped, [
    { role: "user", content: "hi" },
    { role: "assistant", content: "done" },
  ]);
});

Deno.test("upsertImportedCursorSession dedupes by cursor_agent_id", async () => {
  await getDb();
  const project = await createProject({
    id: crypto.randomUUID(),
    name: `cursor-import-${crypto.randomUUID().slice(0, 8)}`,
  });
  const agentId = `agent-${crypto.randomUUID()}`;
  const first = await upsertImportedCursorSession({
    projectId: project.id,
    cursorAgentId: agentId,
    title: "One",
    updatedAtMs: 1_700_000_000_000,
  });
  const second = await upsertImportedCursorSession({
    projectId: project.id,
    cursorAgentId: agentId,
    title: "Two",
    updatedAtMs: 1_700_000_100_000,
  });
  equal(first.id, second.id);
  equal(second.title, "Two");
  equal(second.source, "cursor");
  const found = await findChatSessionByCursorAgentId(project.id, agentId);
  equal(found?.id, first.id);
  const appSession = await createChatSession(project.id, "App chat");
  equal(appSession.source, "app");
  equal(appSession.cursor_agent_id, null);
});

Deno.test("serializeLlm exposes stored Cursor models", () => {
  const provider = serializeLlm({
    id: "p1",
    name: "Cursor",
    provider: "cursor",
    model: "composer-2",
    base_url: null,
    api_key: "secret",
    config: JSON.stringify({
      cursorModels: [{ id: "composer-2", name: "Composer 2" }],
    }),
    mode: "api",
    updated_at: "2026-01-01",
  });
  deepEqual(provider.models, [{ id: "composer-2", name: "Composer 2" }]);
});

Deno.test("storeCursorModels persists catalog on provider config", async () => {
  await getDb();
  const provider = await createLlmProvider({
    id: crypto.randomUUID(),
    name: "Cursor Store",
    provider: "cursor",
    model: "composer-2",
    apiKey: "test-key",
    mode: "api",
  });
  await storeCursorModels(provider.id, [
    { id: "composer-2", name: "Composer 2" },
    { id: "gpt-5", name: "GPT-5" },
  ]);
  const stored = await getLlmProvider(provider.id);
  const serialized = serializeLlm(stored!);
  deepEqual(serialized.models, [
    { id: "composer-2", name: "Composer 2" },
    { id: "gpt-5", name: "GPT-5" },
  ]);
  const config = JSON.parse(stored!.config || "{}") as { cursorModelsUpdatedAt?: string };
  equal(typeof config.cursorModelsUpdatedAt, "string");
});

Deno.test("rewriteCursorTransportError explains Deno fetch streaming limit", () => {
  const rewritten = rewriteCursorTransportError(
    new Error("[unknown] The fetch API does not support streaming request bodies"),
  );
  equal(rewritten.message.includes("HTTP/2"), true);
  equal(rewritten.message.includes("bc-"), true);
});

Deno.test("rewriteCursorTransportError keeps phase timeout messages intact", () => {
  const timeout = new CursorPhaseTimeoutError("Cursor send timeout setelah 180 detik");
  equal(rewriteCursorTransportError(timeout), timeout);
});

Deno.test("sendCursorPrompt passes mode and onDelta as send options, not in the message", async () => {
  const calls: Array<{ message: unknown; options: unknown }> = [];
  const agent = {
    send: (message: unknown, options?: unknown) => {
      calls.push({ message, options });
      return Promise.resolve("run");
    },
  };
  const events: CursorStreamEvent[] = [];
  const run = await sendCursorPrompt(agent, {
    text: "hello",
    images: [{ data: "AAAA", mimeType: "image/png" }],
    mode: "plan",
    onEvent: (event) => events.push(event),
  });

  equal(run, "run");
  equal(calls.length, 1);
  deepEqual(calls[0].message, {
    text: "hello",
    images: [{ data: "AAAA", mimeType: "image/png" }],
  });
  const options = calls[0].options as {
    mode?: string;
    onDelta?: (args: { update: unknown }) => void;
  };
  equal(options.mode, "plan");
  equal(typeof options.onDelta, "function");

  options.onDelta?.({ update: { type: "text-delta", text: "hi" } });
  options.onDelta?.({ update: { type: "token-delta", tokens: 3 } });
  options.onDelta?.({
    update: {
      type: "tool-call-completed",
      callId: "c1",
      toolCall: { type: "read", args: { path: "a.ts" }, result: { status: "success", value: 1 } },
    },
  });
  deepEqual(events.map((event) => `${event.type}:${event.status}`), [
    "assistant:running",
    "tool_call:completed",
  ]);
  equal(events[1].name, "read");
});

Deno.test("sendCursorPrompt omits images, mode and onDelta when not needed", async () => {
  const calls: Array<{ message: unknown; options: unknown }> = [];
  await sendCursorPrompt({
    send: (message: unknown, options?: unknown) => {
      calls.push({ message, options });
      return Promise.resolve(null);
    },
  }, { text: "hi", images: [], mode: "build" });
  deepEqual(calls[0].message, { text: "hi" });
  deepEqual(calls[0].options, {});
});

Deno.test("mapCursorDelta marks failed tool calls as errors", () => {
  const event = mapCursorDelta({
    type: "tool-call-completed",
    callId: "c2",
    toolCall: { type: "edit", args: {}, result: { status: "error", error: { message: "no" } } },
  });
  equal(event?.status, "error");
  equal(mapCursorDelta({ type: "turn-ended" }), null);
});

Deno.test("runCursorPhase returns the result and does not call onLate", async () => {
  let late = 0;
  const value = await runCursorPhase(() => Promise.resolve(7), {
    timeoutMs: 1000,
    timeoutMessage: "timeout",
    onLate: () => {
      late += 1;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  equal(value, 7);
  equal(late, 0);
});

Deno.test("runCursorPhase times out and cleans up work that finishes late", async () => {
  const lateValues: string[] = [];
  let release: (value: string) => void = () => {};
  const work = new Promise<string>((resolve) => {
    release = resolve;
  });
  let caught: unknown;
  try {
    await runCursorPhase(() => work, {
      timeoutMs: 10,
      timeoutMessage: "phase timeout",
      onLate: (value) => {
        lateValues.push(value);
      },
    });
  } catch (error) {
    caught = error;
  }
  equal(caught instanceof CursorPhaseTimeoutError, true);
  equal((caught as Error).message, "phase timeout");
  deepEqual(lateValues, []);

  release("agent");
  await new Promise((resolve) => setTimeout(resolve, 5));
  deepEqual(lateValues, ["agent"]);
});

Deno.test("runCursorPhase rejects on abort before and during the phase", async () => {
  const aborted = new AbortController();
  aborted.abort();
  let started = false;
  let first: unknown;
  try {
    await runCursorPhase(() => {
      started = true;
      return Promise.resolve(1);
    }, { timeoutMs: 1000, timeoutMessage: "timeout", signal: aborted.signal });
  } catch (error) {
    first = error;
  }
  equal(isCursorCancellation(first), true);
  equal(started, false);

  const controller = new AbortController();
  const pending = runCursorPhase(() => new Promise<number>(() => {}), {
    timeoutMs: 60_000,
    timeoutMessage: "timeout",
    signal: controller.signal,
  });
  controller.abort();
  let second: unknown;
  try {
    await pending;
  } catch (error) {
    second = error;
  }
  equal(isCursorCancellation(second), true);
});

Deno.test("runCursorPhase propagates the work's own failure", async () => {
  let caught: unknown;
  try {
    await runCursorPhase(() => Promise.reject(new Error("auth failed")), {
      timeoutMs: 1000,
      timeoutMessage: "timeout",
    });
  } catch (error) {
    caught = error;
  }
  equal((caught as Error).message, "auth failed");
});

Deno.test("cursorModelsAreFresh respects TTL", () => {
  const now = Date.parse("2026-01-02T00:00:00.000Z");
  equal(
    cursorModelsAreFresh(
      JSON.stringify({
        cursorModels: [{ id: "composer-2" }],
        cursorModelsUpdatedAt: "2026-01-01T12:00:00.000Z",
      }),
      now,
    ),
    true,
  );
  equal(
    cursorModelsAreFresh(
      JSON.stringify({
        cursorModels: [{ id: "composer-2" }],
        cursorModelsUpdatedAt: "2025-12-01T00:00:00.000Z",
      }),
      now,
    ),
    false,
  );
  equal(cursorModelsAreFresh(JSON.stringify({ cursorModels: [] }), now), false);
});

Deno.test("ChatInput accepts a model override", () => {
  const parsed = ChatInput.parse({
    model: "composer-2",
    messages: [{ role: "user", content: "hi" }],
  });
  equal(parsed.model, "composer-2");
});
