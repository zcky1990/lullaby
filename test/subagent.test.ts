import { equal } from "node:assert/strict";
import { join } from "node:path";
import type { LlmProviderRow } from "../src/db/db.ts";
import {
  MAX_SUBAGENTS_PER_RUN,
  normalizeSubagentSteps,
  parseSpawnAgentArgs,
  runSpawnAgent,
} from "../src/server/chat/subagent.ts";
import { prepareWriteChange, recordAppliedWrite } from "../src/server/chat/review.ts";
import {
  applyWriteFile,
  CHAT_TOOL_CATALOG,
  SPAWN_AGENT_TOOL_NAME,
  toolsFor,
} from "../src/server/chat/tools.ts";
import type { Run } from "../src/server/chat/types.ts";

const dataDir = await Deno.makeTempDir();
Deno.env.set("RND_APP_DATA_DIR", dataDir);

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

const CURSOR_PROVIDER: LlmProviderRow = {
  ...PROVIDER,
  id: "cursor",
  name: "cursor",
  provider: "cursor",
};

function makeParent(workspace: string | null, overrides: Partial<Run> = {}): Run {
  return {
    id: crypto.randomUUID(),
    provider: PROVIDER,
    workspace,
    sessionId: "sess",
    turns: [],
    pendingBatch: [],
    pendingChanges: new Map(),
    batchResults: new Map(),
    changes: [],
    projectId: "proj",
    mode: "build",
    skills: new Map(),
    mcpTools: new Map(),
    createdTickets: [],
    createdAt: Date.now(),
    abort: new AbortController(),
    ...overrides,
  };
}

Deno.test("parseSpawnAgentArgs requires prompt and clamps maxSteps", () => {
  equal("error" in parseSpawnAgentArgs({}), true);
  equal("error" in parseSpawnAgentArgs({ prompt: "  " }), true);
  const ok = parseSpawnAgentArgs({
    prompt: " Investigate X ",
    mode: "plan",
    maxSteps: 999,
    skillName: "code-review",
  });
  equal("error" in ok, false);
  if ("error" in ok) return;
  equal(ok.prompt, "Investigate X");
  equal(ok.mode, "plan");
  equal(ok.maxSteps, 50);
  equal(ok.skillName, "code-review");
  equal(normalizeSubagentSteps(undefined), 20);
  equal(normalizeSubagentSteps(0), 20);
  equal(normalizeSubagentSteps(7), 7);
});

Deno.test("spawn_agent rejects nested depth and Cursor parent", async () => {
  const nested = makeParent("/tmp", { parentRunId: "parent" });
  const nestedResult = JSON.parse(
    await runSpawnAgent(nested, { prompt: "hi" }, {
      deferReview: true,
      disabledTools: new Set(),
    }),
  );
  equal(typeof nestedResult.error, "string");
  equal(String(nestedResult.error).includes("depth"), true);

  const cursor = makeParent("/tmp", { provider: CURSOR_PROVIDER });
  const cursorResult = JSON.parse(
    await runSpawnAgent(cursor, { prompt: "hi" }, {
      deferReview: true,
      disabledTools: new Set(),
    }),
  );
  equal(typeof cursorResult.error, "string");
  equal(String(cursorResult.error).toLowerCase().includes("cursor"), true);
});

Deno.test("spawn_agent enforces max concurrent children", async () => {
  const parent = makeParent("/tmp", { activeSubagentCount: MAX_SUBAGENTS_PER_RUN });
  const result = JSON.parse(
    await runSpawnAgent(parent, { prompt: "hi" }, {
      deferReview: true,
      disabledTools: new Set(),
    }),
  );
  equal(typeof result.error, "string");
  equal(String(result.error).includes(String(MAX_SUBAGENTS_PER_RUN)), true);
});

Deno.test("spawn_agent cancel propagates before LLM work", async () => {
  const abort = new AbortController();
  abort.abort();
  const parent = makeParent("/tmp", { abort, cancelled: true });
  const result = JSON.parse(
    await runSpawnAgent(parent, { prompt: "hi" }, {
      deferReview: true,
      disabledTools: new Set(),
    }),
  );
  equal(result.canceled, true);
  equal(result.message, "(dibatalkan)");
});

Deno.test("child write merges into parent pendingChanges", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(root, "note.txt"), "before\n");
    const parent = makeParent(root);
    const call = {
      id: "w1",
      name: "write_file",
      arguments: JSON.stringify({ path: "note.txt", content: "after\n" }),
    };
    const prepared = await prepareWriteChange(parent, call);
    equal(Boolean(prepared.change), true);
    if (!prepared.change) return;
    await applyWriteFile(root, call);
    await recordAppliedWrite(parent, prepared.change, true);
    equal(await Deno.readTextFile(join(root, "note.txt")), "after\n");
    equal(parent.pendingChanges.size, 1);
    const change = [...parent.pendingChanges.values()][0];
    equal(change.path, "note.txt");
    equal(change.applied, true);
    equal(change.before, "before\n");
    equal(change.after, "after\n");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("toolsFor strips spawn_agent for headless/child by default", () => {
  equal(
    toolsFor("/tmp", "build", false).some((tool) => tool.name === SPAWN_AGENT_TOOL_NAME),
    false,
  );
  equal(
    toolsFor("/tmp", "build", false, new Set(), { allowSpawnAgent: true })
      .some((tool) => tool.name === SPAWN_AGENT_TOOL_NAME),
    true,
  );
  equal(
    toolsFor("/tmp", "build", false, new Set([SPAWN_AGENT_TOOL_NAME]), {
      allowSpawnAgent: true,
    }).some((tool) => tool.name === SPAWN_AGENT_TOOL_NAME),
    false,
  );
  equal(
    CHAT_TOOL_CATALOG.some((tool) => tool.name === SPAWN_AGENT_TOOL_NAME),
    true,
  );
});

Deno.test({
  name: "subagent: cleanup temp data dir",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { closeDb } = await import("../src/db/db.ts");
    closeDb();
    Deno.env.delete("RND_APP_DATA_DIR");
    await Deno.remove(dataDir, { recursive: true });
  },
});
