import { equal } from "node:assert/strict";
import {
  ensureChatSessionTombstones,
  listHiddenCursorAgents,
  unhideCursorAgent,
} from "../src/db/chat-tombstones.ts";

const dataDir = await Deno.makeTempDir();
Deno.env.set("RND_APP_DATA_DIR", dataDir);

const db = await import("../src/db/db.ts");
db.closeDb();

const {
  closeDb,
  createLlmProvider,
  createLocalTicket,
  createProject,
  createRole,
  deleteChatSession,
  deleteLlmProvider,
  findChatSessionByCursorAgentId,
  getLocalTicket,
  getRole,
  listChatSessions,
  listLlmProviders,
  markLocalTicketSynced,
  upsertImportedCursorSession,
} = db;

Deno.test("db: llm provider CRUD and role provider null-out", async () => {
  const provider = await createLlmProvider({
    id: crypto.randomUUID(),
    name: "Test LLM",
    provider: "openai",
    model: "gpt-test",
    baseUrl: "http://127.0.0.1:9",
    apiKey: "secret",
    mode: "api",
  });
  equal((await listLlmProviders()).some((row) => row.id === provider.id), true);

  const role = await createRole({
    name: "Tester",
    persona: "You test things",
    providerId: provider.id,
  });
  equal((await getRole(role.id))?.provider_id, provider.id);

  await deleteLlmProvider(provider.id);
  equal((await getRole(role.id))?.provider_id, null);
  equal((await listLlmProviders()).some((row) => row.id === provider.id), false);
});

Deno.test("db: local ticket sync sets jira_key", async () => {
  const project = await createProject({
    id: crypto.randomUUID(),
    name: "Sync Project",
  });
  const ticket = await createLocalTicket(project.id, {
    title: "Ship feature",
    description: "<p>ok</p>",
    status: "To Do",
  });
  equal(ticket.jira_key, null);
  equal(ticket.sync_status, "local");

  await markLocalTicketSynced(ticket.id, "PROJ-42");
  const synced = await getLocalTicket(ticket.id);
  equal(synced?.jira_key, "PROJ-42");
  equal(synced?.sync_status, "synced");
});

Deno.test("db: deleted Cursor session stays deleted (tombstone + trigger)", async () => {
  // Dipasang sekali saat bootstrap; di test dipanggil eksplisit.
  await ensureChatSessionTombstones();

  const project = await createProject({
    id: crypto.randomUUID(),
    name: "Cursor Delete",
  });
  const agentId = `agent-${crypto.randomUUID()}`;

  const session = await upsertImportedCursorSession({
    projectId: project.id,
    cursorAgentId: agentId,
    title: "Cursor chat",
  });
  equal(session.source, "cursor");
  equal(session.cursor_agent_id, agentId);

  await deleteChatSession(session.id);
  equal(await findChatSessionByCursorAgentId(project.id, agentId), null);
  equal((await listHiddenCursorAgents(project.id)).includes(agentId), true);

  // Mirror berikutnya (Agent.list → upsertImportedCursorSession) tidak boleh
  // membuat sesi yang sama lagi.
  const reimported = await upsertImportedCursorSession({
    projectId: project.id,
    cursorAgentId: agentId,
    title: "Cursor chat",
  });
  equal(reimported, null);
  equal((await listChatSessions(project.id)).length, 0);

  // Escape hatch: agent bisa dimunculkan lagi (mirror meng-import ulang).
  await unhideCursorAgent(project.id, agentId);
  const again = await upsertImportedCursorSession({
    projectId: project.id,
    cursorAgentId: agentId,
    title: "Cursor chat",
  });
  equal(again.cursor_agent_id, agentId);
  equal((await listChatSessions(project.id)).length, 1);
});

Deno.test({
  name: "db: cleanup temp data dir",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    closeDb();
    Deno.env.delete("RND_APP_DATA_DIR");
    await Deno.remove(dataDir, { recursive: true });
  },
});
