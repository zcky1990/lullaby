import { deepEqual, equal } from "node:assert/strict";
import { join } from "node:path";
import {
  bootstrapCursorPrompt,
  collectCursorWrites,
  conversationFromSdkTurns,
  isCloudCursorAgentId,
  latestUserPrompt,
  revertWorkspaceToSnapshot,
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
import {
  cursorModelsAreFresh,
  storeCursorModels,
} from "../src/server/chat/cursor-models.ts";
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
