import { DatabaseSync } from "node:sqlite";
import { sanitizeHtml } from "../core/html.ts";
import type { IntegrationKind, IntegrationMode } from "../config/schema.ts";
import { dbPath, ensureAppDataDir } from "../core/paths.ts";

export interface ProjectRow {
  id: string;
  name: string;
  workspace_path: string | null;
  document_path: string | null;
  docmost_space_id: string | null;
  jira_project_key: string | null;
  github_repo: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationRow {
  id: string;
  project_id: string;
  kind: IntegrationKind;
  mode: IntegrationMode;
  config: string;
  secret_ref: string | null;
  updated_at: string;
}

export interface EventRow {
  id: number;
  type: string;
  payload: string | null;
  created_at: string;
}

export interface LlmProviderRow {
  id: string;
  name: string;
  provider: string;
  model: string | null;
  base_url: string | null;
  api_key: string | null;
  mode: IntegrationMode;
  config: string;
  created_at: string;
  updated_at: string;
}

let instance: DatabaseSync | null = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  workspace_path   TEXT,
  document_path    TEXT,
  docmost_space_id TEXT,
  jira_project_key TEXT,
  github_repo      TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_integrations (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  mode       TEXT NOT NULL DEFAULT 'api',
  config     TEXT NOT NULL DEFAULT '{}',
  secret_ref TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, kind)
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  payload    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS llm_providers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  provider   TEXT NOT NULL DEFAULT 'openai',
  model      TEXT,
  base_url   TEXT,
  api_key    TEXT,
  mode       TEXT NOT NULL DEFAULT 'api',
  config     TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  persona     TEXT NOT NULL DEFAULT '',
  provider_id TEXT REFERENCES llm_providers(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'Chat',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workflow_sessions (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS workflow_session_messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES workflow_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workflow_slug TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  workflow_path TEXT NOT NULL,
  yaml          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running',
  trigger       TEXT NOT NULL DEFAULT 'manual',
  error         TEXT,
  started_at    TEXT,
  finished_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workflow_run_steps (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_id     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  command     TEXT NOT NULL,
  exit_code   INTEGER,
  log         TEXT NOT NULL DEFAULT '',
  started_at  TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS local_documents (
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  page_id     TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local',
  sync_error  TEXT,
  synced_at   TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, path)
);

CREATE TABLE IF NOT EXISTS local_tickets (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'Backlog',
  priority    TEXT,
  type        TEXT NOT NULL DEFAULT 'Task',
  assignee    TEXT,
  labels      TEXT NOT NULL DEFAULT '[]',
  jira_key    TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local',
  sync_error  TEXT,
  synced_at   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const ENSURE_COLUMN_TABLES = new Set(["projects", "llm_providers", "chat_messages"]);

function ensureColumn(db: DatabaseSync, table: string, column: string, ddl: string): void {
  if (!ENSURE_COLUMN_TABLES.has(table) || !/^[a-z_][a-z0-9_]*$/i.test(column)) {
    throw new Error(`ensureColumn: invalid table/column (${table}.${column})`);
  }
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!info.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function withTransaction(db: DatabaseSync, fn: () => void): void {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw error;
  }
}

function migrate(db: DatabaseSync): void {
  ensureColumn(db, "projects", "workspace_path", "workspace_path TEXT");
  ensureColumn(db, "projects", "document_path", "document_path TEXT");
  ensureColumn(db, "llm_providers", "api_key", "api_key TEXT");
  ensureColumn(db, "chat_messages", "changes", "changes TEXT");

  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_project ON chat_sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_local_tickets_project ON local_tickets(project_id);
      CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
      CREATE INDEX IF NOT EXISTS idx_roles_provider ON roles(provider_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_project ON workflow_runs(project_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(project_id, workflow_slug, created_at);
      CREATE INDEX IF NOT EXISTS idx_workflow_steps_run ON workflow_run_steps(run_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_sessions_project ON workflow_sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_session_messages ON workflow_session_messages(session_id);
    `);
    db.prepare(
      "UPDATE roles SET provider_id = NULL WHERE provider_id IS NOT NULL " +
        "AND provider_id NOT IN (SELECT id FROM llm_providers)",
    ).run();
  } catch {
    // DB may be locked/readonly when another process holds it (e.g. desktop + tests).
  }

  const llmInfo = db.prepare("PRAGMA table_info(llm_providers)").all() as Array<{ name: string }>;
  if (llmInfo.some((row) => row.name === "project_id")) {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      CREATE TABLE llm_providers_global (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        provider   TEXT NOT NULL DEFAULT 'openai',
        model      TEXT,
        base_url   TEXT,
        api_key    TEXT,
        mode       TEXT NOT NULL DEFAULT 'api',
        config     TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT OR IGNORE INTO llm_providers_global
        (id, name, provider, model, base_url, api_key, mode, config, created_at, updated_at)
      SELECT id, name, provider, model, base_url, api_key, mode, config, created_at, updated_at
      FROM llm_providers;
      DROP TABLE llm_providers;
      ALTER TABLE llm_providers_global RENAME TO llm_providers;
      PRAGMA foreign_keys = ON;
    `);
  }

  const legacy = db
    .prepare(
      "SELECT id, project_id, mode, config, secret_ref FROM project_integrations WHERE kind = 'llm'",
    )
    .all() as Array<{
      id: string;
      project_id: string;
      mode: string;
      config: string;
      secret_ref: string | null;
    }>;

  for (const row of legacy) {
    let cfg: Record<string, unknown> = {};
    try {
      cfg = JSON.parse(row.config) as Record<string, unknown>;
    } catch {
      cfg = {};
    }
    db.prepare(
      `INSERT OR IGNORE INTO llm_providers
        (id, name, provider, model, base_url, mode, config)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      "Default",
      typeof cfg.provider === "string" ? cfg.provider : "openai",
      typeof cfg.model === "string" ? cfg.model : null,
      typeof cfg.baseUrl === "string" ? cfg.baseUrl : null,
      row.mode,
      row.config,
    );
    db.prepare("DELETE FROM project_integrations WHERE id = ?").run(row.id);
  }
}

export async function getDb(): Promise<DatabaseSync> {
  if (instance) return instance;
  await ensureAppDataDir();
  const db = new DatabaseSync(dbPath());
  db.exec(SCHEMA);
  migrate(db);
  instance = db;
  return db;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

function rows<T>(result: unknown): T[] {
  return (result as T[]) ?? [];
}

export async function listProjects(): Promise<ProjectRow[]> {
  const db = await getDb();
  return rows<ProjectRow>(db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all());
}

export async function getProject(id: string): Promise<ProjectRow | null> {
  const db = await getDb();
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return (row as ProjectRow | undefined) ?? null;
}

export interface CreateProjectInput {
  id: string;
  name: string;
  workspacePath?: string;
  documentPath?: string;
  docmostSpaceId?: string;
  jiraProjectKey?: string;
  githubRepo?: string;
}

export async function createProject(input: CreateProjectInput): Promise<ProjectRow> {
  const db = await getDb();
  db.prepare(
    `INSERT INTO projects (id, name, workspace_path, document_path, docmost_space_id, jira_project_key, github_repo)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.name,
    input.workspacePath ?? null,
    input.documentPath ?? null,
    input.docmostSpaceId ?? null,
    input.jiraProjectKey ?? null,
    input.githubRepo ?? null,
  );
  const created = await getProject(input.id);
  return created!;
}

export interface UpdateProjectInput {
  name?: string;
  workspacePath?: string | null;
  documentPath?: string | null;
  docmostSpaceId?: string | null;
  jiraProjectKey?: string | null;
  githubRepo?: string | null;
}

export async function updateProject(
  id: string,
  input: UpdateProjectInput,
): Promise<ProjectRow | null> {
  const existing = await getProject(id);
  if (!existing) return null;
  const db = await getDb();
  db.prepare(
    `UPDATE projects SET
       name = ?, workspace_path = ?, document_path = ?, docmost_space_id = ?,
       jira_project_key = ?, github_repo = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    input.name ?? existing.name,
    input.workspacePath !== undefined ? input.workspacePath : existing.workspace_path,
    input.documentPath !== undefined ? input.documentPath : existing.document_path,
    input.docmostSpaceId !== undefined ? input.docmostSpaceId : existing.docmost_space_id,
    input.jiraProjectKey !== undefined ? input.jiraProjectKey : existing.jira_project_key,
    input.githubRepo !== undefined ? input.githubRepo : existing.github_repo,
    id,
  );
  return await getProject(id);
}

export async function deleteProject(id: string): Promise<boolean> {
  const existing = await getProject(id);
  if (!existing) return false;
  const db = await getDb();
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return true;
}

export async function listIntegrations(projectId: string): Promise<IntegrationRow[]> {
  const db = await getDb();
  return rows<IntegrationRow>(
    db.prepare("SELECT * FROM project_integrations WHERE project_id = ? ORDER BY kind").all(
      projectId,
    ),
  );
}

export async function getIntegration(
  projectId: string,
  kind: IntegrationKind,
): Promise<IntegrationRow | null> {
  const db = await getDb();
  const row = db.prepare(
    "SELECT * FROM project_integrations WHERE project_id = ? AND kind = ?",
  ).get(projectId, kind);
  return (row as IntegrationRow | undefined) ?? null;
}

export interface UpsertIntegrationInput {
  id: string;
  projectId: string;
  kind: IntegrationKind;
  mode: IntegrationMode;
  config: Record<string, unknown>;
}

export async function upsertIntegration(
  input: UpsertIntegrationInput,
): Promise<IntegrationRow> {
  const db = await getDb();
  db.prepare(
    `INSERT INTO project_integrations (id, project_id, kind, mode, config, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (project_id, kind) DO UPDATE SET
       mode = excluded.mode,
       config = excluded.config,
       updated_at = datetime('now')`,
  ).run(
    input.id,
    input.projectId,
    input.kind,
    input.mode,
    JSON.stringify(input.config),
  );
  const saved = await getIntegration(input.projectId, input.kind);
  return saved!;
}

export async function appendEvent(type: string, payload: unknown): Promise<void> {
  const db = await getDb();
  db.prepare("INSERT INTO events (type, payload) VALUES (?, ?)").run(
    type,
    JSON.stringify(payload ?? null),
  );
}

export async function recentEvents(limit = 50): Promise<EventRow[]> {
  const db = await getDb();
  return rows<EventRow>(
    db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit),
  );
}

export async function pruneEvents(keep = 1000): Promise<void> {
  const db = await getDb();
  db.prepare(
    "DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT ?)",
  ).run(keep);
}

export async function listLlmProviders(): Promise<LlmProviderRow[]> {
  const db = await getDb();
  return rows<LlmProviderRow>(
    db.prepare("SELECT * FROM llm_providers ORDER BY created_at").all(),
  );
}

export async function getLlmProvider(id: string): Promise<LlmProviderRow | null> {
  const db = await getDb();
  const row = db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(id);
  return (row as LlmProviderRow | undefined) ?? null;
}

export interface LlmProviderInputRow {
  id: string;
  name: string;
  provider: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  mode: IntegrationMode;
}

export async function createLlmProvider(input: LlmProviderInputRow): Promise<LlmProviderRow> {
  const db = await getDb();
  db.prepare(
    `INSERT INTO llm_providers
       (id, name, provider, model, base_url, api_key, mode, config)
     VALUES (?, ?, ?, ?, ?, ?, ?, '{}')`,
  ).run(
    input.id,
    input.name,
    input.provider,
    input.model ?? null,
    input.baseUrl ?? null,
    input.apiKey ?? null,
    input.mode,
  );
  return (await getLlmProvider(input.id))!;
}

export async function updateLlmProvider(
  id: string,
  input: Omit<LlmProviderInputRow, "id">,
): Promise<LlmProviderRow | null> {
  const db = await getDb();
  db.prepare(
    `UPDATE llm_providers SET
       name = ?, provider = ?, model = ?, base_url = ?, api_key = ?, mode = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    input.name,
    input.provider,
    input.model ?? null,
    input.baseUrl ?? null,
    input.apiKey ?? null,
    input.mode,
    id,
  );
  return await getLlmProvider(id);
}

export async function deleteLlmProvider(id: string): Promise<void> {
  const db = await getDb();
  withTransaction(db, () => {
    db.prepare("UPDATE roles SET provider_id = NULL WHERE provider_id = ?").run(id);
    db.prepare("DELETE FROM llm_providers WHERE id = ?").run(id);
  });
}

export interface ChatSessionRow {
  id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatChange {
  path: string;
  action: "create" | "update";
  diff: string;
  added: number;
  removed: number;
}

export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  changes: string | null;
  created_at: string;
}

export async function createChatSession(
  projectId: string,
  title: string,
): Promise<ChatSessionRow> {
  const db = await getDb();
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO chat_sessions (id, project_id, title) VALUES (?, ?, ?)").run(
    id,
    projectId,
    title,
  );
  return (await getChatSession(id))!;
}

export async function getChatSession(id: string): Promise<ChatSessionRow | null> {
  const db = await getDb();
  const row = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(id);
  return (row as ChatSessionRow | undefined) ?? null;
}

export async function listChatSessions(projectId: string): Promise<ChatSessionRow[]> {
  const db = await getDb();
  return rows<ChatSessionRow>(
    db
      .prepare("SELECT * FROM chat_sessions WHERE project_id = ? ORDER BY updated_at DESC")
      .all(projectId),
  );
}

export async function listChatMessages(sessionId: string): Promise<ChatMessageRow[]> {
  const db = await getDb();
  return rows<ChatMessageRow>(
    db
      .prepare("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at, rowid")
      .all(sessionId),
  );
}

export async function appendChatMessage(
  sessionId: string,
  role: string,
  content: string,
  changes: ChatChange[] = [],
): Promise<void> {
  const db = await getDb();
  withTransaction(db, () => {
    db.prepare(
      "INSERT INTO chat_messages (id, session_id, role, content, changes) VALUES (?, ?, ?, ?, ?)",
    ).run(
      crypto.randomUUID(),
      sessionId,
      role,
      content,
      changes.length ? JSON.stringify(changes) : null,
    );
    db.prepare("UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
  });
}

export async function deleteChatSession(id: string): Promise<void> {
  const db = await getDb();
  withTransaction(db, () => {
    db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);
  });
}

export interface LocalTicketRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: string;
  priority: string | null;
  type: string;
  assignee: string | null;
  labels: string;
  jira_key: string | null;
  sync_status: string;
  sync_error: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocalTicketInput {
  title: string;
  description?: string;
  status?: string;
  priority?: string | null;
  type?: string;
  assignee?: string;
  labels?: string[];
}

export async function createLocalTicket(
  projectId: string,
  input: LocalTicketInput,
): Promise<LocalTicketRow> {
  const db = await getDb();
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO local_tickets (id, project_id, title, description, status, priority, type, assignee, labels) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    projectId,
    input.title,
    sanitizeHtml(input.description ?? ""),
    input.status ?? "Backlog",
    input.priority ?? null,
    input.type ?? "Task",
    input.assignee ?? null,
    JSON.stringify(input.labels ?? []),
  );
  return (await getLocalTicket(id))!;
}

export async function getLocalTicket(id: string): Promise<LocalTicketRow | null> {
  const db = await getDb();
  const row = db.prepare("SELECT * FROM local_tickets WHERE id = ?").get(id);
  return (row as LocalTicketRow | undefined) ?? null;
}

export async function listLocalTickets(projectId: string): Promise<LocalTicketRow[]> {
  const db = await getDb();
  return rows<LocalTicketRow>(
    db
      .prepare("SELECT * FROM local_tickets WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId),
  );
}

export interface LocalTicketPatch {
  title?: string;
  description?: string;
  status?: string;
  priority?: string | null;
  type?: string;
  assignee?: string | null;
  labels?: string[];
}

export async function updateLocalTicket(
  id: string,
  patch: LocalTicketPatch,
): Promise<LocalTicketRow | null> {
  const db = await getDb();
  const existing = await getLocalTicket(id);
  if (!existing) return null;
  db.prepare(
    "UPDATE local_tickets SET title = ?, description = ?, status = ?, priority = ?, type = ?, " +
      "assignee = ?, labels = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(
    patch.title ?? existing.title,
    patch.description === undefined ? existing.description : sanitizeHtml(patch.description),
    patch.status ?? existing.status,
    patch.priority === undefined ? existing.priority : patch.priority,
    patch.type ?? existing.type,
    patch.assignee === undefined ? existing.assignee : patch.assignee,
    patch.labels ? JSON.stringify(patch.labels) : existing.labels,
    id,
  );
  return await getLocalTicket(id);
}

export async function deleteLocalTicket(id: string): Promise<void> {
  const db = await getDb();
  db.prepare("DELETE FROM local_tickets WHERE id = ?").run(id);
}

export async function markLocalTicketSynced(id: string, jiraKey: string): Promise<void> {
  const db = await getDb();
  db.prepare(
    "UPDATE local_tickets SET jira_key = ?, sync_status = 'synced', sync_error = NULL, " +
      "synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
  ).run(jiraKey, id);
}

export async function markLocalTicketSyncError(id: string, message: string): Promise<void> {
  const db = await getDb();
  db.prepare(
    "UPDATE local_tickets SET sync_status = 'error', sync_error = ?, updated_at = datetime('now') " +
      "WHERE id = ?",
  ).run(message, id);
}

export interface LocalDocumentMetaRow {
  project_id: string;
  path: string;
  page_id: string | null;
  sync_status: string;
  sync_error: string | null;
  synced_at: string | null;
  updated_at: string;
}

export async function listLocalDocumentMeta(projectId: string): Promise<LocalDocumentMetaRow[]> {
  const db = await getDb();
  return rows<LocalDocumentMetaRow>(
    db.prepare("SELECT * FROM local_documents WHERE project_id = ?").all(projectId),
  );
}

export async function getLocalDocumentMeta(
  projectId: string,
  path: string,
): Promise<LocalDocumentMetaRow | null> {
  const db = await getDb();
  const row = db
    .prepare("SELECT * FROM local_documents WHERE project_id = ? AND path = ?")
    .get(projectId, path);
  return (row as LocalDocumentMetaRow | undefined) ?? null;
}

export async function markLocalDocumentSynced(
  projectId: string,
  path: string,
  pageId: string,
): Promise<void> {
  const db = await getDb();
  db.prepare(
    "INSERT INTO local_documents (project_id, path, page_id, sync_status, sync_error, synced_at, updated_at) " +
      "VALUES (?, ?, ?, 'synced', NULL, datetime('now'), datetime('now')) " +
      "ON CONFLICT(project_id, path) DO UPDATE SET page_id = excluded.page_id, " +
      "sync_status = 'synced', sync_error = NULL, synced_at = datetime('now'), " +
      "updated_at = datetime('now')",
  ).run(projectId, path, pageId);
}

export async function markLocalDocumentSyncError(
  projectId: string,
  path: string,
  message: string,
): Promise<void> {
  const db = await getDb();
  db.prepare(
    "INSERT INTO local_documents (project_id, path, sync_status, sync_error, updated_at) " +
      "VALUES (?, ?, 'error', ?, datetime('now')) " +
      "ON CONFLICT(project_id, path) DO UPDATE SET sync_status = 'error', " +
      "sync_error = excluded.sync_error, updated_at = datetime('now')",
  ).run(projectId, path, message);
}

export async function moveLocalDocumentMeta(
  projectId: string,
  from: string,
  to: string,
): Promise<void> {
  if (from === to) return;
  const db = await getDb();
  withTransaction(db, () => {
    const existing = db
      .prepare("SELECT * FROM local_documents WHERE project_id = ? AND path = ?")
      .get(projectId, from) as LocalDocumentMetaRow | undefined;
    db.prepare("DELETE FROM local_documents WHERE project_id = ? AND path = ?").run(
      projectId,
      from,
    );
    if (!existing) return;
    db.prepare(
      "INSERT INTO local_documents (project_id, path, page_id, sync_status, sync_error, synced_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
    ).run(
      projectId,
      to,
      existing.page_id,
      existing.sync_status,
      existing.sync_error,
      existing.synced_at,
    );
  });
}

export async function deleteLocalDocumentMeta(projectId: string, path: string): Promise<void> {
  const db = await getDb();
  db.prepare("DELETE FROM local_documents WHERE project_id = ? AND path = ?").run(projectId, path);
}

export async function getAppSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value?: string }
    | undefined;
  return row?.value ?? null;
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
  ).run(key, value);
}

export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  persona: string;
  provider_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoleInput {
  name: string;
  description?: string;
  persona: string;
  providerId?: string;
}

export async function listRoles(): Promise<RoleRow[]> {
  const db = await getDb();
  return rows<RoleRow>(db.prepare("SELECT * FROM roles ORDER BY created_at").all());
}

export async function getRole(id: string): Promise<RoleRow | null> {
  const db = await getDb();
  const row = db.prepare("SELECT * FROM roles WHERE id = ?").get(id);
  return (row as RoleRow | undefined) ?? null;
}

export async function createRole(input: RoleInput): Promise<RoleRow> {
  const db = await getDb();
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO roles (id, name, description, persona, provider_id) VALUES (?, ?, ?, ?, ?)",
  ).run(
    id,
    input.name,
    input.description ?? null,
    input.persona,
    input.providerId ?? null,
  );
  return (await getRole(id))!;
}

export async function updateRole(id: string, input: RoleInput): Promise<RoleRow | null> {
  const db = await getDb();
  const existing = await getRole(id);
  if (!existing) return null;
  db.prepare(
    "UPDATE roles SET name = ?, description = ?, persona = ?, provider_id = ?, " +
      "updated_at = datetime('now') WHERE id = ?",
  ).run(
    input.name,
    input.description ?? null,
    input.persona,
    input.providerId ?? null,
    id,
  );
  return await getRole(id);
}

export async function deleteRole(id: string): Promise<void> {
  const db = await getDb();
  db.prepare("DELETE FROM roles WHERE id = ?").run(id);
}

export type WorkflowRunStatus =
  | "running"
  | "success"
  | "failed"
  | "canceled"
  | "interrupted";

export type WorkflowStepStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped"
  | "canceled";

export interface WorkflowRunRow {
  id: string;
  project_id: string;
  workflow_slug: string;
  workflow_name: string;
  workflow_path: string;
  yaml: string;
  status: WorkflowRunStatus;
  trigger: string;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface WorkflowRunStepRow {
  id: string;
  run_id: string;
  step_id: string;
  status: WorkflowStepStatus;
  command: string;
  exit_code: number | null;
  log: string;
  started_at: string | null;
  finished_at: string | null;
}

export async function createWorkflowRun(input: {
  projectId: string;
  slug: string;
  name: string;
  path: string;
  yaml: string;
  trigger?: string;
}): Promise<WorkflowRunRow> {
  const db = await getDb();
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO workflow_runs (id, project_id, workflow_slug, workflow_name, workflow_path, yaml, " +
      "status, trigger, started_at) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, datetime('now'))",
  ).run(
    id,
    input.projectId,
    input.slug,
    input.name,
    input.path,
    input.yaml,
    input.trigger ?? "manual",
  );
  return (await getWorkflowRun(id))!;
}

export async function getWorkflowRun(id: string): Promise<WorkflowRunRow | null> {
  const db = await getDb();
  const row = db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id);
  return (row as WorkflowRunRow | undefined) ?? null;
}

export async function updateWorkflowRun(
  id: string,
  status: WorkflowRunStatus,
  error?: string,
): Promise<void> {
  const db = await getDb();
  db.prepare(
    "UPDATE workflow_runs SET status = ?, error = ?, " +
      "finished_at = CASE WHEN ? = 'running' THEN finished_at ELSE datetime('now') END WHERE id = ?",
  ).run(status, error ?? null, status, id);
}

export async function findActiveWorkflowRun(
  projectId: string,
  slug: string,
): Promise<WorkflowRunRow | null> {
  const db = await getDb();
  const row = db
    .prepare(
      "SELECT * FROM workflow_runs WHERE project_id = ? AND workflow_slug = ? AND status = 'running' " +
        "ORDER BY created_at DESC LIMIT 1",
    )
    .get(projectId, slug);
  return (row as WorkflowRunRow | undefined) ?? null;
}

export async function listWorkflowRuns(
  projectId: string,
  slug?: string,
  limit = 50,
): Promise<WorkflowRunRow[]> {
  const db = await getDb();
  const capped = Math.min(Math.max(limit, 1), 200);
  if (slug) {
    return rows<WorkflowRunRow>(
      db
        .prepare(
          "SELECT * FROM workflow_runs WHERE project_id = ? AND workflow_slug = ? " +
            "ORDER BY created_at DESC LIMIT ?",
        )
        .all(projectId, slug, capped),
    );
  }
  return rows<WorkflowRunRow>(
    db
      .prepare(
        "SELECT * FROM workflow_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(projectId, capped),
  );
}

export async function createWorkflowRunStep(
  runId: string,
  stepId: string,
  command: string,
): Promise<WorkflowRunStepRow> {
  const db = await getDb();
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO workflow_run_steps (id, run_id, step_id, command) VALUES (?, ?, ?, ?)",
  ).run(id, runId, stepId, command);
  return (await getWorkflowRunStep(id))!;
}

export async function getWorkflowRunStep(id: string): Promise<WorkflowRunStepRow | null> {
  const db = await getDb();
  const row = db.prepare("SELECT * FROM workflow_run_steps WHERE id = ?").get(id);
  return (row as WorkflowRunStepRow | undefined) ?? null;
}

export async function listWorkflowRunSteps(runId: string): Promise<WorkflowRunStepRow[]> {
  const db = await getDb();
  return rows<WorkflowRunStepRow>(
    db.prepare("SELECT * FROM workflow_run_steps WHERE run_id = ? ORDER BY rowid").all(runId),
  );
}

export async function updateWorkflowRunStep(
  id: string,
  patch: {
    status: WorkflowStepStatus;
    exitCode?: number | null;
    log?: string;
    startedAt?: boolean;
  },
): Promise<void> {
  const db = await getDb();
  db.prepare(
    "UPDATE workflow_run_steps SET status = ?, exit_code = ?, log = ?, " +
      "started_at = CASE WHEN ? THEN datetime('now') ELSE started_at END, " +
      "finished_at = CASE WHEN ? IN ('success','failed','skipped','canceled') THEN datetime('now') ELSE finished_at END " +
      "WHERE id = ?",
  ).run(
    patch.status,
    patch.exitCode ?? null,
    patch.log ?? "",
    patch.startedAt ? 1 : 0,
    patch.status,
    id,
  );
}

export async function markInterruptedWorkflowRuns(): Promise<void> {
  const db = await getDb();
  db.prepare(
    "UPDATE workflow_runs SET status = 'interrupted', " +
      "error = COALESCE(error, 'Aplikasi berhenti saat run berjalan.'), finished_at = datetime('now') " +
      "WHERE status = 'running'",
  ).run();
  db.prepare(
    "UPDATE workflow_run_steps SET status = 'canceled', finished_at = datetime('now') " +
      "WHERE status IN ('pending','running')",
  ).run();
}

export interface WorkflowSessionRow {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowSessionMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

export async function getOrCreateWorkflowSession(
  projectId: string,
  name: string,
): Promise<WorkflowSessionRow> {
  const db = await getDb();
  const existing = db
    .prepare("SELECT * FROM workflow_sessions WHERE project_id = ? AND name = ?")
    .get(projectId, name) as WorkflowSessionRow | undefined;
  if (existing) return existing;
  const id = crypto.randomUUID();
  try {
    db.prepare("INSERT INTO workflow_sessions (id, project_id, name) VALUES (?, ?, ?)").run(
      id,
      projectId,
      name,
    );
  } catch {
    const raced = db
      .prepare("SELECT * FROM workflow_sessions WHERE project_id = ? AND name = ?")
      .get(projectId, name) as unknown as WorkflowSessionRow | undefined;
    if (raced) return raced;
    throw new Error(`Gagal membuat session "${name}".`);
  }
  const row = db.prepare("SELECT * FROM workflow_sessions WHERE id = ?").get(id);
  return row as unknown as WorkflowSessionRow;
}

export async function listWorkflowSessionMessages(
  sessionId: string,
): Promise<WorkflowSessionMessageRow[]> {
  const db = await getDb();
  return rows<WorkflowSessionMessageRow>(
    db
      .prepare(
        "SELECT * FROM workflow_session_messages WHERE session_id = ? ORDER BY created_at, rowid",
      )
      .all(sessionId),
  );
}

export async function appendWorkflowSessionMessage(
  sessionId: string,
  role: string,
  content: string,
): Promise<void> {
  const db = await getDb();
  db.prepare(
    "INSERT INTO workflow_session_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)",
  ).run(crypto.randomUUID(), sessionId, role, content);
  db.prepare("UPDATE workflow_sessions SET updated_at = datetime('now') WHERE id = ?").run(
    sessionId,
  );
}

export async function listWorkflowSessions(projectId: string): Promise<WorkflowSessionRow[]> {
  const db = await getDb();
  return rows<WorkflowSessionRow>(
    db.prepare("SELECT * FROM workflow_sessions WHERE project_id = ? ORDER BY updated_at DESC").all(
      projectId,
    ),
  );
}
