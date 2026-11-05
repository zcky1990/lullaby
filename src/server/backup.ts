import type { DatabaseSync } from "node:sqlite";
import { getDb, getProject, listIntegrations, listLlmProviders } from "../db/db.ts";
import { SECRET_CONFIG_KEYS, SECRET_MASK } from "../secrets/constants.ts";
import {
  decryptConfigSecrets,
  decryptMcpServers,
  decryptNotificationChannels,
  encryptConfigSecrets,
  encryptMcpServers,
  encryptNotificationChannels,
  encryptSecretValue,
  maskMcpServers,
  maskNotificationChannels,
  mergeMcpServerSecrets,
  mergeNotificationChannelSecrets,
  type McpServerSecrets,
  type NotificationChannelSecrets,
} from "../secrets/fields.ts";

export const BACKUP_FORMAT = "lullaby-backup";
export const BACKUP_VERSION = 1;
const APP_VERSION = "0.1.0";

/** Harus sama dengan `MCP_SETTINGS_KEY` di `src/server/routes/settings.ts`. */
const MCP_SETTINGS_KEY = "mcp_servers";
/** `NOTIFICATIONS_KEY` di `src/server/notifications/settings.ts`. */
const NOTIFICATIONS_KEY = "notifications";

export type BackupScope = "global" | "project";
export type BackupMode = "merge" | "replace";

export type IntegrationConfig = Record<string, unknown>;

export interface BackupIntegration {
  kind: string;
  mode: string;
  config: IntegrationConfig;
}

export interface BackupBundle {
  format: typeof BACKUP_FORMAT;
  version: number;
  scope: BackupScope;
  exportedAt: string;
  appVersion: string;
  /** Hanya penanda; nilai rahasia tetap diproses saat export. */
  includeSecrets: boolean;
  settings?: Record<string, unknown>;
  llmProviders?: Array<Record<string, unknown>>;
  roles?: Array<Record<string, unknown>>;
  project?: Record<string, unknown> | null;
  integrations?: BackupIntegration[];
  tables: Record<string, Array<Record<string, unknown>>>;
}

export interface BackupSummary {
  ok: true;
  scope: BackupScope;
  mode: BackupMode;
  imported: Record<string, number>;
}

export interface ExportOptions {
  includeSecrets: boolean;
}

interface TableSpec {
  name: string;
  /** Kolom kunci untuk upsert (harus punya UNIQUE/PK). */
  keys: string[];
}

/** Urutan penting: parent dulu, child belakangan (FK ON). */
const TABLE_SPECS: TableSpec[] = [
  { name: "projects", keys: ["id"] },
  { name: "project_integrations", keys: ["project_id", "kind"] },
  { name: "local_tickets", keys: ["id"] },
  { name: "local_documents", keys: ["project_id", "path"] },
  { name: "chat_sessions", keys: ["id"] },
  { name: "chat_messages", keys: ["id"] },
  { name: "workflow_sessions", keys: ["id"] },
  { name: "workflow_session_messages", keys: ["id"] },
  { name: "workflow_runs", keys: ["id"] },
  { name: "workflow_run_steps", keys: ["id"] },
  { name: "workflow_schedules", keys: ["project_id", "workflow_slug"] },
];

const GLOBAL_WIPE_ORDER = [
  "workflow_run_steps",
  "workflow_runs",
  "workflow_schedules",
  "workflow_session_messages",
  "workflow_sessions",
  "chat_messages",
  "chat_sessions",
  "local_documents",
  "local_tickets",
  "project_integrations",
  "roles",
  "llm_providers",
  "projects",
  "app_settings",
];

const PROJECT_WIPE_STATEMENTS = [
  "DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE project_id = ?)",
  "DELETE FROM chat_sessions WHERE project_id = ?",
  "DELETE FROM workflow_run_steps WHERE run_id IN (SELECT id FROM workflow_runs WHERE project_id = ?)",
  "DELETE FROM workflow_runs WHERE project_id = ?",
  "DELETE FROM workflow_schedules WHERE project_id = ?",
  "DELETE FROM workflow_session_messages WHERE session_id IN " +
  "(SELECT id FROM workflow_sessions WHERE project_id = ?)",
  "DELETE FROM workflow_sessions WHERE project_id = ?",
  "DELETE FROM local_documents WHERE project_id = ?",
  "DELETE FROM local_tickets WHERE project_id = ?",
  "DELETE FROM project_integrations WHERE project_id = ?",
];

function nowIso(): string {
  return new Date().toISOString();
}

function timestampForFilename(): string {
  return nowIso().replace(/[:.]/g, "-");
}

function parseJsonObject(raw: string): IntegrationConfig {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as IntegrationConfig
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray<T>(raw: string): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function objectRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const rows = value.filter((row) => !!row && typeof row === "object" && !Array.isArray(row));
  return rows as Array<Record<string, unknown>>;
}

function channelArray(value: unknown): NotificationChannelSecrets[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const channels = (value as { channels?: unknown }).channels;
  return Array.isArray(channels) ? channels as NotificationChannelSecrets[] : [];
}

function storedChannels(raw: string): NotificationChannelSecrets[] {
  if (!raw) return [];
  try {
    return channelArray(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function orFallback<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function maskConfig(config: IntegrationConfig): IntegrationConfig {
  const out: IntegrationConfig = { ...config };
  for (const key of SECRET_CONFIG_KEYS) {
    const value = out[key];
    if (typeof value === "string" && value.length > 0) out[key] = SECRET_MASK;
  }
  return out;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// --- Export ---------------------------------------------------------------

async function exportSettings(
  db: DatabaseSync,
  includeSecrets: boolean,
): Promise<Record<string, unknown>> {
  const rows = db.prepare("SELECT key, value FROM app_settings ORDER BY key").all() as Array<{
    key: string;
    value: string;
  }>;
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const key = String(row.key);
    const raw = String(row.value ?? "");
    if (key === MCP_SETTINGS_KEY) {
      const servers = parseJsonArray<McpServerSecrets>(raw);
      const plain = await orFallback(() => decryptMcpServers(servers), servers);
      out[key] = includeSecrets ? plain : maskMcpServers(plain);
      continue;
    }
    if (key === NOTIFICATIONS_KEY) {
      const channels = storedChannels(raw);
      const plain = await orFallback(() => decryptNotificationChannels(channels), channels);
      out[key] = {
        channels: includeSecrets ? plain : maskNotificationChannels(plain),
      };
      continue;
    }
    out[key] = raw;
  }
  return out;
}

async function exportTableRows(
  db: DatabaseSync,
  table: string,
  includeSecrets: boolean,
): Promise<Array<Record<string, unknown>>> {
  const rows = db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
  if (table !== "project_integrations") return rows;
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const config = parseJsonObject(typeof row.config === "string" ? row.config : "");
    const plain = await orFallback(() => decryptConfigSecrets(config), config);
    out.push({ ...row, config: includeSecrets ? plain : maskConfig(plain) });
  }
  return out;
}

export async function buildGlobalBackup(options: ExportOptions): Promise<BackupBundle> {
  const db = await getDb();
  const settings = await exportSettings(db, options.includeSecrets);
  const providers = (await listLlmProviders()).map((row) => ({
    id: row.id,
    name: row.name,
    provider: row.provider,
    model: row.model,
    base_url: row.base_url,
    api_key: options.includeSecrets
      ? row.api_key
      : row.api_key
      ? SECRET_MASK
      : null,
    mode: row.mode,
    config: parseJsonObject(row.config),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const roles = db.prepare("SELECT * FROM roles ORDER BY created_at").all() as Array<
    Record<string, unknown>
  >;
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  for (const spec of TABLE_SPECS) {
    tables[spec.name] = await exportTableRows(db, spec.name, options.includeSecrets);
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    scope: "global",
    exportedAt: nowIso(),
    appVersion: APP_VERSION,
    includeSecrets: options.includeSecrets,
    settings,
    llmProviders: providers,
    roles: roles.map((row) => ({ ...row })),
    tables,
  };
}

export async function buildProjectBackup(
  projectId: string,
  options: ExportOptions,
): Promise<BackupBundle> {
  const db = await getDb();
  const project = await getProject(projectId);
  if (!project) throw new Error("project_not_found");

  const integrationRows = await listIntegrations(projectId);
  const integrations: BackupIntegration[] = [];
  for (const row of integrationRows) {
    const config = parseJsonObject(row.config);
    const plain = await orFallback(() => decryptConfigSecrets(config), config);
    integrations.push({
      kind: row.kind,
      mode: row.mode,
      config: options.includeSecrets ? plain : maskConfig(plain),
    });
  }

  const tables: Record<string, Array<Record<string, unknown>>> = {
    local_tickets: db.prepare(
      "SELECT * FROM local_tickets WHERE project_id = ? ORDER BY created_at",
    ).all(projectId) as Array<Record<string, unknown>>,
    local_documents: db.prepare(
      "SELECT * FROM local_documents WHERE project_id = ? ORDER BY path",
    ).all(projectId) as Array<Record<string, unknown>>,
    chat_sessions: db.prepare(
      "SELECT * FROM chat_sessions WHERE project_id = ? ORDER BY created_at",
    ).all(projectId) as Array<Record<string, unknown>>,
    chat_messages: db.prepare(
      "SELECT * FROM chat_messages WHERE session_id IN " +
        "(SELECT id FROM chat_sessions WHERE project_id = ?) ORDER BY created_at",
    ).all(projectId) as Array<Record<string, unknown>>,
    workflow_sessions: db.prepare(
      "SELECT * FROM workflow_sessions WHERE project_id = ? ORDER BY created_at",
    ).all(projectId) as Array<Record<string, unknown>>,
    workflow_session_messages: db.prepare(
      "SELECT * FROM workflow_session_messages WHERE session_id IN " +
        "(SELECT id FROM workflow_sessions WHERE project_id = ?) ORDER BY created_at",
    ).all(projectId) as Array<Record<string, unknown>>,
    workflow_runs: db.prepare(
      "SELECT * FROM workflow_runs WHERE project_id = ? ORDER BY created_at",
    ).all(projectId) as Array<Record<string, unknown>>,
    workflow_run_steps: db.prepare(
      "SELECT * FROM workflow_run_steps WHERE run_id IN " +
        "(SELECT id FROM workflow_runs WHERE project_id = ?)",
    ).all(projectId) as Array<Record<string, unknown>>,
    workflow_schedules: db.prepare(
      "SELECT * FROM workflow_schedules WHERE project_id = ?",
    ).all(projectId) as Array<Record<string, unknown>>,
  };

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    scope: "project",
    exportedAt: nowIso(),
    appVersion: APP_VERSION,
    includeSecrets: options.includeSecrets,
    project: { ...project },
    integrations,
    tables,
  };
}

export function backupFilename(scope: BackupScope, projectId?: string | null): string {
  const stamp = timestampForFilename();
  return scope === "global"
    ? `lullaby-global-backup-${stamp}.json`
    : `lullaby-project-${projectId ?? "backup"}-${stamp}.json`;
}

// --- Validation -----------------------------------------------------------

export type ValidationResult =
  | { ok: true; bundle: BackupBundle }
  | { ok: false; error: string };

export function validateBackupBundle(value: unknown, expectedScope: BackupScope): ValidationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Bundle harus berupa objek JSON." };
  }
  const raw = value as Record<string, unknown>;
  if (raw.format !== BACKUP_FORMAT) {
    return { ok: false, error: "Format file bukan backup Lullaby." };
  }
  if (Number(raw.version) !== BACKUP_VERSION) {
    return { ok: false, error: `Versi backup ${String(raw.version)} tidak didukung.` };
  }
  if (raw.scope !== expectedScope) {
    const scope = String(raw.scope);
    return {
      ok: false,
      error: `Backup scope "${scope}" tidak cocok (butuh "${expectedScope}").`,
    };
  }
  if (!raw.tables || typeof raw.tables !== "object" || Array.isArray(raw.tables)) {
    return { ok: false, error: "Field tables pada backup tidak valid." };
  }

  const rawTables = raw.tables as Record<string, unknown>;
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  for (const spec of TABLE_SPECS) {
    const rows = rawTables[spec.name];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) {
      return { ok: false, error: `tables.${spec.name} harus berupa array.` };
    }
    tables[spec.name] = objectRows(rows);
  }

  const settings = raw.settings && typeof raw.settings === "object" && !Array.isArray(raw.settings)
    ? raw.settings as Record<string, unknown>
    : undefined;
  const project = raw.project && typeof raw.project === "object" && !Array.isArray(raw.project)
    ? raw.project as Record<string, unknown>
    : null;
  const integrations: BackupIntegration[] = [];
  for (const row of objectRows(raw.integrations)) {
    const kind = nullableString(row.kind);
    if (!kind) continue;
    integrations.push({
      kind,
      mode: nullableString(row.mode) ?? "api",
      config: row.config && typeof row.config === "object" && !Array.isArray(row.config)
        ? row.config as IntegrationConfig
        : {},
    });
  }

  return {
    ok: true,
    bundle: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      scope: expectedScope,
      exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : nowIso(),
      appVersion: typeof raw.appVersion === "string" ? raw.appVersion : "unknown",
      includeSecrets: raw.includeSecrets === true,
      settings,
      llmProviders: objectRows(raw.llmProviders),
      roles: objectRows(raw.roles),
      project,
      integrations,
      tables,
    },
  };
}

// --- Import helpers -------------------------------------------------------

function normalizeSqlValue(value: unknown): string | number | null | Uint8Array {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value);
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return info.map((row) => String(row.name));
}

function buildUpsertSql(spec: TableSpec, columns: string[]): string {
  const placeholders = columns.map(() => "?").join(", ");
  const updates = columns.filter((column) => !spec.keys.includes(column));
  const conflict = `ON CONFLICT(${spec.keys.join(", ")})`;
  const action = updates.length
    ? `DO UPDATE SET ${updates.map((column) => `${column} = excluded.${column}`).join(", ")}`
    : "DO NOTHING";
  return `INSERT INTO ${spec.name} (${columns.join(", ")}) ` +
    `VALUES (${placeholders}) ${conflict} ${action}`;
}

function insertRows(
  db: DatabaseSync,
  spec: TableSpec,
  rows: Array<Record<string, unknown>>,
  columns: string[],
): number {
  const cache = new Map<string, string>();
  let inserted = 0;
  for (const row of rows) {
    const rowColumns = columns.filter((column) => row[column] !== undefined);
    if (!spec.keys.every((key) => rowColumns.includes(key))) continue;
    if (rowColumns.length === 0) continue;
    const signature = rowColumns.join(",");
    let sql = cache.get(signature);
    if (!sql) {
      sql = buildUpsertSql(spec, rowColumns);
      cache.set(signature, sql);
    }
    db.prepare(sql).run(...rowColumns.map((column) => normalizeSqlValue(row[column])));
    inserted += 1;
  }
  return inserted;
}

function columnValues(db: DatabaseSync, table: string, column: string): Set<string> {
  const rows = db.prepare(`SELECT ${column} AS value FROM ${table}`).all() as Array<{
    value: unknown;
  }>;
  return new Set(rows.map((row) => String(row.value)));
}

function filterOrphans(
  db: DatabaseSync,
  table: string,
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  switch (table) {
    case "projects":
    case "roles":
    case "llm_providers":
      return rows;
    case "project_integrations":
    case "local_tickets":
    case "local_documents":
    case "chat_sessions":
    case "workflow_sessions":
    case "workflow_runs":
    case "workflow_schedules": {
      const projects = columnValues(db, "projects", "id");
      return rows.filter((row) => projects.has(String(row.project_id ?? "")));
    }
    case "chat_messages": {
      const sessions = columnValues(db, "chat_sessions", "id");
      return rows.filter((row) => sessions.has(String(row.session_id ?? "")));
    }
    case "workflow_session_messages": {
      const sessions = columnValues(db, "workflow_sessions", "id");
      return rows.filter((row) => sessions.has(String(row.session_id ?? "")));
    }
    case "workflow_run_steps": {
      const runs = columnValues(db, "workflow_runs", "id");
      return rows.filter((row) => runs.has(String(row.run_id ?? "")));
    }
    default:
      return rows;
  }
}

async function readExistingMcpServers(db: DatabaseSync): Promise<McpServerSecrets[]> {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(MCP_SETTINGS_KEY) as
    | { value?: string }
    | undefined;
  const servers = parseJsonArray<McpServerSecrets>(row?.value ?? "");
  return await orFallback(() => decryptMcpServers(servers), servers);
}

async function readExistingChannels(db: DatabaseSync): Promise<NotificationChannelSecrets[]> {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(NOTIFICATIONS_KEY) as
    | { value?: string }
    | undefined;
  const channels = storedChannels(row?.value ?? "");
  return await orFallback(() => decryptNotificationChannels(channels), channels);
}

async function prepareSettingsEntries(
  db: DatabaseSync,
  settings: Record<string, unknown>,
): Promise<Array<[string, string]>> {
  const entries: Array<[string, string]> = [];
  const existingMcp = settings[MCP_SETTINGS_KEY] === undefined
    ? []
    : await readExistingMcpServers(db);
  const existingChannels = settings[NOTIFICATIONS_KEY] === undefined
    ? []
    : await readExistingChannels(db);

  for (const [key, value] of Object.entries(settings)) {
    if (key === MCP_SETTINGS_KEY) {
      const incoming = Array.isArray(value) ? value as McpServerSecrets[] : [];
      const merged = mergeMcpServerSecrets(incoming, existingMcp);
      const encrypted = await encryptMcpServers(merged);
      entries.push([key, JSON.stringify(encrypted)]);
      continue;
    }
    if (key === NOTIFICATIONS_KEY) {
      const merged = mergeNotificationChannelSecrets(channelArray(value), existingChannels);
      const encrypted = await encryptNotificationChannels(merged);
      entries.push([key, JSON.stringify({ channels: encrypted })]);
      continue;
    }
    const serialized = typeof value === "string" ? value : JSON.stringify(value ?? null);
    entries.push([key, serialized]);
  }
  return entries;
}

async function prepareLlmRows(
  rows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const existing = new Map((await listLlmProviders()).map((row) => [row.id, row]));
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const id = nullableString(row.id) ?? crypto.randomUUID();
    const rawKey = row.api_key;
    let apiKey: string | null = null;
    if (typeof rawKey === "string" && rawKey.length > 0 && rawKey !== SECRET_MASK) {
      apiKey = await encryptSecretValue(rawKey);
    } else if (rawKey === SECRET_MASK) {
      apiKey = await encryptSecretValue(existing.get(id)?.api_key ?? null);
    }
    const prepared: Record<string, unknown> = {
      id,
      name: nullableString(row.name) ?? "Provider",
      provider: nullableString(row.provider) ?? "openai",
      model: nullableString(row.model),
      base_url: nullableString(row.base_url),
      api_key: apiKey,
      mode: nullableString(row.mode) ?? "api",
      config: typeof row.config === "string" ? row.config : JSON.stringify(row.config ?? {}),
    };
    if (typeof row.created_at === "string") prepared.created_at = row.created_at;
    if (typeof row.updated_at === "string") prepared.updated_at = row.updated_at;
    out.push(prepared);
  }
  return out;
}

function prepareRoleRows(
  rows: Array<Record<string, unknown>>,
  providerIds: Set<string>,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const providerId = nullableString(row.provider_id);
    const prepared: Record<string, unknown> = {
      id: nullableString(row.id) ?? crypto.randomUUID(),
      name: nullableString(row.name) ?? "Role",
      description: nullableString(row.description),
      persona: typeof row.persona === "string" ? row.persona : "",
      provider_id: providerId && providerIds.has(providerId) ? providerId : null,
    };
    if (typeof row.created_at === "string") prepared.created_at = row.created_at;
    if (typeof row.updated_at === "string") prepared.updated_at = row.updated_at;
    out.push(prepared);
  }
  return out;
}

async function prepareIntegrationRows(
  rows: Array<Record<string, unknown>>,
  projectIdOverride?: string,
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const kind = nullableString(row.kind);
    const projectId = projectIdOverride ?? nullableString(row.project_id);
    if (!kind || !projectId) continue;
    const config = row.config && typeof row.config === "object" && !Array.isArray(row.config)
      ? row.config as IntegrationConfig
      : {};
    const encrypted = await encryptConfigSecrets(config);
    const prepared: Record<string, unknown> = {
      id: projectIdOverride ? crypto.randomUUID() : nullableString(row.id) ?? crypto.randomUUID(),
      project_id: projectId,
      kind,
      mode: nullableString(row.mode) ?? "api",
      config: JSON.stringify(encrypted),
    };
    if (typeof row.updated_at === "string") prepared.updated_at = row.updated_at;
    out.push(prepared);
  }
  return out;
}

function insertSettingsEntries(db: DatabaseSync, entries: Array<[string, string]>): number {
  const statement = db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
  );
  for (const [key, value] of entries) statement.run(key, value);
  return entries.length;
}

// --- Import ---------------------------------------------------------------

export async function applyGlobalBackup(
  bundle: BackupBundle,
  mode: BackupMode,
): Promise<BackupSummary> {
  const db = await getDb();
  const columns = new Map(TABLE_SPECS.map((spec) => [spec.name, tableColumns(db, spec.name)]));

  // Operasi async (enkripsi/dekripsi) disiapkan sebelum transaksi, agar tidak
  // ada statement request lain yang ikut masuk ke transaksi yang sama.
  const settingsEntries = await prepareSettingsEntries(db, bundle.settings ?? {});
  const llmRows = await prepareLlmRows(bundle.llmProviders ?? []);
  const providerIds = new Set((await listLlmProviders()).map((row) => row.id));
  for (const row of llmRows) providerIds.add(String(row.id));
  const roles = prepareRoleRows(bundle.roles ?? [], providerIds);

  const prepared = new Map<string, Array<Record<string, unknown>>>();
  for (const spec of TABLE_SPECS) {
    const rows = bundle.tables[spec.name] ?? [];
    const next = spec.name === "project_integrations"
      ? await prepareIntegrationRows(rows)
      : rows;
    prepared.set(spec.name, next);
  }

  const imported: Record<string, number> = {};
  const roleColumns = tableColumns(db, "roles");
  const llmColumns = tableColumns(db, "llm_providers");

  db.exec("BEGIN");
  try {
    if (mode === "replace") {
      for (const table of GLOBAL_WIPE_ORDER) db.exec(`DELETE FROM ${table}`);
    }
    imported.app_settings = insertSettingsEntries(db, settingsEntries);
    const llmSpec: TableSpec = { name: "llm_providers", keys: ["id"] };
    imported.llm_providers = insertRows(db, llmSpec, llmRows, llmColumns);
    const roleSpec: TableSpec = { name: "roles", keys: ["id"] };
    imported.roles = insertRows(db, roleSpec, roles, roleColumns);

    for (const spec of TABLE_SPECS) {
      const rows = filterOrphans(db, spec.name, prepared.get(spec.name) ?? []);
      imported[spec.name] = insertRows(db, spec, rows, columns.get(spec.name) ?? []);
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw error;
  }

  return { ok: true, scope: "global", mode, imported };
}

export async function applyProjectBackup(
  projectId: string,
  bundle: BackupBundle,
  mode: BackupMode,
): Promise<BackupSummary> {
  const project = await getProject(projectId);
  if (!project) throw new Error("project_not_found");
  const db = await getDb();

  const integrationRows = await prepareIntegrationRows(bundle.integrations ?? [], projectId);
  const tables = bundle.tables;

  const localTickets = (tables.local_tickets ?? []).map((row) => ({
    ...row,
    id: crypto.randomUUID(),
    project_id: projectId,
  }));
  const localDocuments = (tables.local_documents ?? []).map((row) => ({
    ...row,
    project_id: projectId,
  }));

  const sessionMap = new Map<string, string>();
  const chatSessions = (tables.chat_sessions ?? []).map((row) => {
    const id = crypto.randomUUID();
    if (typeof row.id === "string") sessionMap.set(row.id, id);
    return { ...row, id, project_id: projectId, cursor_agent_id: row.cursor_agent_id ?? null };
  });
  const chatMessages = (tables.chat_messages ?? []).flatMap((row) => {
    const sessionId = sessionMap.get(String(row.session_id ?? ""));
    return sessionId ? [{ ...row, id: crypto.randomUUID(), session_id: sessionId }] : [];
  });

  const workflowSessionMap = new Map<string, string>();
  const workflowSessions = (tables.workflow_sessions ?? []).map((row) => {
    const id = crypto.randomUUID();
    if (typeof row.id === "string") workflowSessionMap.set(row.id, id);
    return { ...row, id, project_id: projectId };
  });
  const workflowSessionMessages = (tables.workflow_session_messages ?? []).flatMap((row) => {
    const sessionId = workflowSessionMap.get(String(row.session_id ?? ""));
    return sessionId ? [{ ...row, id: crypto.randomUUID(), session_id: sessionId }] : [];
  });

  const runMap = new Map<string, string>();
  const workflowRuns = (tables.workflow_runs ?? []).map((row) => {
    const id = crypto.randomUUID();
    if (typeof row.id === "string") runMap.set(row.id, id);
    return { ...row, id, project_id: projectId };
  });
  const workflowRunSteps = (tables.workflow_run_steps ?? []).flatMap((row) => {
    const runId = runMap.get(String(row.run_id ?? ""));
    return runId ? [{ ...row, id: crypto.randomUUID(), run_id: runId }] : [];
  });
  const workflowSchedules = (tables.workflow_schedules ?? []).map((row) => ({
    ...row,
    project_id: projectId,
  }));

  const imports = new Map<string, Array<Record<string, unknown>>>([
    ["project_integrations", integrationRows],
    ["local_tickets", localTickets],
    ["local_documents", localDocuments],
    ["chat_sessions", chatSessions],
    ["chat_messages", chatMessages],
    ["workflow_sessions", workflowSessions],
    ["workflow_session_messages", workflowSessionMessages],
    ["workflow_runs", workflowRuns],
    ["workflow_run_steps", workflowRunSteps],
    ["workflow_schedules", workflowSchedules],
  ]);

  const imported: Record<string, number> = {};

  db.exec("BEGIN");
  try {
    if (mode === "replace") {
      for (const sql of PROJECT_WIPE_STATEMENTS) {
        db.prepare(sql).run(projectId);
      }
    }
    for (const spec of TABLE_SPECS) {
      if (spec.name === "projects") continue;
      const rows = filterOrphans(db, spec.name, imports.get(spec.name) ?? []);
      imported[spec.name] = insertRows(db, spec, rows, tableColumns(db, spec.name));
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw error;
  }

  return { ok: true, scope: "project", mode, imported };
}
