import {
  AutoskillsInput,
  ChatChangeAllInput,
  ChatChangeInput,
  ChatInput,
  ConfluenceConfig,
  CreateDocumentInput,
  DocumentSource,
  type DocumentSource as DocumentSourceType,
  DocmostConfig,
  GenerateTicketsInput,
  GitCheckoutInput,
  GitCommitInput,
  GitPathsInput,
  IntegrationInput,
  type IntegrationKind,
  JiraConfig,
  LocalDocumentInput,
  LocalDocumentSyncInput,
  LocalDocumentUpdateInput,
  LocalTicketInput,
  LocalTicketUpdateInput,
  NotionConfig,
  parseIntegrationConfig,
  ProjectInput,
  ProjectUpdateInput,
  TicketTransitionInput,
  UpdateDocumentInput,
  UpdateFileInput,
} from "../config/schema.ts";
import { log } from "../core/logger.ts";
import {
  createLocalTicket,
  createProject,
  deleteChatSession,
  deleteLocalTicket,
  getChatSession,
  getIntegration,
  getLlmProvider,
  getLocalDocumentMeta,
  getLocalTicket,
  getProject,
  getRole,
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
import {
  checkGitRepository,
  checkoutBranch,
  commit as gitCommit,
  getDiff as gitDiff,
  getStatus as gitStatus,
  listBranches as gitBranches,
  listCommits as gitLog,
  stagePaths as gitStage,
  unstagePaths as gitUnstage,
} from "../integrations/git.ts";
import { listDirectory, readWorkspaceFile, writeWorkspaceFile } from "../fs/workspace.ts";
import {
  getDocument as getConfluenceDocument,
  listDocuments as listConfluenceDocuments,
} from "../integrations/confluence.ts";
import {
  createDocument,
  getDocument,
  listDocuments,
  updateDocument,
} from "../integrations/docmost.ts";
import {
  getDocument as getNotionDocument,
  listDocuments as listNotionDocuments,
} from "../integrations/notion.ts";
import { createTicket, getTicket, listTickets, transitionTicket } from "../integrations/jira.ts";
import {
  decideAllChatChanges,
  decideChatChange,
  generateTicketsFromDocument,
  startChat,
  type VisibleMessage,
} from "./chat.ts";
import { testIntegration } from "../integrations/index.ts";
import {
  HttpError,
  isAuthorized,
  isMaskedSecret,
  json,
  mergeConfigSecrets,
  readJson,
  record,
} from "./http.ts";
import {
  createLlmHandler,
  deleteLlmHandler,
  listLlmHandler,
  updateLlmHandler,
} from "./routes/llm.ts";
import {
  createRoleHandler,
  deleteRoleHandler,
  listRolesHandler,
  updateRoleHandler,
} from "./routes/roles.ts";
import {
  getAutomationSettingsHandler,
  getMcpSettingsHandler,
  listMcpToolsHandler,
  saveAutomationSettingsHandler,
  saveMcpSettingsHandler,
  saveSkillsSettingsHandler,
  skillsHandler,
} from "./routes/settings.ts";
import { runAutoskills } from "./autoskills.ts";
import { serializeIntegration } from "./serializers.ts";
import { APP_TOKEN_COOKIE, appToken } from "./session.ts";
import { sse } from "./sse.ts";
import { serveAsset } from "./static.ts";
import { handleTerminal } from "./terminal.ts";

export { SECRET_MASK } from "./http.ts";

const VERSION = "0.1.0";

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

  const existing = await getIntegration(projectId, kind);
  let existingConfig: Record<string, unknown> = {};
  if (existing) {
    try {
      existingConfig = JSON.parse(existing.config) as Record<string, unknown>;
    } catch {
      existingConfig = {};
    }
  }
  const config = mergeConfigSecrets(parsed.data.config, existingConfig);
  const kindParsed = parseIntegrationConfig(kind, config);
  if (!kindParsed.success) {
    return json({ error: "invalid_config", issues: kindParsed.error.issues }, 400);
  }

  const integration = await upsertIntegration({
    id: existing?.id ?? crypto.randomUUID(),
    projectId,
    kind,
    mode: parsed.data.mode,
    config: kindParsed.data as Record<string, unknown>,
  });
  await record("integration.saved", { projectId, kind });
  return json({ integration: serializeIntegration(integration) });
}

async function getProjectDetail(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const integrations = (await listIntegrations(project.id)).map(serializeIntegration);
  return json({ project, integrations });
}

async function autoskillsHandler(projectId: string, req: Request): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const workspace = project.workspace_path?.trim();
  if (!workspace) {
    return json({
      ok: false,
      dryRun: false,
      output: "",
      skills: [],
      error: "workspace_path belum diatur (Project Settings → Workspace).",
    }, 400);
  }

  const body = await readJson(req).catch(() => ({}));
  const parsed = AutoskillsInput.safeParse(body ?? {});
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  const result = await runAutoskills(workspace, {
    dryRun: parsed.data.dryRun,
    projectName: project.name,
    projectId: project.id,
  });
  await record("skills.autoskills", {
    projectId,
    ok: result.ok,
    dryRun: result.dryRun,
    count: result.skills.length,
  });
  return json(result, result.ok ? 200 : 502);
}

async function chatHandler(projectId: string, req: Request): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);

  const parsed = ChatInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  const role = parsed.data.roleId ? await getRole(parsed.data.roleId) : null;
  let provider = parsed.data.providerId ? await getLlmProvider(parsed.data.providerId) : null;
  if (role?.provider_id) {
    provider = (await getLlmProvider(role.provider_id)) ?? provider;
  }
  if (!provider) provider = (await listLlmProviders())[0] ?? null;
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
    role?.persona,
    parsed.data.skillName,
  );
  if (result.status === "error" && result.error === "unknown_skill") {
    return json(
      {
        error: "unknown_skill",
        message: `Skill tidak ditemukan: ${parsed.data.skillName}`,
        skillName: parsed.data.skillName,
      },
      400,
    );
  }
  await record("chat.message", {
    projectId,
    providerId: provider.id,
    skillName: parsed.data.skillName ?? null,
  });
  return json(result);
}

async function chatChangeHandler(req: Request): Promise<Response> {
  const parsed = ChatChangeInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const result = await decideChatChange(
    parsed.data.runId,
    parsed.data.callId,
    parsed.data.hunk,
    parsed.data.accept,
  );
  return json(result);
}

async function chatChangeAllHandler(req: Request): Promise<Response> {
  const parsed = ChatChangeAllInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const result = await decideAllChatChanges(parsed.data.runId, parsed.data.accept);
  return json(result);
}

function parseChanges(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    log.debug("corrupt chat changes JSON", { error: String(error) });
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
    const meta = await getLocalDocumentMeta(projectId, doc.path);
    return json({ document: { ...doc, ...localDocumentPayload(doc, meta ?? undefined) } });
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
    const meta = await getLocalDocumentMeta(projectId, doc.path);
    return json({ document: { ...doc, ...localDocumentPayload(doc, meta ?? undefined) } });
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

  let pageId = "";
  try {
    const doc = await readLocalDocument(root, parsed.data.path);
    const meta = await getLocalDocumentMeta(projectId, doc.path);
    pageId = meta?.page_id ?? "";

    if (!pageId) {
      const created = await createDocument(parsedCfg.data, { spaceId, title: doc.title });
      pageId = created.id;
      await markLocalDocumentSynced(projectId, doc.path, pageId);
    }

    await updateDocument(parsedCfg.data, {
      pageId,
      title: doc.title,
      content: doc.content,
    });

    await markLocalDocumentSynced(projectId, doc.path, pageId);
    await record("document.synced", { projectId, path: doc.path, pageId });
    const updatedMeta = await getLocalDocumentMeta(projectId, doc.path);
    return json({ document: { ...doc, ...localDocumentPayload(doc, updatedMeta ?? undefined) } });
  } catch (error) {
    const message = (error as Error).message;
    if (pageId) await markLocalDocumentSynced(projectId, parsed.data.path, pageId);
    await markLocalDocumentSyncError(projectId, parsed.data.path, message);
    return json({ error: message }, 502);
  }
}

async function gitCwd(projectId: string): Promise<string | Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const workspace = project.workspace_path?.trim();
  if (!workspace) return json({ error: "Workspace project belum diatur." }, 400);
  const check = await checkGitRepository(workspace);
  if (!check.ok) {
    return json({ error: check.error ?? "Workspace bukan git repository." }, 400);
  }
  return check.cwd;
}

async function gitStatusHandler(projectId: string): Promise<Response> {
  const cwd = await gitCwd(projectId);
  if (cwd instanceof Response) return cwd;
  try {
    return json({ status: await gitStatus(cwd) });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}

async function gitBranchesHandler(projectId: string): Promise<Response> {
  const cwd = await gitCwd(projectId);
  if (cwd instanceof Response) return cwd;
  try {
    return json({ branches: await gitBranches(cwd) });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}

async function gitLogHandler(projectId: string, limit: number): Promise<Response> {
  const cwd = await gitCwd(projectId);
  if (cwd instanceof Response) return cwd;
  try {
    return json({ commits: await gitLog(cwd, Math.min(Math.max(limit, 1), 200)) });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}

async function gitDiffHandler(
  projectId: string,
  path: string,
  staged: boolean,
): Promise<Response> {
  const cwd = await gitCwd(projectId);
  if (cwd instanceof Response) return cwd;
  if (!path) return json({ error: "path_required" }, 400);
  try {
    return json({ diff: await gitDiff(cwd, path, staged) });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}

async function gitPathsHandler(
  projectId: string,
  req: Request,
  action: "stage" | "unstage",
): Promise<Response> {
  const cwd = await gitCwd(projectId);
  if (cwd instanceof Response) return cwd;
  const parsed = GitPathsInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  try {
    if (action === "stage") await gitStage(cwd, parsed.data.paths);
    else await gitUnstage(cwd, parsed.data.paths);
    await record(`git.${action}`, { projectId, count: parsed.data.paths.length });
    return json({ ok: true });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}

async function gitCommitHandler(projectId: string, req: Request): Promise<Response> {
  const cwd = await gitCwd(projectId);
  if (cwd instanceof Response) return cwd;
  const parsed = GitCommitInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  try {
    const output = await gitCommit(cwd, parsed.data.message);
    await record("git.committed", { projectId });
    return json({ ok: true, output });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}

async function gitCheckoutHandler(projectId: string, req: Request): Promise<Response> {
  const cwd = await gitCwd(projectId);
  if (cwd instanceof Response) return cwd;
  const parsed = GitCheckoutInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  try {
    await checkoutBranch(cwd, parsed.data.branch);
    await record("git.checkout", { projectId, branch: parsed.data.branch });
    return json({ ok: true });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}

async function terminalHandler(projectId: string, req: Request): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  if (!project.workspace_path) {
    return json({ error: "workspace_required" }, 400);
  }
  try {
    return handleTerminal(req, project.workspace_path);
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
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
  if (!provider) provider = (await listLlmProviders())[0] ?? null;
  if (!provider) return json({ error: "Belum ada provider LLM." }, 400);

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

async function testIntegrationHandler(req: Request): Promise<Response> {
  const body = await readJson(req) as Record<string, unknown>;
  const parsed = IntegrationInput.safeParse(body);
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  let config = { ...parsed.data.config };
  const projectId = typeof body.projectId === "string" ? body.projectId : null;
  if (projectId && parsed.data.kind !== "llm") {
    const existing = await getIntegration(projectId, parsed.data.kind as IntegrationKind);
    if (existing) {
      let existingConfig: Record<string, unknown> = {};
      try {
        existingConfig = JSON.parse(existing.config) as Record<string, unknown>;
      } catch {
        existingConfig = {};
      }
      config = mergeConfigSecrets(config, existingConfig);
    }
  }
  if (parsed.data.kind === "llm") {
    const providerId = typeof config.providerId === "string" ? config.providerId : null;
    delete config.providerId;
    if (providerId && isMaskedSecret(config.apiKey)) {
      const existing = await getLlmProvider(providerId);
      if (existing?.api_key) config.apiKey = existing.api_key;
    }
  }

  const result = await testIntegration({ ...parsed.data, config });
  await record("integration.tested", { kind: parsed.data.kind, ok: result.ok });
  return json({ result });
}

async function integrationContext(
  projectId: string,
  kind: "docmost" | "notion" | "confluence" | "jira",
) {
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

function parseDocumentSource(raw: string | null): DocumentSourceType {
  const parsed = DocumentSource.safeParse(raw ?? "docmost");
  return parsed.success ? parsed.data : "docmost";
}

async function listDocumentsHandler(
  projectId: string,
  source: DocumentSourceType,
  pageId?: string,
): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const ctx = await integrationContext(projectId, source);
  if (!ctx) return json({ configured: false, documents: [], source });

  try {
    if (source === "notion") {
      const parsed = NotionConfig.safeParse(ctx.config);
      if (!parsed.success) {
        return json({
          configured: true,
          source,
          error: "Konfigurasi Notion tidak valid.",
          documents: [],
        });
      }
      const { documents, sample } = await listNotionDocuments(parsed.data, pageId);
      return json({
        configured: true,
        source,
        documents,
        ...(documents.length === 0 && !pageId ? { debug: sample } : {}),
      });
    }
    if (source === "confluence") {
      const parsed = ConfluenceConfig.safeParse(ctx.config);
      if (!parsed.success) {
        return json({
          configured: true,
          source,
          error: "Konfigurasi Confluence tidak valid.",
          documents: [],
        });
      }
      const { documents, sample } = await listConfluenceDocuments(parsed.data, pageId);
      return json({
        configured: true,
        source,
        documents,
        ...(documents.length === 0 && !pageId ? { debug: sample } : {}),
      });
    }

    const parsed = DocmostConfig.safeParse(ctx.config);
    if (!parsed.success) {
      return json({
        configured: true,
        source,
        error: "Konfigurasi Docmost tidak valid.",
        documents: [],
      });
    }
    const spaceId = parsed.data.spaceId ?? project.docmost_space_id ?? undefined;
    const { documents, sample } = await listDocuments(parsed.data, spaceId, pageId);
    return json({
      configured: true,
      source,
      documents,
      ...(documents.length === 0 && !pageId ? { debug: sample } : {}),
    });
  } catch (error) {
    return json({ configured: true, source, error: (error as Error).message, documents: [] });
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

async function getDocumentHandler(
  projectId: string,
  pageId: string,
  source: DocumentSourceType,
): Promise<Response> {
  const ctx = await integrationContext(projectId, source);
  if (!ctx) return json({ error: "not_configured" }, 400);

  try {
    if (source === "notion") {
      const parsed = NotionConfig.safeParse(ctx.config);
      if (!parsed.success) return json({ error: "invalid_config" }, 400);
      return json({ document: await getNotionDocument(parsed.data, pageId), source });
    }
    if (source === "confluence") {
      const parsed = ConfluenceConfig.safeParse(ctx.config);
      if (!parsed.success) return json({ error: "invalid_config" }, 400);
      return json({ document: await getConfluenceDocument(parsed.data, pageId), source });
    }
    const parsed = DocmostConfig.safeParse(ctx.config);
    if (!parsed.success) return json({ error: "invalid_config" }, 400);
    return json({ document: await getDocument(parsed.data, pageId), source });
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
  if (ticket.jira_key) {
    return json({ error: "Tiket sudah synced ke Jira; hapus lewat Jira." }, 400);
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

  const body = TicketTransitionInput.safeParse(await readJson(req));
  if (!body.success) {
    return json({ error: "invalid_input", issues: body.error.issues }, 400);
  }

  try {
    await transitionTicket(parsed.data, key, body.data.status);
    await record("ticket.transitioned", { key, status: body.data.status });
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
    if (pathname === "/api/health" && method === "GET") {
      return json({ ok: true, name: "rnd-workflow", version: VERSION });
    }

    if (pathname.startsWith("/api/") && !isAuthorized(req)) {
      return json({ error: "unauthorized" }, 401);
    }

    if (pathname === "/api/skills" && method === "GET") {
      return await skillsHandler(url.searchParams.get("projectId"));
    }

    if (pathname === "/api/settings/skills" && (method === "PUT" || method === "POST")) {
      return await saveSkillsSettingsHandler(req);
    }

    if (pathname === "/api/settings/automation") {
      if (method === "GET") return await getAutomationSettingsHandler();
      if (method === "PUT" || method === "POST") return await saveAutomationSettingsHandler(req);
    }

    if (pathname === "/api/settings/mcp/tools" && method === "POST") {
      return await listMcpToolsHandler(req);
    }

    if (pathname === "/api/settings/mcp") {
      if (method === "GET") return await getMcpSettingsHandler();
      if (method === "PUT" || method === "POST") return await saveMcpSettingsHandler(req);
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

    const gitStatus = pathname.match(/^\/api\/projects\/([^/]+)\/git\/status$/);
    if (gitStatus && method === "GET") return await gitStatusHandler(gitStatus[1]);

    const gitBranches = pathname.match(/^\/api\/projects\/([^/]+)\/git\/branches$/);
    if (gitBranches && method === "GET") return await gitBranchesHandler(gitBranches[1]);

    const gitLog = pathname.match(/^\/api\/projects\/([^/]+)\/git\/log$/);
    if (gitLog && method === "GET") {
      return await gitLogHandler(gitLog[1], Number(url.searchParams.get("limit") ?? 50));
    }

    const gitDiff = pathname.match(/^\/api\/projects\/([^/]+)\/git\/diff$/);
    if (gitDiff && method === "GET") {
      const staged = url.searchParams.get("staged") === "1" ||
        url.searchParams.get("staged") === "true";
      return await gitDiffHandler(gitDiff[1], url.searchParams.get("path") ?? "", staged);
    }

    const gitStage = pathname.match(/^\/api\/projects\/([^/]+)\/git\/(stage|unstage)$/);
    if (gitStage && method === "POST") {
      return await gitPathsHandler(
        gitStage[1],
        req,
        gitStage[2] === "stage" ? "stage" : "unstage",
      );
    }

    const gitCommitRoute = pathname.match(/^\/api\/projects\/([^/]+)\/git\/commit$/);
    if (gitCommitRoute && method === "POST") {
      return await gitCommitHandler(gitCommitRoute[1], req);
    }

    const gitCheckout = pathname.match(/^\/api\/projects\/([^/]+)\/git\/checkout$/);
    if (gitCheckout && method === "POST") {
      return await gitCheckoutHandler(gitCheckout[1], req);
    }

    const terminal = pathname.match(/^\/api\/projects\/([^/]+)\/terminal$/);
    if (terminal && method === "GET") return await terminalHandler(terminal[1], req);

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
          parseDocumentSource(url.searchParams.get("source")),
          url.searchParams.get("pageId") ?? undefined,
        );
      }
      if (method === "POST") return await createDocumentHandler(documents[1], req);
    }

    const documentItem = pathname.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)$/);
    if (documentItem) {
      if (method === "GET") {
        return await getDocumentHandler(
          documentItem[1],
          decodeURIComponent(documentItem[2]),
          parseDocumentSource(url.searchParams.get("source")),
        );
      }
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

    if (pathname === "/api/roles") {
      if (method === "GET") return await listRolesHandler();
      if (method === "POST") return await createRoleHandler(req);
    }

    const roleItem = pathname.match(/^\/api\/roles\/([^/]+)$/);
    if (roleItem) {
      if (method === "PUT" || method === "POST") return await updateRoleHandler(roleItem[1], req);
      if (method === "DELETE") return await deleteRoleHandler(roleItem[1]);
    }

    if (pathname === "/api/llm") {
      if (method === "GET") return await listLlmHandler();
      if (method === "POST") return await createLlmHandler(req);
    }

    const llmItem = pathname.match(/^\/api\/llm\/([^/]+)$/);
    if (llmItem) {
      if (method === "PUT" || method === "POST") {
        return await updateLlmHandler(llmItem[1], req);
      }
      if (method === "DELETE") return await deleteLlmHandler(llmItem[1]);
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

    const autoskillsRoute = pathname.match(/^\/api\/projects\/([^/]+)\/autoskills$/);
    if (autoskillsRoute && method === "POST") {
      return await autoskillsHandler(autoskillsRoute[1], req);
    }

    if (pathname === "/api/chat/change" && method === "POST") {
      return await chatChangeHandler(req);
    }

    if (pathname === "/api/chat/change-all" && method === "POST") {
      return await chatChangeAllHandler(req);
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
          // Desktop serves http://127.0.0.1 — omit Secure. Add "; Secure" if ever TLS.
          headers.append(
            "set-cookie",
            `${APP_TOKEN_COOKIE}=${appToken()}; Path=/; SameSite=Strict; HttpOnly`,
          );
          return new Response(asset.body, { status: asset.status, headers });
        }
        return asset;
      }
    }

    return json({ error: "not_found", path: pathname }, 404);
  } catch (error) {
    if (error instanceof HttpError) return json(error.body, error.status);
    log.error("request failed", { path: pathname, error: String(error) });
    return json({ error: "internal_error", message: (error as Error).message }, 500);
  }
}
