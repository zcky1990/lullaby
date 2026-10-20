import { DatabaseSync } from "node:sqlite";
import type { IntegrationKind, IntegrationMode } from "../config/schema.ts";
import { dbPath, ensureAppDataDir } from "../core/paths.ts";

export interface ProjectRow {
  id: string;
  name: string;
  workspace_path: string | null;
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
  project_id: string;
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
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
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
`;

function ensureColumn(db: DatabaseSync, table: string, column: string, ddl: string): void {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!info.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function migrate(db: DatabaseSync): void {
  ensureColumn(db, "projects", "workspace_path", "workspace_path TEXT");
  ensureColumn(db, "llm_providers", "api_key", "api_key TEXT");
  ensureColumn(db, "chat_messages", "changes", "changes TEXT");

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
        (id, project_id, name, provider, model, base_url, mode, config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.project_id,
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
  docmostSpaceId?: string;
  jiraProjectKey?: string;
  githubRepo?: string;
}

export async function createProject(input: CreateProjectInput): Promise<ProjectRow> {
  const db = await getDb();
  db.prepare(
    `INSERT INTO projects (id, name, workspace_path, docmost_space_id, jira_project_key, github_repo)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.name,
    input.workspacePath ?? null,
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
       name = ?, workspace_path = ?, docmost_space_id = ?, jira_project_key = ?, github_repo = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    input.name ?? existing.name,
    input.workspacePath !== undefined ? input.workspacePath : existing.workspace_path,
    input.docmostSpaceId !== undefined ? input.docmostSpaceId : existing.docmost_space_id,
    input.jiraProjectKey !== undefined ? input.jiraProjectKey : existing.jira_project_key,
    input.githubRepo !== undefined ? input.githubRepo : existing.github_repo,
    id,
  );
  return await getProject(id);
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

export async function listLlmProviders(projectId: string): Promise<LlmProviderRow[]> {
  const db = await getDb();
  return rows<LlmProviderRow>(
    db.prepare("SELECT * FROM llm_providers WHERE project_id = ? ORDER BY created_at").all(
      projectId,
    ),
  );
}

export async function getLlmProvider(id: string): Promise<LlmProviderRow | null> {
  const db = await getDb();
  const row = db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(id);
  return (row as LlmProviderRow | undefined) ?? null;
}

export interface LlmProviderInputRow {
  id: string;
  projectId: string;
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
       (id, project_id, name, provider, model, base_url, api_key, mode, config)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
  ).run(
    input.id,
    input.projectId,
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
  input: Omit<LlmProviderInputRow, "id" | "projectId">,
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
  db.prepare("DELETE FROM llm_providers WHERE id = ?").run(id);
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
}

export async function deleteChatSession(id: string): Promise<void> {
  const db = await getDb();
  db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(id);
  db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);
}
