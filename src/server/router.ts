import {
  AutoskillsInput,
  ChatChangeAllInput,
  ChatChangeInput,
  ChatInput,
  ClickUpConfig,
  ConfluenceConfig,
  CreateDocumentInput,
  CreateWorkspacePathInput,
  DocmostConfig,
  DocumentSource,
  type DocumentSource as DocumentSourceType,
  GenerateTicketsInput,
  GitBranchCreateInput,
  GitCheckoutInput,
  GitCloneInput,
  GitCommitInput,
  GitMergeInput,
  GitPathsInput,
  GitStashApplyInput,
  GitStashCreateInput,
  IntegrationInput,
  type IntegrationKind,
  JiraConfig,
  LocalDocumentInput,
  LocalDocumentSyncInput,
  LocalDocumentUpdateInput,
  LocalTicketInput,
  LocalTicketSyncInput,
  LocalTicketUpdateInput,
  NotionConfig,
  parseIntegrationConfig,
  ProjectInput,
  ProjectUpdateInput,
  type TicketProvider,
  TicketTransitionInput,
  UpdateDocumentInput,
  UpdateFileInput,
} from "../config/schema.ts";
import { log } from "../core/logger.ts";
import {
  appendChatMessage,
  createLocalTicket,
  createProject,
  deleteChatSession,
  deleteLocalTicket,
  deleteProject,
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
  markLocalTicketSynced,
  markLocalTicketSyncError,
  moveLocalDocumentMeta,
  recentEvents,
  updateLocalTicket,
  updateProject,
  upsertImportedCursorSession,
  upsertIntegration,
} from "../db/db.ts";
import {
  hydrateCursorConversation,
  listCloudCursorAgents,
  listLocalCursorAgents,
} from "./chat/cursor.ts";
import {
  createLocalDocument,
  listLocalDocuments,
  readLocalDocument,
  updateLocalDocument,
} from "../fs/documents.ts";
import {
  applyStash as gitApplyStash,
  checkGitRepository,
  checkoutBranch,
  cloneRepository,
  commit as gitCommit,
  createBranch as gitCreateBranch,
  createStash as gitCreateStash,
  fetchRemote as gitFetch,
  getDiff as gitDiff,
  getStatus as gitStatus,
  listBranches as gitBranches,
  listCommits as gitLog,
  listRemoteBranches as gitRemotes,
  listStashes as gitStashes,
  mergeBranch as gitMerge,
  pull as gitPull,
  push as gitPush,
  showCommit as gitShow,
  stagePaths as gitStage,
  unstagePaths as gitUnstage,
} from "../integrations/git.ts";
import {
  createWorkspaceDir,
  createWorkspaceFile,
  findInWorkspace,
  joinWorkspacePath,
  listDirectory,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "../fs/workspace.ts";
import {
  createDocument as createConfluenceDocument,
  getDocument as getConfluenceDocument,
  listDocuments as listConfluenceDocuments,
  updateDocument as updateConfluenceDocument,
} from "../integrations/confluence.ts";
import {
  createDocument,
  getDocument,
  listDocuments,
  updateDocument,
} from "../integrations/docmost.ts";
import {
  createDocument as createNotionDocument,
  getDocument as getNotionDocument,
  listDocuments as listNotionDocuments,
  updateDocument as updateNotionDocument,
} from "../integrations/notion.ts";
import { localDocumentPayload, syncLocalDocumentToTarget } from "./chat/document-tools.ts";
import {
  createTicket as createClickUpTicket,
  getTicket as getClickUpTicket,
  listTickets as listClickUpTickets,
  transitionTicket as transitionClickUpTicket,
} from "../integrations/clickup.ts";
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
  listCursorModelsHandler,
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
  cancelWorkflowRunHandler,
  createWorkflowHandler,
  deleteWorkflowHandler,
  deleteWorkflowRunHandler,
  getWorkflowHandler,
  getWorkflowRunHandler,
  listWorkflowRunsHandler,
  listWorkflowsHandler,
  patchWorkflowScheduleHandler,
  runWorkflowHandler,
  saveWorkflowHandler,
} from "./routes/workflows.ts";
import {
  getAutomationSettingsHandler,
  getChatToolsSettingsHandler,
  getLspSettingsHandler,
  getMcpSettingsHandler,
  getNotificationSettingsHandler,
  getPromptsHandler,
  getTerminalSettingsHandler,
  getUiPreferencesHandler,
  listMcpToolsHandler,
  probeLspHandler,
  saveAutomationSettingsHandler,
  saveChatToolsSettingsHandler,
  saveLspSettingsHandler,
  saveMcpSettingsHandler,
  saveNotificationSettingsHandler,
  savePromptsHandler,
  saveSkillsSettingsHandler,
  saveTerminalSettingsHandler,
  saveUiPreferencesHandler,
  skillsHandler,
  testNotificationSettingsHandler,
} from "./routes/settings.ts";
import { runAutoskills } from "./autoskills.ts";
import { handleLsp, matchLspServer, readLspSettings, resolveExecutable } from "./lsp.ts";
import { serializeIntegration } from "./serializers.ts";
import { APP_TOKEN_COOKIE, appToken } from "./session.ts";
import { sse } from "./sse.ts";
import { serveAsset } from "./static.ts";
import { handleTerminal, readTerminalShellSetting } from "./terminal.ts";

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

async function deleteProjectHandler(projectId: string): Promise<Response> {
  const existing = await getProject(projectId);
  if (!existing) return json({ error: "project_not_found" }, 404);
  const ok = await deleteProject(projectId);
  if (!ok) return json({ error: "project_not_found" }, 404);
  await record("project.deleted", { id: projectId, name: existing.name });
  return json({ ok: true });
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

async function fileIndexHandler(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  if (!project.workspace_path) return json({ error: "no_workspace" }, 400);
  try {
    return json(await listWorkspaceFiles(project.workspace_path));
  } catch (error) {
    return json({ files: [], truncated: false, error: (error as Error).message }, 400);
  }
}

async function findFilesHandler(projectId: string, url: URL): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  if (!project.workspace_path) return json({ error: "no_workspace" }, 400);
  const query = url.searchParams.get("q") ?? "";
  const matchCase = url.searchParams.get("case") === "1";
  const regex = url.searchParams.get("regex") === "1";
  try {
    return json(
      await findInWorkspace(project.workspace_path, query, {
        caseSensitive: matchCase,
        regex,
      }),
    );
  } catch (error) {
    return json(
      { matches: [], scanned: 0, truncated: false, error: (error as Error).message },
      400,
    );
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

async function createPathHandler(projectId: string, req: Request): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  if (!project.workspace_path) return json({ error: "no_workspace" }, 400);

  const parsed = CreateWorkspacePathInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  try {
    const path = joinWorkspacePath(parsed.data.parent ?? "", parsed.data.name);
    if (parsed.data.type === "dir") {
      await createWorkspaceDir(project.workspace_path, path);
      await record("file.dir_created", { projectId, path });
      return json({ ok: true, type: "dir", path }, 201);
    }
    await createWorkspaceFile(project.workspace_path, path, parsed.data.content ?? "");
    await record("file.created", { projectId, path });
    return json({ ok: true, type: "file", path }, 201);
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
  if (parsed.data.model) {
    provider = { ...provider, model: parsed.data.model };
  }

  const messages: VisibleMessage[] = parsed.data.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
      attachments: message.attachments,
    }));

  await record("chat.message", {
    projectId,
    providerId: provider.id,
    skillName: parsed.data.skillName ?? null,
  });

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        } catch {
          closed = true;
        }
      };
      const sendStep = (step: unknown) => send({ type: "step", step });
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode("\n"));
        } catch {
          closed = true;
        }
      }, 15_000);
      try {
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
          sendStep,
        );
        send({ type: "result", result });
      } catch (error) {
        send({
          type: "result",
          result: { status: "error", error: (error as Error).message },
        });
      } finally {
        if (heartbeat !== undefined) clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      closed = true;
      if (heartbeat !== undefined) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
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

async function findCursorLlmProvider() {
  const providers = await listLlmProviders();
  return providers.find((provider) =>
    (provider.provider || "").toLowerCase() === "cursor" && !!provider.api_key?.trim()
  ) ?? null;
}

async function importCursorAgentsIntoSessions(
  projectId: string,
  workspacePath: string | null,
  apiKey: string,
): Promise<void> {
  const imported: Array<{
    agentId: string;
    name: string;
    summary: string;
    lastModified: number;
    runtime: "local" | "cloud";
  }> = [];
  if (workspacePath?.trim()) {
    try {
      imported.push(...await listLocalCursorAgents(workspacePath.trim(), 40));
    } catch (error) {
      log.debug("cursor local agent import failed", { error: String(error), projectId });
    }
  }
  try {
    imported.push(...await listCloudCursorAgents(apiKey, 40));
  } catch (error) {
    log.debug("cursor cloud agent import failed", { error: String(error), projectId });
  }
  for (const agent of imported) {
    const base = agent.name || agent.summary || agent.agentId;
    const title = agent.runtime === "cloud" && !base.toLowerCase().includes("cloud")
      ? `Cloud · ${base}`
      : base;
    await upsertImportedCursorSession({
      projectId,
      cursorAgentId: agent.agentId,
      title,
      updatedAtMs: agent.lastModified,
    });
  }
}

async function listChatSessionsHandler(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const cursorProvider = await findCursorLlmProvider();
  if (cursorProvider?.api_key?.trim()) {
    await importCursorAgentsIntoSessions(
      projectId,
      project.workspace_path,
      cursorProvider.api_key.trim(),
    );
  }
  const sessions = (await listChatSessions(projectId)).map((session) => ({
    id: session.id,
    title: session.title,
    updatedAt: session.updated_at,
    source: session.source === "cursor" ? "cursor" : "app",
    cursorAgentId: session.cursor_agent_id ?? undefined,
  }));
  return json({ sessions });
}

async function getChatSessionHandler(projectId: string, sessionId: string): Promise<Response> {
  const session = await getChatSession(sessionId);
  if (!session || session.project_id !== projectId) {
    return json({ error: "session_not_found" }, 404);
  }
  let stored = await listChatMessages(session.id);
  const visible = stored.filter((message) =>
    message.role === "user" || message.role === "assistant"
  );
  if (session.cursor_agent_id && visible.length === 0) {
    const project = await getProject(projectId);
    const cursorProvider = await findCursorLlmProvider();
    try {
      const conversation = await hydrateCursorConversation(session.cursor_agent_id, {
        cwd: project?.workspace_path ?? null,
        apiKey: cursorProvider?.api_key ?? null,
      });
      for (const message of conversation) {
        await appendChatMessage(session.id, message.role, message.content, []);
      }
      if (conversation.length) stored = await listChatMessages(session.id);
    } catch (error) {
      log.debug("cursor session hydrate failed", { error: String(error), sessionId });
    }
  }
  const messages = stored
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: message.content,
      changes: parseChanges(message.changes),
    }));
  return json({
    session: {
      id: session.id,
      title: session.title,
      updatedAt: session.updated_at,
      source: session.source === "cursor" ? "cursor" : "app",
      cursorAgentId: session.cursor_agent_id ?? undefined,
    },
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
  const parsed = LocalDocumentSyncInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  try {
    const result = await syncLocalDocumentToTarget(
      projectId,
      parsed.data.path,
      parsed.data.target,
    );
    await record("document.synced", {
      projectId,
      path: parsed.data.path,
      target: parsed.data.target,
      pageId: result.document.pageId,
    });
    return json(result);
  } catch (error) {
    return json({ error: (error as Error).message }, 502);
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
    const [branches, remotes, stashes] = await Promise.all([
      gitBranches(cwd),
      gitRemotes(cwd),
      gitStashes(cwd),
    ]);
    return json({ branches, remotes, stashes });
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

async function gitShowHandler(projectId: string, hash: string): Promise<Response> {
  const cwd = await gitCwd(projectId);
  if (cwd instanceof Response) return cwd;
  if (!hash) return json({ error: "hash_required" }, 400);
  try {
    return json({ commit: await gitShow(cwd, hash) });
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

async function gitStashApplyHandler(projectId: string, req: Request): Promise<Response> {
  const cwd = await gitCwd(projectId);
  if (cwd instanceof Response) return cwd;
  const parsed = GitStashApplyInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  try {
    await gitApplyStash(cwd, parsed.data.index, parsed.data.pop);
    await record("git.stash_apply", {
      projectId,
      index: parsed.data.index,
      pop: parsed.data.pop,
    });
    return json({ ok: true });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}

async function gitSimpleActionHandler(
  projectId: string,
  action: "fetch" | "pull" | "push",
): Promise<Response> {
  const cwd = await gitCwd(projectId);
  if (cwd instanceof Response) return cwd;
  try {
    const output = action === "fetch"
      ? await gitFetch(cwd)
      : action === "pull"
      ? await gitPull(cwd)
      : await gitPush(cwd);
    await record(`git.${action}`, { projectId });
    return json({ ok: true, output });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}

async function gitCreateBranchHandler(projectId: string, req: Request): Promise<Response> {
  const cwd = await gitCwd(projectId);
  if (cwd instanceof Response) return cwd;
  const parsed = GitBranchCreateInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  try {
    await gitCreateBranch(cwd, parsed.data.name, parsed.data.checkout);
    await record("git.branch_create", { projectId, name: parsed.data.name });
    return json({ ok: true });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}

async function gitMergeHandler(projectId: string, req: Request): Promise<Response> {
  const cwd = await gitCwd(projectId);
  if (cwd instanceof Response) return cwd;
  const parsed = GitMergeInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  try {
    const output = await gitMerge(cwd, parsed.data.branch);
    await record("git.merge", { projectId, branch: parsed.data.branch });
    return json({ ok: true, output });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}

async function gitStashCreateHandler(projectId: string, req: Request): Promise<Response> {
  const cwd = await gitCwd(projectId);
  if (cwd instanceof Response) return cwd;
  const parsed = GitStashCreateInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  try {
    const output = await gitCreateStash(
      cwd,
      parsed.data.message,
      parsed.data.includeUntracked,
    );
    await record("git.stash_create", { projectId });
    return json({ ok: true, output });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}

async function gitCloneHandler(projectId: string, req: Request): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const workspace = project.workspace_path?.trim();
  if (!workspace) {
    return json({ error: "Workspace belum diatur. Set path workspace dulu." }, 400);
  }
  const parsed = GitCloneInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  try {
    const cloned = await cloneRepository(
      parsed.data.url,
      workspace,
      parsed.data.protocol,
    );
    await record("git.cloned", {
      projectId,
      path: cloned.path,
      url: cloned.url,
      protocol: parsed.data.protocol,
    });
    return json({ ok: true, path: cloned.path, output: cloned.output, project });
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
    const defaultShell = await readTerminalShellSetting();
    return handleTerminal(req, project.workspace_path, defaultShell);
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}

async function lspHandler(projectId: string, req: Request): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  if (!project.workspace_path) {
    return json({ error: "workspace_required" }, 400);
  }
  const url = new URL(req.url);
  const language = url.searchParams.get("language")?.trim().toLowerCase() ?? "";
  if (!language) return json({ error: "language_required" }, 400);

  const settings = await readLspSettings();
  if (!settings.enabled) return json({ error: "lsp_disabled" }, 400);
  const server = matchLspServer(settings, language);
  if (!server) return json({ error: "lsp_server_not_found", language }, 404);

  const command = await resolveExecutable(server.command);
  if (!command) {
    return json({
      error: "lsp_command_not_found",
      message: `Command LSP tidak ditemukan: ${server.command}`,
      command: server.command,
    }, 400);
  }

  try {
    return handleLsp(req, projectId, project.workspace_path, { ...server, command });
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
  kind: "docmost" | "notion" | "confluence" | "jira" | "clickup",
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

function looksLikeJiraKey(key: string): boolean {
  return /^[A-Z][A-Z0-9]+-\d+$/i.test(key);
}

async function resolveTicketProvider(
  projectId: string,
  preferred?: TicketProvider,
  keyHint?: string,
): Promise<TicketProvider | null> {
  if (preferred) return preferred;
  const jira = await integrationContext(projectId, "jira");
  const clickup = await integrationContext(projectId, "clickup");
  if (keyHint) {
    if (looksLikeJiraKey(keyHint) && jira) return "jira";
    if (!looksLikeJiraKey(keyHint) && clickup) return "clickup";
  }
  if (jira) return "jira";
  if (clickup) return "clickup";
  return null;
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

  const parsed = CreateDocumentInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const source = parsed.data.source;
  const ctx = await integrationContext(projectId, source);
  if (!ctx) return json({ error: "not_configured" }, 400);

  try {
    if (source === "notion") {
      const parsedCfg = NotionConfig.safeParse(ctx.config);
      if (!parsedCfg.success) return json({ error: "invalid_config" }, 400);
      const document = await createNotionDocument(parsedCfg.data, {
        title: parsed.data.title,
        parentPageId: parsed.data.parentPageId,
      });
      await record("document.created", { projectId, id: document.id, source });
      return json({ document, source }, 201);
    }
    if (source === "confluence") {
      const parsedCfg = ConfluenceConfig.safeParse(ctx.config);
      if (!parsedCfg.success) return json({ error: "invalid_config" }, 400);
      const document = await createConfluenceDocument(parsedCfg.data, {
        title: parsed.data.title,
        parentPageId: parsed.data.parentPageId,
      });
      await record("document.created", { projectId, id: document.id, source });
      return json({ document, source }, 201);
    }

    const parsedCfg = DocmostConfig.safeParse(ctx.config);
    if (!parsedCfg.success) return json({ error: "invalid_config" }, 400);
    const spaceId = parsedCfg.data.spaceId ?? project.docmost_space_id ?? undefined;
    if (!spaceId) return json({ error: "space_required" }, 400);
    const document = await createDocument(parsedCfg.data, {
      spaceId,
      title: parsed.data.title,
      parentPageId: parsed.data.parentPageId,
    });
    await record("document.created", { projectId, id: document.id, source });
    return json({ document, source }, 201);
  } catch (error) {
    return json({ error: (error as Error).message }, 502);
  }
}

async function updateDocumentHandler(
  projectId: string,
  pageId: string,
  req: Request,
  source: DocumentSourceType,
): Promise<Response> {
  const ctx = await integrationContext(projectId, source);
  if (!ctx) return json({ error: "not_configured" }, 400);

  const parsed = UpdateDocumentInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  try {
    if (source === "notion") {
      const parsedCfg = NotionConfig.safeParse(ctx.config);
      if (!parsedCfg.success) return json({ error: "invalid_config" }, 400);
      const document = await updateNotionDocument(parsedCfg.data, {
        pageId,
        title: parsed.data.title,
        content: parsed.data.content,
      });
      await record("document.updated", { projectId, id: pageId, source });
      return json({ document, source });
    }
    if (source === "confluence") {
      const parsedCfg = ConfluenceConfig.safeParse(ctx.config);
      if (!parsedCfg.success) return json({ error: "invalid_config" }, 400);
      const document = await updateConfluenceDocument(parsedCfg.data, {
        pageId,
        title: parsed.data.title,
        content: parsed.data.content,
      });
      await record("document.updated", { projectId, id: pageId, source });
      return json({ document, source });
    }

    const parsedCfg = DocmostConfig.safeParse(ctx.config);
    if (!parsedCfg.success) return json({ error: "invalid_config" }, 400);
    const document = await updateDocument(parsedCfg.data, {
      pageId,
      title: parsed.data.title,
      content: parsed.data.content,
    });
    await record("document.updated", { projectId, id: pageId, source });
    return json({ document, source });
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

function localTicketUrl(
  row: LocalTicketRow,
  bases?: { jira?: string; clickup?: string },
): string {
  if (!row.jira_key) return "";
  if (row.sync_provider === "clickup") {
    const base = (bases?.clickup ?? "https://app.clickup.com").replace(/\/+$/, "");
    return `${base}/t/${row.jira_key}`;
  }
  if (!bases?.jira) return "";
  return `${bases.jira.replace(/\/+$/, "")}/browse/${row.jira_key}`;
}

function localTicketSummary(
  row: LocalTicketRow,
  bases?: { jira?: string; clickup?: string },
) {
  return {
    key: localTicketKey(row),
    summary: row.title,
    status: row.status,
    assignee: row.assignee ?? undefined,
    priority: row.priority ?? undefined,
    url: localTicketUrl(row, bases),
    source: "local" as const,
    localId: row.id,
    syncStatus: row.sync_status,
    syncProvider: row.sync_provider ?? undefined,
    syncError: row.sync_error ?? undefined,
  };
}

function localTicketDetail(
  row: LocalTicketRow,
  bases?: { jira?: string; clickup?: string },
) {
  return {
    ...localTicketSummary(row, bases),
    reporter: undefined,
    type: row.type,
    created: row.created_at,
    updated: row.updated_at,
    labels: localLabels(row),
    description: row.description,
  };
}

async function ticketUrlBases(
  projectId: string,
): Promise<{ jira?: string; clickup?: string }> {
  const bases: { jira?: string; clickup?: string } = {};
  const jiraCtx = await integrationContext(projectId, "jira");
  if (jiraCtx) {
    const parsed = JiraConfig.safeParse(jiraCtx.config);
    if (parsed.success) bases.jira = parsed.data.baseUrl;
  }
  const clickupCtx = await integrationContext(projectId, "clickup");
  if (clickupCtx) {
    const parsed = ClickUpConfig.safeParse(clickupCtx.config);
    if (parsed.success) bases.clickup = parsed.data.baseUrl ?? "https://app.clickup.com";
  }
  return bases;
}

async function listTicketsHandler(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);

  const locals = await listLocalTickets(projectId);
  const bases = await ticketUrlBases(projectId);
  const providers: TicketProvider[] = [];
  const errors: Record<string, string> = {};
  const remote: Array<Record<string, unknown>> = [];

  const jiraCtx = await integrationContext(projectId, "jira");
  if (jiraCtx) {
    providers.push("jira");
    const parsed = JiraConfig.safeParse(jiraCtx.config);
    if (!parsed.success) {
      errors.jira = "Konfigurasi Jira tidak valid.";
    } else {
      try {
        const tickets = await listTickets(parsed.data);
        remote.push(...tickets.map((ticket) => ({ ...ticket, source: "jira" as const })));
      } catch (error) {
        errors.jira = (error as Error).message;
      }
    }
  }

  const clickupCtx = await integrationContext(projectId, "clickup");
  if (clickupCtx) {
    providers.push("clickup");
    const parsed = ClickUpConfig.safeParse(clickupCtx.config);
    if (!parsed.success) {
      errors.clickup = "Konfigurasi ClickUp tidak valid.";
    } else {
      try {
        remote.push(
          ...await listClickUpTickets(parsed.data) as unknown as Array<Record<string, unknown>>,
        );
      } catch (error) {
        errors.clickup = (error as Error).message;
      }
    }
  }

  const remoteKeys = new Set(remote.map((ticket) => String(ticket.key ?? "")));
  const pending = locals
    .filter((row) => !row.jira_key || !remoteKeys.has(row.jira_key))
    .map((row) => localTicketSummary(row, bases));

  const configured = providers.length > 0;
  return json({
    configured,
    providers,
    error: Object.keys(errors).length
      ? Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join(" | ")
      : undefined,
    errors: Object.keys(errors).length ? errors : undefined,
    tickets: configured || pending.length
      ? [...pending, ...remote]
      : locals.map((row) => localTicketSummary(row, bases)),
  });
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
  return json({ ticket: localTicketDetail(ticket, await ticketUrlBases(projectId)) }, 201);
}

async function getLocalTicketHandler(projectId: string, id: string): Promise<Response> {
  const ticket = await getLocalTicket(id);
  if (!ticket || ticket.project_id !== projectId) {
    return json({ error: "ticket_not_found" }, 404);
  }
  return json({ ticket: localTicketDetail(ticket, await ticketUrlBases(projectId)) });
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
  const bases = await ticketUrlBases(projectId);
  return json({ ticket: updated ? localTicketDetail(updated, bases) : null });
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

async function syncLocalTicketHandler(
  projectId: string,
  id: string,
  req: Request,
): Promise<Response> {
  const ticket = await getLocalTicket(id);
  if (!ticket || ticket.project_id !== projectId) {
    return json({ error: "ticket_not_found" }, 404);
  }
  const bases = await ticketUrlBases(projectId);
  if (ticket.jira_key) {
    return json({ ticket: localTicketDetail(ticket, bases) });
  }

  const body = LocalTicketSyncInput.safeParse(await readJson(req).catch(() => ({})));
  if (!body.success) {
    return json({ error: "invalid_input", issues: body.error.issues }, 400);
  }
  const provider = await resolveTicketProvider(projectId, body.data.provider);
  if (!provider) {
    return json({ error: "Integrasi Jira/ClickUp belum dikonfigurasi." }, 400);
  }

  try {
    if (provider === "clickup") {
      const ctx = await integrationContext(projectId, "clickup");
      if (!ctx) return json({ error: "Integrasi ClickUp belum dikonfigurasi." }, 400);
      const parsed = ClickUpConfig.safeParse(ctx.config);
      if (!parsed.success) return json({ error: "Konfigurasi ClickUp tidak valid." }, 400);
      const created = await createClickUpTicket(parsed.data, {
        summary: ticket.title,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority ?? undefined,
        labels: localLabels(ticket),
      });
      await markLocalTicketSynced(ticket.id, created.key, "clickup");
    } else {
      const ctx = await integrationContext(projectId, "jira");
      if (!ctx) return json({ error: "Integrasi Jira belum dikonfigurasi." }, 400);
      const parsed = JiraConfig.safeParse(ctx.config);
      if (!parsed.success) return json({ error: "Konfigurasi Jira tidak valid." }, 400);
      const created = await createTicket(parsed.data, {
        summary: ticket.title,
        description: ticket.description,
        type: ticket.type,
        priority: ticket.priority ?? undefined,
        labels: localLabels(ticket),
      });
      await markLocalTicketSynced(ticket.id, created.key, "jira");
    }
    const updated = (await getLocalTicket(ticket.id))!;
    await record("ticket.synced", {
      projectId,
      id,
      key: updated.jira_key,
      provider,
    });
    return json({ ticket: localTicketDetail(updated, await ticketUrlBases(projectId)) });
  } catch (error) {
    const message = (error as Error).message;
    await markLocalTicketSyncError(ticket.id, message);
    return json({ error: message }, 502);
  }
}

async function getTicketHandler(
  projectId: string,
  key: string,
  source?: string | null,
): Promise<Response> {
  const preferred = source === "clickup" || source === "jira" ? source : undefined;
  const provider = await resolveTicketProvider(projectId, preferred, key);
  if (!provider) return json({ error: "not_configured" }, 400);

  try {
    if (provider === "clickup") {
      const ctx = await integrationContext(projectId, "clickup");
      if (!ctx) return json({ error: "not_configured" }, 400);
      const parsed = ClickUpConfig.safeParse(ctx.config);
      if (!parsed.success) return json({ error: "invalid_config" }, 400);
      return json({ ticket: await getClickUpTicket(parsed.data, key) });
    }
    const ctx = await integrationContext(projectId, "jira");
    if (!ctx) return json({ error: "not_configured" }, 400);
    const parsed = JiraConfig.safeParse(ctx.config);
    if (!parsed.success) return json({ error: "invalid_config" }, 400);
    const ticket = await getTicket(parsed.data, key);
    return json({ ticket: { ...ticket, source: "jira" as const } });
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

  const body = TicketTransitionInput.safeParse(await readJson(req));
  if (!body.success) {
    return json({ error: "invalid_input", issues: body.error.issues }, 400);
  }

  const provider = await resolveTicketProvider(projectId, body.data.source, key);
  if (!provider) return json({ error: "not_configured" }, 400);

  try {
    if (provider === "clickup") {
      const ctx = await integrationContext(projectId, "clickup");
      if (!ctx) return json({ error: "not_configured" }, 400);
      const parsed = ClickUpConfig.safeParse(ctx.config);
      if (!parsed.success) return json({ error: "invalid_config" }, 400);
      await transitionClickUpTicket(parsed.data, key, body.data.status);
    } else {
      const ctx = await integrationContext(projectId, "jira");
      if (!ctx) return json({ error: "not_configured" }, 400);
      const parsed = JiraConfig.safeParse(ctx.config);
      if (!parsed.success) return json({ error: "invalid_config" }, 400);
      await transitionTicket(parsed.data, key, body.data.status);
    }
    await record("ticket.transitioned", {
      projectId,
      key,
      status: body.data.status,
      provider,
    });
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
      return json({ ok: true, name: "Lullaby", version: VERSION });
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

    if (pathname === "/api/settings/chat-tools") {
      if (method === "GET") return await getChatToolsSettingsHandler();
      if (method === "PUT" || method === "POST") return await saveChatToolsSettingsHandler(req);
    }

    if (pathname === "/api/settings/automation") {
      if (method === "GET") return await getAutomationSettingsHandler();
      if (method === "PUT" || method === "POST") return await saveAutomationSettingsHandler(req);
    }
    if (pathname === "/api/settings/notifications/test" && method === "POST") {
      return await testNotificationSettingsHandler(req);
    }
    if (pathname === "/api/settings/notifications") {
      if (method === "GET") return await getNotificationSettingsHandler();
      if (method === "PUT" || method === "POST") return await saveNotificationSettingsHandler(req);
    }
    if (pathname === "/api/settings/terminal") {
      if (method === "GET") return await getTerminalSettingsHandler();
      if (method === "PUT" || method === "POST") return await saveTerminalSettingsHandler(req);
    }

    if (pathname === "/api/settings/ui") {
      if (method === "GET") return await getUiPreferencesHandler();
      if (method === "PUT" || method === "POST") return await saveUiPreferencesHandler(req);
    }

    if (pathname === "/api/settings/lsp") {
      if (method === "GET") return await getLspSettingsHandler();
      if (method === "PUT" || method === "POST") return await saveLspSettingsHandler(req);
    }
    if (pathname === "/api/settings/lsp/probe" && method === "POST") {
      return await probeLspHandler(req);
    }

    if (pathname === "/api/settings/prompts") {
      if (method === "GET") return await getPromptsHandler();
      if (method === "PUT" || method === "POST") return await savePromptsHandler(req);
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
    if (detail && method === "DELETE") return await deleteProjectHandler(detail[1]);

    const workflows = pathname.match(/^\/api\/projects\/([^/]+)\/workflows$/);
    if (workflows) {
      if (method === "GET") return await listWorkflowsHandler(workflows[1]);
      if (method === "POST") return await createWorkflowHandler(workflows[1], req);
    }

    const workflowRun = pathname.match(
      /^\/api\/projects\/([^/]+)\/workflows\/([^/]+)\/run$/,
    );
    if (workflowRun && method === "POST") {
      return await runWorkflowHandler(
        workflowRun[1],
        decodeURIComponent(workflowRun[2]),
        req,
      );
    }

    const workflowSchedule = pathname.match(
      /^\/api\/projects\/([^/]+)\/workflows\/([^/]+)\/schedule$/,
    );
    if (workflowSchedule && method === "PATCH") {
      return await patchWorkflowScheduleHandler(
        workflowSchedule[1],
        decodeURIComponent(workflowSchedule[2]),
        req,
      );
    }

    const workflowItem = pathname.match(/^\/api\/projects\/([^/]+)\/workflows\/([^/]+)$/);
    if (workflowItem) {
      const slug = decodeURIComponent(workflowItem[2]);
      if (method === "GET") return await getWorkflowHandler(workflowItem[1], slug);
      if (method === "PUT") return await saveWorkflowHandler(workflowItem[1], slug, req);
      if (method === "DELETE") return await deleteWorkflowHandler(workflowItem[1], slug);
    }

    const workflowRuns = pathname.match(/^\/api\/projects\/([^/]+)\/workflow-runs$/);
    if (workflowRuns && method === "GET") {
      return await listWorkflowRunsHandler(
        workflowRuns[1],
        url.searchParams.get("workflow"),
        Number(url.searchParams.get("limit") ?? 50),
      );
    }

    const workflowRunCancel = pathname.match(
      /^\/api\/projects\/([^/]+)\/workflow-runs\/([^/]+)\/cancel$/,
    );
    if (workflowRunCancel && method === "POST") {
      return await cancelWorkflowRunHandler(workflowRunCancel[1], workflowRunCancel[2]);
    }

    const workflowRunItem = pathname.match(
      /^\/api\/projects\/([^/]+)\/workflow-runs\/([^/]+)$/,
    );
    if (workflowRunItem) {
      if (method === "GET") {
        return await getWorkflowRunHandler(workflowRunItem[1], workflowRunItem[2]);
      }
      if (method === "DELETE") {
        return await deleteWorkflowRunHandler(workflowRunItem[1], workflowRunItem[2]);
      }
    }

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

    const gitShowRoute = pathname.match(/^\/api\/projects\/([^/]+)\/git\/show$/);
    if (gitShowRoute && method === "GET") {
      return await gitShowHandler(gitShowRoute[1], url.searchParams.get("hash") ?? "");
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

    const gitStashApply = pathname.match(/^\/api\/projects\/([^/]+)\/git\/stash\/apply$/);
    if (gitStashApply && method === "POST") {
      return await gitStashApplyHandler(gitStashApply[1], req);
    }

    const gitStashCreate = pathname.match(/^\/api\/projects\/([^/]+)\/git\/stash$/);
    if (gitStashCreate && method === "POST") {
      return await gitStashCreateHandler(gitStashCreate[1], req);
    }

    const gitClone = pathname.match(/^\/api\/projects\/([^/]+)\/git\/clone$/);
    if (gitClone && method === "POST") return await gitCloneHandler(gitClone[1], req);

    const gitFetch = pathname.match(/^\/api\/projects\/([^/]+)\/git\/fetch$/);
    if (gitFetch && method === "POST") return await gitSimpleActionHandler(gitFetch[1], "fetch");

    const gitPull = pathname.match(/^\/api\/projects\/([^/]+)\/git\/pull$/);
    if (gitPull && method === "POST") return await gitSimpleActionHandler(gitPull[1], "pull");

    const gitPush = pathname.match(/^\/api\/projects\/([^/]+)\/git\/push$/);
    if (gitPush && method === "POST") return await gitSimpleActionHandler(gitPush[1], "push");

    const gitBranchCreate = pathname.match(/^\/api\/projects\/([^/]+)\/git\/branch$/);
    if (gitBranchCreate && method === "POST") {
      return await gitCreateBranchHandler(gitBranchCreate[1], req);
    }

    const gitMerge = pathname.match(/^\/api\/projects\/([^/]+)\/git\/merge$/);
    if (gitMerge && method === "POST") return await gitMergeHandler(gitMerge[1], req);

    const terminal = pathname.match(/^\/api\/projects\/([^/]+)\/terminal$/);
    if (terminal && method === "GET") return await terminalHandler(terminal[1], req);

    const lsp = pathname.match(/^\/api\/projects\/([^/]+)\/lsp$/);
    if (lsp && method === "GET") return await lspHandler(lsp[1], req);

    const files = pathname.match(/^\/api\/projects\/([^/]+)\/files$/);
    if (files && method === "GET") {
      return await listFilesHandler(files[1], url.searchParams.get("path") ?? "");
    }
    if (files && method === "POST") {
      return await createPathHandler(files[1], req);
    }

    const fileIndex = pathname.match(/^\/api\/projects\/([^/]+)\/files\/index$/);
    if (fileIndex && method === "GET") return await fileIndexHandler(fileIndex[1]);

    const fileFind = pathname.match(/^\/api\/projects\/([^/]+)\/files\/find$/);
    if (fileFind && method === "GET") return await findFilesHandler(fileFind[1], url);

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
        return await updateDocumentHandler(
          documentItem[1],
          decodeURIComponent(documentItem[2]),
          req,
          parseDocumentSource(url.searchParams.get("source")),
        );
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
      return await syncLocalTicketHandler(localTicketSync[1], localTicketSync[2], req);
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
      return await getTicketHandler(ticketItem[1], ticketItem[2], url.searchParams.get("source"));
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

    if (pathname === "/api/llm/cursor/models" && method === "POST") {
      return await listCursorModelsHandler(req);
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
