import { equal, ok } from "node:assert/strict";

const dataDir = await Deno.makeTempDir();
Deno.env.set("RND_APP_DATA_DIR", dataDir);
Deno.env.delete("RND_SECRETS_KEY");

const db = await import("../src/db/db.ts");
const backup = await import("../src/server/backup.ts");
db.closeDb();

const {
  appendChatMessage,
  closeDb,
  createChatSession,
  createLlmProvider,
  createLocalTicket,
  createProject,
  createRole,
  deleteLocalTicket,
  getIntegration,
  getLlmProvider,
  getLocalTicket,
  getRole,
  listChatMessages,
  listChatSessions,
  listLocalTickets,
  listProjects,
  listRoles,
  setAppSetting,
  upsertIntegration,
} = db;

const projectId = crypto.randomUUID();
await createProject({ id: projectId, name: "Backup Project", workspacePath: "/tmp/ws" });

const ticket = await createLocalTicket(projectId, {
  title: "Tiket backup",
  description: "<p>isi</p>",
});
const ticketId = ticket.id;

await upsertIntegration({
  id: crypto.randomUUID(),
  projectId,
  kind: "jira",
  mode: "api",
  config: {
    baseUrl: "https://example.atlassian.net",
    email: "dev@example.com",
    apiToken: "token-rahasia",
  },
});

const session = await createChatSession(projectId, "Chat backup");
const sessionId = session.id;
await appendChatMessage(sessionId, "user", "halo", []);

const provider = await createLlmProvider({
  id: crypto.randomUUID(),
  name: "LLM Backup",
  provider: "openai",
  model: "gpt-test",
  apiKey: "sk-rahasia",
  mode: "api",
});
const providerId = provider.id;
await createRole({ name: "Dev", persona: "kamu developer", providerId });
await setAppSetting("ui_preferences", JSON.stringify({ theme: "dark" }));

Deno.test("backup: export menyamarkan rahasia saat includeSecrets=false", async () => {
  const bundle = await backup.buildGlobalBackup({ includeSecrets: false });
  equal(bundle.format, backup.BACKUP_FORMAT);
  equal(bundle.version, backup.BACKUP_VERSION);
  equal(bundle.scope, "global");

  const exportedProvider = bundle.llmProviders?.find((row) => row.id === providerId);
  equal(exportedProvider?.api_key, "••••••••");

  const integration = (bundle.tables.project_integrations ?? []).find(
    (row) => row.project_id === projectId,
  );
  const config = integration?.config as Record<string, unknown> | undefined;
  equal(config?.apiToken, "••••••••");
  equal(config?.baseUrl, "https://example.atlassian.net");

  const exportedTicket = (bundle.tables.local_tickets ?? []).find((row) => row.id === ticketId);
  equal(exportedTicket?.title, "Tiket backup");
});

Deno.test("backup: export menyertakan rahasia saat includeSecrets=true", async () => {
  const bundle = await backup.buildGlobalBackup({ includeSecrets: true });
  const exportedProvider = bundle.llmProviders?.find((row) => row.id === providerId);
  equal(exportedProvider?.api_key, "sk-rahasia");

  const integration = (bundle.tables.project_integrations ?? []).find(
    (row) => row.project_id === projectId,
  );
  const config = integration?.config as Record<string, unknown> | undefined;
  equal(config?.apiToken, "token-rahasia");
});

Deno.test("backup: import global mode replace memulihkan seluruh data", async () => {
  const bundle = await backup.buildGlobalBackup({ includeSecrets: true });
  await deleteLocalTicket(ticketId);
  equal(await getLocalTicket(ticketId), null);

  const summary = await backup.applyGlobalBackup(bundle, "replace");
  equal(summary.ok, true);
  equal(summary.scope, "global");
  equal(summary.mode, "replace");

  const projects = await listProjects();
  equal(projects.some((row) => row.id === projectId), true);

  const restored = await getLocalTicket(ticketId);
  equal(restored?.title, "Tiket backup");

  const sessions = await listChatSessions(projectId);
  equal(sessions.length, 1);
  const messages = await listChatMessages(sessionId);
  equal(messages.length, 1);
  equal(messages[0].content, "halo");

  const restoredProvider = await getLlmProvider(providerId);
  equal(restoredProvider?.api_key, "sk-rahasia");

  const integration = await getIntegration(projectId, "jira");
  const config = integration?.config ? JSON.parse(integration.config) : {};
  equal(config.apiToken, "token-rahasia");

  const roles = await listRoles();
  equal(roles.some((row) => row.provider_id === providerId), true);
});

Deno.test("backup: import project menyalin data ke project lain", async () => {
  const bundle = await backup.buildProjectBackup(projectId, { includeSecrets: false });
  equal(bundle.scope, "project");
  equal((bundle.tables.local_tickets ?? []).length, 1);

  const target = await createProject({ id: crypto.randomUUID(), name: "Target Import" });
  const summary = await backup.applyProjectBackup(target.id, bundle, "merge");
  equal(summary.ok, true);
  equal(summary.scope, "project");

  const tickets = await listLocalTickets(target.id);
  equal(tickets.length, 1);
  equal(tickets[0].title, "Tiket backup");
  equal(tickets[0].id === ticketId, false);

  const sessions = await listChatSessions(target.id);
  equal(sessions.length, 1);
  equal(sessions[0].id === sessionId, false);
  const messages = await listChatMessages(sessions[0].id);
  equal(messages.length, 1);

  const integration = await getIntegration(target.id, "jira");
  ok(integration);
  // Tanpa includeSecrets, token tetap berupa mask (harus diisi ulang).
  equal(JSON.parse(integration!.config).apiToken, "••••••••");

  // Mode replace tidak menduplikasi data.
  await backup.applyProjectBackup(target.id, bundle, "replace");
  equal((await listLocalTickets(target.id)).length, 1);
  equal((await listChatSessions(target.id)).length, 1);

  const roles = await listRoles();
  const role = await getRole(roles[0].id);
  ok(role);
});

Deno.test("backup: validasi format, versi, dan scope", () => {
  equal(backup.validateBackupBundle(null, "global").ok, false);
  equal(backup.validateBackupBundle({ format: "lain" }, "global").ok, false);

  const wrongVersion = {
    format: backup.BACKUP_FORMAT,
    version: 99,
    scope: "global",
    tables: {},
  };
  equal(backup.validateBackupBundle(wrongVersion, "global").ok, false);

  const wrongScope = {
    format: backup.BACKUP_FORMAT,
    version: backup.BACKUP_VERSION,
    scope: "project",
    tables: {},
  };
  equal(backup.validateBackupBundle(wrongScope, "global").ok, false);

  const valid = backup.validateBackupBundle(
    {
      format: backup.BACKUP_FORMAT,
      version: backup.BACKUP_VERSION,
      scope: "global",
      tables: { local_tickets: [{ id: "x" }], unknown_table: [] },
    },
    "global",
  );
  equal(valid.ok, true);
  if (valid.ok) {
    equal(valid.bundle.tables.local_tickets.length, 1);
    equal(valid.bundle.tables.unknown_table, undefined);
  }
});

Deno.test({
  name: "backup: cleanup temp data dir",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    closeDb();
    Deno.env.delete("RND_APP_DATA_DIR");
    await Deno.remove(dataDir, { recursive: true });
  },
});
