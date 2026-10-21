import {
  ChatApproveInput,
  ChatInput,
  CreateDocumentInput,
  DocmostConfig,
  GenerateTicketsInput,
  IntegrationInput,
  type IntegrationKind,
  JiraConfig,
  LlmProviderInput,
  LocalDocumentInput,
  LocalDocumentSyncInput,
  LocalDocumentUpdateInput,
  LocalTicketInput,
  LocalTicketUpdateInput,
  McpServerInput,
  McpSettingsInput,
  ProjectInput,
  ProjectUpdateInput,
  SkillsSettingsInput,
  UpdateDocumentInput,
  UpdateFileInput,
} from "../config/schema.ts";
import { appDataDir } from "../core/paths.ts";
import { log } from "../core/logger.ts";
import {
  appendEvent,
  createLlmProvider,
  createLocalTicket,
  createProject,
  deleteChatSession,
  deleteLlmProvider,
  deleteLocalTicket,
  getAppSetting,
  getChatSession,
  getIntegration,
  getLlmProvider,
  getLocalTicket,
  getProject,
  listChatMessages,
  listChatSessions,
  listIntegrations,
  listLlmProviders,
  listLocalDocumentMeta,
  listLocalTickets,
  listProjects,
  type LocalTicketRow,
  markLocalDocumentSynced,
  markLocalDocumentSyncError,
  markLocalTicketSynced,
  markLocalTicketSyncError,
  moveLocalDocumentMeta,
  recentEvents,
  setAppSetting,
  updateLlmProvider,
  updateLocalTicket,
  updateProject,
  upsertIntegration,
} from "../db/db.ts";
import {
  createLocalDocument,
  listLocalDocuments,
  readLocalDocument,
  updateLocalDocument,
} from "../fs/documents.ts";
import { listMcpTools } from "./mcp.ts";
import { globalSkillsDir, listSkills, readSkillsSettings, workspaceSkillsDir } from "./skills.ts";
import { listDirectory, readWorkspaceFile, writeWorkspaceFile } from "../fs/workspace.ts";
import {
  createDocument,
  getDocument,
  listDocuments,
  updateDocument,
} from "../integrations/docmost.ts";
import { createTicket, getTicket, listTickets, transitionTicket } from "../integrations/jira.ts";
import {
  approveChat,
  generateTicketsFromDocument,
  startChat,
  type VisibleMessage,
} from "./chat.ts";
import { testIntegration } from "../integrations/index.ts";
import { publish } from "./bus.ts";
import { APP_TOKEN_COOKIE, APP_TOKEN_HEADER, appToken } from "./session.ts";
import { sse } from "./sse.ts";
import { serveAsset } from "./static.ts";

const VERSION = "0.1.0";
const MAX_BODY_BYTES = 26_000_000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function isAuthorized(req: Request): boolean {
  const expected = appToken();
  return cookieValue(req, APP_TOKEN_COOKIE) === expected ||
    req.headers.get(APP_TOKEN_HEADER) === expected;
}

async function readJson(req: Request): Promise<unknown> {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return {};
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function record(type: string, payload: unknown): Promise<void> {
  await appendEvent(type, payload);
  publish({ type, payload });
}

async function createProjectHandler(req: Request): Promise<Response> {
  const parsed = ProjectInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const project = await createProject({ id: crypto.randomUUID(), ...parsed.data });
  await record("project.created", { id: project.id, name: project.name });
  return json({ project }, 201);
}

async function updateProjectHandler(projectId: string, req: Request): Promise<Response> {
  const parsed = ProjectUpdateInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const project = await updateProject(projectId, parsed.data);
  if (!project) return json({ error: "project_not_found" }, 404);
  await record("project.updated", { id: projectId });
  return json({ project });
}

async function listFilesHandler(projectId: string, rel: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  if (!project.workspace_path) return json({ configured: false, path: rel, entries: [] });
  try {
    const listing = await listDirectory(project.workspace_path, rel);
    return json({
      configured: true,
      path: rel,
      entries: listing.entries,
      truncated: listing.truncated,
    });
  } catch (error) {
    return json({ configured: true, path: rel, entries: [], error: (error as Error).message });
  }
}

async function fileContentHandler(projectId: string, rel: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  if (!project.workspace_path) return json({ error: "no_workspace" }, 400);
  try {
    return json({ path: rel, ...(await readWorkspaceFile(project.workspace_path, rel)) });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}

async function writeFileHandler(projectId: string, req: Request): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  if (!project.workspace_path) return json({ error: "no_workspace" }, 400);

  const parsed = UpdateFileInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  try {
    await writeWorkspaceFile(project.workspace_path, parsed.data.path, parsed.data.content);
    await record("file.written", { projectId, path: parsed.data.path });
    return json({ ok: true, path: parsed.data.path, size: parsed.data.content.length });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}

async function upsertIntegrationHandler(
  projectId: string,
  kind: IntegrationKind,
  req: Request,
): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);

  const body = await readJson(req);
  const parsed = IntegrationInput.safeParse({ ...(body as Record<string, unknown>), kind });
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  const integration = await upsertIntegration({
    id: crypto.randomUUID(),
    projectId,
    kind,
    mode: parsed.data.mode,
    config: parsed.data.config,
  });
  await record("integration.saved", { projectId, kind });
  return json({ integration: serializeIntegration(integration) });
}

function serializeIntegration(row: {
  kind: string;
  mode: string;
  config: string;
  updated_at: string;
}) {
  return {
    kind: row.kind,
    mode: row.mode,
    config: JSON.parse(row.config) as Record<string, unknown>,
    updatedAt: row.updated_at,
  };
}

function serializeLlm(row: {
  id: string;
  name: string;
  provider: string;
  model: string | null;
  base_url: string | null;
  api_key: string | null;
  mode: string;
  updated_at: string;
}) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    model: row.model,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    mode: row.mode,
    updatedAt: row.updated_at,
  };
}

async function getProjectDetail(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const integrations = (await listIntegrations(project.id)).map(serializeIntegration);
  const llmProviders = (await listLlmProviders(project.id)).map(serializeLlm);
  return json({ project, integrations, llmProviders });
}

async function createLlmHandler(projectId: string, req: Request): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);

  const parsed = LlmProviderInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  const provider = await createLlmProvider({
    id: crypto.randomUUID(),
    projectId,
    name: parsed.data.name,
    provider: parsed.data.provider,
    model: parsed.data.model,
    baseUrl: parsed.data.baseUrl,
    apiKey: parsed.data.apiKey,
    mode: parsed.data.mode,
  });
  await record("llm.created", { projectId, name: provider.name });
  return json({ provider: serializeLlm(provider) }, 201);
}

async function updateLlmHandler(
  projectId: string,
  providerId: string,
  req: Request,
): Promise<Response> {
  const existing = await getLlmProvider(providerId);
  if (!existing || existing.project_id !== projectId) {
    return json({ error: "provider_not_found" }, 404);
  }

  const parsed = LlmProviderInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  const provider = await updateLlmProvider(providerId, {
    name: parsed.data.name,
    provider: parsed.data.provider,
    model: parsed.data.model,
    baseUrl: parsed.data.baseUrl,
    apiKey: parsed.data.apiKey,
    mode: parsed.data.mode,
  });
  await record("llm.saved", { projectId, providerId });
  return json({ provider: serializeLlm(provider!) });
}

async function deleteLlmHandler(projectId: string, providerId: string): Promise<Response> {
  const existing = await getLlmProvider(providerId);
  if (!existing || existing.project_id !== projectId) {
    return json({ error: "provider_not_found" }, 404);
  }
  await deleteLlmProvider(providerId);
  await record("llm.deleted", { projectId, providerId });
  return json({ ok: true });
}

async function chatHandler(projectId: string, req: Request): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);

  const parsed = ChatInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  let provider = parsed.data.providerId ? await getLlmProvider(parsed.data.providerId) : null;
  if (!provider || provider.project_id !== projectId) {
    provider = (await listLlmProviders(projectId))[0] ?? null;
  }
  if (!provider) return json({ error: "no_provider" }, 400);

  const messages: VisibleMessage[] = parsed.data.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
      attachments: message.attachments,
    }));

  const result = await startChat(
    projectId,
    provider,
    project.workspace_path ?? null,
    messages,
    parsed.data.sessionId,
    parsed.data.variant,
    parsed.data.mode,
  );
  await record("chat.message", { projectId, providerId: provider.id });
  return json(result);
}

async function chatApproveHandler(req: Request): Promise<Response> {
  const parsed = ChatApproveInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const result = await approveChat(parsed.data.runId, parsed.data.id, parsed.data.action);
  return json(result);
}

function parseChanges(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function listChatSessionsHandler(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const sessions = (await listChatSessions(projectId)).map((session) => ({
    id: session.id,
    title: session.title,
    updatedAt: session.updated_at,
  }));
  return json({ sessions });
}

async function getChatSessionHandler(projectId: string, sessionId: string): Promise<Response> {
  const session = await getChatSession(sessionId);
  if (!session || session.project_id !== projectId) {
    return json({ error: "session_not_found" }, 404);
  }
  const messages = (await listChatMessages(session.id))
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: message.content,
      changes: parseChanges(message.changes),
    }));
  return json({
    session: { id: session.id, title: session.title, updatedAt: session.updated_at },
    messages,
  });
}

async function deleteChatSessionHandler(projectId: string, sessionId: string): Promise<Response> {
  const session = await getChatSession(sessionId);
  if (!session || session.project_id !== projectId) {
    return json({ error: "session_not_found" }, 404);
  }
  await deleteChatSession(sessionId);
  return json({ ok: true });
}

function localDocumentPayload(
  doc: { path: string; title: string },
  meta?: { page_id: string | null; sync_status: string; sync_error: string | null },
) {
  return {
    id: doc.path,
    path: doc.path,
    title: doc.title,
    syncStatus: meta?.sync_status ?? "local",
    pageId: meta?.page_id ?? undefined,
    syncError: meta?.sync_error ?? undefined,
  };
}

async function listLocalDocumentsHandler(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const root = project.document_path?.trim();
  if (!root) return json({ configured: false, documents: [] });

  try {
    const [entries, meta] = await Promise.all([
      listLocalDocuments(root),
      listLocalDocumentMeta(projectId),
    ]);
    const byPath = new Map(meta.map((row) => [row.path, row]));
    return json({
      configured: true,
      path: root,
      documents: entries.map((entry) => localDocumentPayload(entry, byPath.get(entry.path))),
    });
  } catch (error) {
    return json({
      configured: true,
      path: root,
      error: `Gagal membaca document workspace: ${(error as Error).message}`,
      documents: [],
    });
  }
}

async function getLocalDocumentHandler(projectId: string, path: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const root = project.document_path?.trim();
  if (!root) return json({ error: "Document workspace belum diatur." }, 400);

  try {
    const doc = await readLocalDocument(root, path);
    const meta = (await listLocalDocumentMeta(projectId)).find((row) => row.path === doc.path);
    return json({ document: { ...doc, ...localDocumentPayload(doc, meta) } });
  } catch (error) {
    return json({ error: (error as Error).message }, 404);
  }
}

async function createLocalDocumentHandler(projectId: string, req: Request): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const root = project.document_path?.trim();
  if (!root) return json({ error: "Document workspace belum diatur." }, 400);

  const parsed = LocalDocumentInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  try {
    const doc = await createLocalDocument(root, parsed.data.title);
    await record("document.created_local", { projectId, path: doc.path });
    return json({ document: { ...doc, ...localDocumentPayload(doc) } }, 201);
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}

async function updateLocalDocumentHandler(projectId: string, req: Request): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const root = project.document_path?.trim();
  if (!root) return json({ error: "Document workspace belum diatur." }, 400);

  const parsed = LocalDocumentUpdateInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  try {
    const doc = await updateLocalDocument(root, parsed.data.path, {
      title: parsed.data.title,
      content: parsed.data.content,
    });
    if (doc.path !== parsed.data.path) {
      await moveLocalDocumentMeta(projectId, parsed.data.path, doc.path);
    }
    const meta = (await listLocalDocumentMeta(projectId)).find((row) => row.path === doc.path);
    return json({ document: { ...doc, ...localDocumentPayload(doc, meta) } });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}

async function syncLocalDocumentHandler(projectId: string, req: Request): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const root = project.document_path?.trim();
  if (!root) return json({ error: "Document workspace belum diatur." }, 400);

  const parsed = LocalDocumentSyncInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  const ctx = await integrationContext(projectId, "docmost");
  if (!ctx) return json({ error: "Integrasi Docmost belum dikonfigurasi." }, 400);
  const parsedCfg = DocmostConfig.safeParse(ctx.config);
  if (!parsedCfg.success) return json({ error: "Konfigurasi Docmost tidak valid." }, 400);
  const spaceId = parsedCfg.data.spaceId?.trim() || project.docmost_space_id?.trim();
  if (!spaceId) return json({ error: "Space ID Docmost belum diisi." }, 400);

  try {
    const doc = await readLocalDocument(root, parsed.data.path);
    const meta = (await listLocalDocumentMeta(projectId)).find((row) => row.path === doc.path);
    let pageId = meta?.page_id ?? "";

    if (pageId) {
      await updateDocument(parsedCfg.data, {
        pageId,
        title: doc.title,
        content: doc.content,
      });
    } else {
      const created = await createDocument(parsedCfg.data, { spaceId, title: doc.title });
      pageId = created.id;
      await updateDocument(parsedCfg.data, { pageId, title: doc.title, content: doc.content });
    }

    await markLocalDocumentSynced(projectId, doc.path, pageId);
    await record("document.synced", { projectId, path: doc.path, pageId });
    const updatedMeta = (await listLocalDocumentMeta(projectId)).find((row) =>
      row.path === doc.path
    );
    return json({ document: { ...doc, ...localDocumentPayload(doc, updatedMeta) } });
  } catch (error) {
    const message = (error as Error).message;
    await markLocalDocumentSyncError(projectId, parsed.data.path, message);
    return json({ error: message }, 502);
  }
}

const MCP_SETTINGS_KEY = "mcp_servers";

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function getMcpSettingsHandler(): Promise<Response> {
  const raw = await getAppSetting(MCP_SETTINGS_KEY);
  let servers: unknown = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) servers = parsed;
    } catch {
      servers = [];
    }
  }
  const enabled = (await getAppSetting("mcp_enabled")) !== "false";
  const disabledTools = parseStringArray(await getAppSetting("mcp_disabled_tools"));
  return json({ servers, enabled, disabledTools });
}

async function saveMcpSettingsHandler(req: Request): Promise<Response> {
  const parsed = McpSettingsInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const servers = parsed.data.servers.map((server) => ({
    ...server,
    id: server.id ?? crypto.randomUUID(),
  }));
  await setAppSetting(MCP_SETTINGS_KEY, JSON.stringify(servers));
  await setAppSetting("mcp_enabled", parsed.data.enabled ? "true" : "false");
  await setAppSetting("mcp_disabled_tools", JSON.stringify(parsed.data.disabledTools));
  await record("settings.mcp_updated", {
    count: servers.length,
    enabled: parsed.data.enabled,
  });
  return json({
    servers,
    enabled: parsed.data.enabled,
    disabledTools: parsed.data.disabledTools,
  });
}

async function listMcpToolsHandler(req: Request): Promise<Response> {
  const body = (await readJson(req)) as { server?: unknown };
  const parsed = McpServerInput.safeParse(body?.server);
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  try {
    return json({ tools: await listMcpTools(parsed.data) });
  } catch (error) {
    return json({ error: (error as Error).message }, 502);
  }
}

async function generateTicketsHandler(projectId: string, req: Request): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);

  const parsed = GenerateTicketsInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  let provider = parsed.data.providerId ? await getLlmProvider(parsed.data.providerId) : null;
  if (!provider || provider.project_id !== projectId) {
    provider = (await listLlmProviders(projectId))[0] ?? null;
  }
  if (!provider) return json({ error: "Belum ada provider LLM di project ini." }, 400);

  try {
    const result = await generateTicketsFromDocument(
      projectId,
      provider,
      parsed.data.title,
      parsed.data.content,
      parsed.data.variant,
    );
    await record("tickets.generated", { projectId, count: result.tickets.length });
    return json(result);
  } catch (error) {
    return json({ error: (error as Error).message }, 502);
  }
}

async function skillsHandler(projectId: string | null): Promise<Response> {
  const project = projectId ? await getProject(projectId) : null;
  const workspace = project?.workspace_path ?? null;
  const settings = await readSkillsSettings();
  const skills = await listSkills(workspace);
  return json({
    enabled: settings.enabled,
    disabled: settings.disabled,
    globalPath: globalSkillsDir(),
    workspacePath: workspace ? workspaceSkillsDir(workspace) : null,
    skills: skills.map((skill) => ({
      ...skill,
      enabled: !settings.disabled.includes(skill.id),
    })),
  });
}

async function saveSkillsSettingsHandler(req: Request): Promise<Response> {
  const parsed = SkillsSettingsInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  await setAppSetting("skills_enabled", parsed.data.enabled ? "true" : "false");
  await setAppSetting("skills_disabled", JSON.stringify(parsed.data.disabled));
  await record("settings.skills_updated", {
    enabled: parsed.data.enabled,
    disabled: parsed.data.disabled.length,
  });
  return json({ ok: true });
}

async function testIntegrationHandler(req: Request): Promise<Response> {
  const parsed = IntegrationInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const result = await testIntegration(parsed.data);
  await record("integration.tested", { kind: parsed.data.kind, ok: result.ok });
  return json({ result });
}

async function integrationContext(projectId: string, kind: "docmost" | "jira") {
  const row = await getIntegration(projectId, kind);
  if (!row) return null;
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(row.config) as Record<string, unknown>;
  } catch {
    config = {};
  }
  return { config };
}

async function listDocumentsHandler(projectId: string, pageId?: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const ctx = await integrationContext(projectId, "docmost");
  if (!ctx) return json({ configured: false, documents: [] });

  const parsed = DocmostConfig.safeParse(ctx.config);
  if (!parsed.success) {
    return json({ configured: true, error: "Konfigurasi Docmost tidak valid.", documents: [] });
  }
  try {
    const spaceId = parsed.data.spaceId ?? project.docmost_space_id ?? undefined;
    const { documents, sample } = await listDocuments(parsed.data, spaceId, pageId);
    return json({
      configured: true,
      documents,
      ...(documents.length === 0 && !pageId ? { debug: sample } : {}),
    });
  } catch (error) {
    return json({ configured: true, error: (error as Error).message, documents: [] });
  }
}

async function createDocumentHandler(projectId: string, req: Request): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);

  const ctx = await integrationContext(projectId, "docmost");
  if (!ctx) return json({ error: "not_configured" }, 400);
  const parsedCfg = DocmostConfig.safeParse(ctx.config);
  if (!parsedCfg.success) return json({ error: "invalid_config" }, 400);

  const parsed = CreateDocumentInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  const spaceId = parsedCfg.data.spaceId ?? project.docmost_space_id ?? undefined;
  if (!spaceId) return json({ error: "space_required" }, 400);

  try {
    const document = await createDocument(parsedCfg.data, {
      spaceId,
      title: parsed.data.title,
      parentPageId: parsed.data.parentPageId,
    });
    await record("document.created", { projectId, id: document.id });
    return json({ document }, 201);
  } catch (error) {
    return json({ error: (error as Error).message }, 502);
  }
}

async function updateDocumentHandler(
  projectId: string,
  pageId: string,
  req: Request,
): Promise<Response> {
  const ctx = await integrationContext(projectId, "docmost");
  if (!ctx) return json({ error: "not_configured" }, 400);
  const parsedCfg = DocmostConfig.safeParse(ctx.config);
  if (!parsedCfg.success) return json({ error: "invalid_config" }, 400);

  const parsed = UpdateDocumentInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  try {
    const document = await updateDocument(parsedCfg.data, {
      pageId,
      title: parsed.data.title,
      content: parsed.data.content,
    });
    await record("document.updated", { projectId, id: pageId });
    return json({ document });
  } catch (error) {
    return json({ error: (error as Error).message }, 502);
  }
}

async function getDocumentHandler(projectId: string, pageId: string): Promise<Response> {
  const ctx = await integrationContext(projectId, "docmost");
  if (!ctx) return json({ error: "not_configured" }, 400);

  const parsed = DocmostConfig.safeParse(ctx.config);
  if (!parsed.success) return json({ error: "invalid_config" }, 400);
  try {
    return json({ document: await getDocument(parsed.data, pageId) });
  } catch (error) {
    return json({ error: (error as Error).message }, 502);
  }
}

function localLabels(row: LocalTicketRow): string[] {
  try {
    const parsed = JSON.parse(row.labels);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function localTicketKey(row: LocalTicketRow): string {
  return row.jira_key ?? `LOCAL-${row.id.slice(0, 6).toUpperCase()}`;
}

function localTicketUrl(row: LocalTicketRow, baseUrl?: string): string {
  if (!row.jira_key || !baseUrl) return "";
  return `${baseUrl.replace(/\/+$/, "")}/browse/${row.jira_key}`;
}

function localTicketSummary(row: LocalTicketRow, baseUrl?: string) {
  return {
    key: localTicketKey(row),
    summary: row.title,
    status: row.status,
    assignee: row.assignee ?? undefined,
    priority: row.priority ?? undefined,
    url: localTicketUrl(row, baseUrl),
    source: "local" as const,
    localId: row.id,
    syncStatus: row.sync_status,
    syncError: row.sync_error ?? undefined,
  };
}

function localTicketDetail(row: LocalTicketRow, baseUrl?: string) {
  return {
    key: localTicketKey(row),
    summary: row.title,
    status: row.status,
    priority: row.priority ?? undefined,
    assignee: row.assignee ?? undefined,
    reporter: undefined,
    type: row.type,
    created: row.created_at,
    updated: row.updated_at,
    labels: localLabels(row),
    description: row.description,
    url: localTicketUrl(row, baseUrl),
    source: "local" as const,
    localId: row.id,
    syncStatus: row.sync_status,
    syncError: row.sync_error ?? undefined,
  };
}

async function listTicketsHandler(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);

  const locals = await listLocalTickets(projectId);
  const ctx = await integrationContext(projectId, "jira");
  if (!ctx) {
    return json({ configured: false, tickets: locals.map((row) => localTicketSummary(row)) });
  }

  const parsed = JiraConfig.safeParse(ctx.config);
  if (!parsed.success) {
    return json({
      configured: true,
      error: "Konfigurasi Jira tidak valid.",
      tickets: locals.map((row) => localTicketSummary(row)),
    });
  }

  try {
    const remote = await listTickets(parsed.data);
    const remoteKeys = new Set(remote.map((ticket) => ticket.key));
    const pending = locals
      .filter((row) => !row.jira_key || !remoteKeys.has(row.jira_key))
      .map((row) => localTicketSummary(row, parsed.data.baseUrl));
    return json({ configured: true, tickets: [...pending, ...remote] });
  } catch (error) {
    return json({
      configured: true,
      error: (error as Error).message,
      tickets: locals.map((row) => localTicketSummary(row, parsed.data.baseUrl)),
    });
  }
}

async function createLocalTicketHandler(projectId: string, req: Request): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);

  const parsed = LocalTicketInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const ticket = await createLocalTicket(projectId, parsed.data);
  await record("ticket.created_local", { projectId, id: ticket.id });
  return json({ ticket: localTicketDetail(ticket) }, 201);
}

async function getLocalTicketHandler(projectId: string, id: string): Promise<Response> {
  const ticket = await getLocalTicket(id);
  if (!ticket || ticket.project_id !== projectId) {
    return json({ error: "ticket_not_found" }, 404);
  }
  return json({ ticket: localTicketDetail(ticket) });
}

async function updateLocalTicketHandler(
  projectId: string,
  id: string,
  req: Request,
): Promise<Response> {
  const ticket = await getLocalTicket(id);
  if (!ticket || ticket.project_id !== projectId) {
    return json({ error: "ticket_not_found" }, 404);
  }
  const parsed = LocalTicketUpdateInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const updated = await updateLocalTicket(id, parsed.data);
  return json({ ticket: updated ? localTicketDetail(updated) : null });
}

async function deleteLocalTicketHandler(projectId: string, id: string): Promise<Response> {
  const ticket = await getLocalTicket(id);
  if (!ticket || ticket.project_id !== projectId) {
    return json({ error: "ticket_not_found" }, 404);
  }
  await deleteLocalTicket(id);
  await record("ticket.deleted_local", { projectId, id });
  return json({ ok: true });
}

async function syncLocalTicketHandler(projectId: string, id: string): Promise<Response> {
  const ticket = await getLocalTicket(id);
  if (!ticket || ticket.project_id !== projectId) {
    return json({ error: "ticket_not_found" }, 404);
  }
  if (ticket.jira_key) {
    return json({ ticket: localTicketDetail(ticket) });
  }

  const ctx = await integrationContext(projectId, "jira");
  if (!ctx) return json({ error: "Integrasi Jira belum dikonfigurasi." }, 400);
  const parsed = JiraConfig.safeParse(ctx.config);
  if (!parsed.success) return json({ error: "Konfigurasi Jira tidak valid." }, 400);

  try {
    const created = await createTicket(parsed.data, {
      summary: ticket.title,
      description: ticket.description,
      type: ticket.type,
      priority: ticket.priority ?? undefined,
      labels: localLabels(ticket),
    });
    await markLocalTicketSynced(ticket.id, created.key);
    const updated = (await getLocalTicket(ticket.id))!;
    await record("ticket.synced", { projectId, id, key: created.key });
    return json({ ticket: localTicketDetail(updated, parsed.data.baseUrl) });
  } catch (error) {
    const message = (error as Error).message;
    await markLocalTicketSyncError(ticket.id, message);
    return json({ error: message }, 502);
  }
}

async function getTicketHandler(projectId: string, key: string): Promise<Response> {
  const ctx = await integrationContext(projectId, "jira");
  if (!ctx) return json({ error: "not_configured" }, 400);
  const parsed = JiraConfig.safeParse(ctx.config);
  if (!parsed.success) return json({ error: "invalid_config" }, 400);
  try {
    return json({ ticket: await getTicket(parsed.data, key) });
  } catch (error) {
    return json({ error: (error as Error).message }, 502);
  }
}

async function transitionTicketHandler(
  projectId: string,
  key: string,
  req: Request,
): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);

  const ctx = await integrationContext(projectId, "jira");
  if (!ctx) return json({ error: "not_configured" }, 400);
  const parsed = JiraConfig.safeParse(ctx.config);
  if (!parsed.success) return json({ error: "invalid_config" }, 400);

  const body = (await readJson(req)) as { status?: string };
  if (!body?.status) return json({ error: "status_required" }, 400);

  try {
    await transitionTicket(parsed.data, key, body.status);
    await record("ticket.transitioned", { key, status: body.status });
    return json({ ok: true });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}

export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method.toUpperCase();

  try {
    if (pathname === "/api/skills" && method === "GET") {
      return await skillsHandler(url.searchParams.get("projectId"));
    }

    if (pathname === "/api/settings/skills" && (method === "PUT" || method === "POST")) {
      return await saveSkillsSettingsHandler(req);
    }

    if (pathname === "/api/settings/mcp/tools" && method === "POST") {
      return await listMcpToolsHandler(req);
    }

    if (pathname === "/api/settings/mcp") {
      if (method === "GET") return await getMcpSettingsHandler();
      if (method === "PUT" || method === "POST") return await saveMcpSettingsHandler(req);
    }

    if (pathname === "/api/health" && method === "GET") {
      return json({ ok: true, name: "rnd-workflow", version: VERSION, dataDir: appDataDir() });
    }

    if (pathname.startsWith("/api/") && !isAuthorized(req)) {
      return json({ error: "unauthorized" }, 401);
    }

    if (pathname === "/api/events" && method === "GET") return sse(req);

    if (pathname === "/api/events/recent" && method === "GET") {
      return json({ events: await recentEvents(50) });
    }

    if (pathname === "/api/projects") {
      if (method === "GET") return json({ projects: await listProjects() });
      if (method === "POST") return await createProjectHandler(req);
    }

    const detail = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (detail && method === "GET") return await getProjectDetail(detail[1]);
    if (detail && method === "PUT") return await updateProjectHandler(detail[1], req);

    const files = pathname.match(/^\/api\/projects\/([^/]+)\/files$/);
    if (files && method === "GET") {
      return await listFilesHandler(files[1], url.searchParams.get("path") ?? "");
    }

    const fileContent = pathname.match(/^\/api\/projects\/([^/]+)\/files\/content$/);
    if (fileContent && method === "GET") {
      return await fileContentHandler(fileContent[1], url.searchParams.get("path") ?? "");
    }
    if (fileContent && (method === "PUT" || method === "POST")) {
      return await writeFileHandler(fileContent[1], req);
    }

    const localDocContent = pathname.match(
      /^\/api\/projects\/([^/]+)\/local-documents\/content$/,
    );
    if (localDocContent && method === "GET") {
      const path = url.searchParams.get("path") ?? "";
      return await getLocalDocumentHandler(localDocContent[1], path);
    }

    const localDocSync = pathname.match(/^\/api\/projects\/([^/]+)\/local-documents\/sync$/);
    if (localDocSync && method === "POST") {
      return await syncLocalDocumentHandler(localDocSync[1], req);
    }

    const localDocs = pathname.match(/^\/api\/projects\/([^/]+)\/local-documents$/);
    if (localDocs) {
      if (method === "GET") return await listLocalDocumentsHandler(localDocs[1]);
      if (method === "POST") return await createLocalDocumentHandler(localDocs[1], req);
      if (method === "PUT" || method === "PATCH") {
        return await updateLocalDocumentHandler(localDocs[1], req);
      }
    }

    const documents = pathname.match(/^\/api\/projects\/([^/]+)\/documents$/);
    if (documents) {
      if (method === "GET") {
        return await listDocumentsHandler(
          documents[1],
          url.searchParams.get("pageId") ?? undefined,
        );
      }
      if (method === "POST") return await createDocumentHandler(documents[1], req);
    }

    const documentItem = pathname.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)$/);
    if (documentItem) {
      if (method === "GET") return await getDocumentHandler(documentItem[1], documentItem[2]);
      if (method === "PUT") {
        return await updateDocumentHandler(documentItem[1], documentItem[2], req);
      }
    }

    const generateTickets = pathname.match(/^\/api\/projects\/([^/]+)\/generate-tickets$/);
    if (generateTickets && method === "POST") {
      return await generateTicketsHandler(generateTickets[1], req);
    }

    const localTicketSync = pathname.match(
      /^\/api\/projects\/([^/]+)\/local-tickets\/([^/]+)\/sync$/,
    );
    if (localTicketSync && method === "POST") {
      return await syncLocalTicketHandler(localTicketSync[1], localTicketSync[2]);
    }

    const localTickets = pathname.match(/^\/api\/projects\/([^/]+)\/local-tickets$/);
    if (localTickets && method === "POST") {
      return await createLocalTicketHandler(localTickets[1], req);
    }

    const localTicketItem = pathname.match(/^\/api\/projects\/([^/]+)\/local-tickets\/([^/]+)$/);
    if (localTicketItem) {
      if (method === "GET") {
        return await getLocalTicketHandler(localTicketItem[1], localTicketItem[2]);
      }
      if (method === "PATCH" || method === "PUT") {
        return await updateLocalTicketHandler(localTicketItem[1], localTicketItem[2], req);
      }
      if (method === "DELETE") {
        return await deleteLocalTicketHandler(localTicketItem[1], localTicketItem[2]);
      }
    }

    const tickets = pathname.match(/^\/api\/projects\/([^/]+)\/tickets$/);
    if (tickets && method === "GET") return await listTicketsHandler(tickets[1]);

    const ticketItem = pathname.match(/^\/api\/projects\/([^/]+)\/tickets\/([^/]+)$/);
    if (ticketItem && method === "GET") {
      return await getTicketHandler(ticketItem[1], ticketItem[2]);
    }

    const ticketTransition = pathname.match(
      /^\/api\/projects\/([^/]+)\/tickets\/([^/]+)\/transition$/,
    );
    if (ticketTransition && method === "POST") {
      return await transitionTicketHandler(ticketTransition[1], ticketTransition[2], req);
    }

    const llmList = pathname.match(/^\/api\/projects\/([^/]+)\/llm$/);
    if (llmList) {
      if (method === "GET") {
        return json({ providers: (await listLlmProviders(llmList[1])).map(serializeLlm) });
      }
      if (method === "POST") return await createLlmHandler(llmList[1], req);
    }

    const llmItem = pathname.match(/^\/api\/projects\/([^/]+)\/llm\/([^/]+)$/);
    if (llmItem) {
      if (method === "PUT" || method === "POST") {
        return await updateLlmHandler(llmItem[1], llmItem[2], req);
      }
      if (method === "DELETE") return await deleteLlmHandler(llmItem[1], llmItem[2]);
    }

    const chatSessions = pathname.match(/^\/api\/projects\/([^/]+)\/chat\/sessions$/);
    if (chatSessions && method === "GET") {
      return await listChatSessionsHandler(chatSessions[1]);
    }

    const chatSession = pathname.match(/^\/api\/projects\/([^/]+)\/chat\/sessions\/([^/]+)$/);
    if (chatSession) {
      if (method === "GET") return await getChatSessionHandler(chatSession[1], chatSession[2]);
      if (method === "DELETE") {
        return await deleteChatSessionHandler(chatSession[1], chatSession[2]);
      }
    }

    const chatRoute = pathname.match(/^\/api\/projects\/([^/]+)\/chat$/);
    if (chatRoute && method === "POST") return await chatHandler(chatRoute[1], req);

    if (pathname === "/api/chat/approve" && method === "POST") {
      return await chatApproveHandler(req);
    }

    const integration = pathname.match(/^\/api\/projects\/([^/]+)\/integrations\/([a-z]+)$/);
    if (integration && (method === "PUT" || method === "POST")) {
      return await upsertIntegrationHandler(integration[1], integration[2] as IntegrationKind, req);
    }

    if (pathname === "/api/integrations/test" && method === "POST") {
      return await testIntegrationHandler(req);
    }

    if (pathname.startsWith("/api/")) {
      return json({ error: "not_found", path: pathname }, 404);
    }

    if (method === "GET" || method === "HEAD") {
      const asset = serveAsset(pathname);
      if (asset) {
        if ((asset.headers.get("content-type") ?? "").startsWith("text/html")) {
          const headers = new Headers(asset.headers);
          headers.append(
            "set-cookie",
            `${APP_TOKEN_COOKIE}=${appToken()}; Path=/; SameSite=Strict`,
          );
          return new Response(asset.body, { status: asset.status, headers });
        }
        return asset;
      }
    }

    return json({ error: "not_found", path: pathname }, 404);
  } catch (error) {
    log.error("request failed", { path: pathname, error: String(error) });
    return json({ error: "internal_error", message: (error as Error).message }, 500);
  }
}
