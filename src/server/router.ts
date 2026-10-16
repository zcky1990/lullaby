import {
  ChatInput,
  CreateDocumentInput,
  DocmostConfig,
  IntegrationInput,
  type IntegrationKind,
  JiraConfig,
  LlmProviderInput,
  ProjectInput,
  ProjectUpdateInput,
} from "../config/schema.ts";
import { appDataDir } from "../core/paths.ts";
import { log } from "../core/logger.ts";
import {
  appendEvent,
  createLlmProvider,
  createProject,
  deleteLlmProvider,
  getIntegration,
  getLlmProvider,
  getProject,
  listIntegrations,
  listLlmProviders,
  listProjects,
  recentEvents,
  updateLlmProvider,
  updateProject,
  upsertIntegration,
} from "../db/db.ts";
import { listDirectory, readWorkspaceFile } from "../fs/workspace.ts";
import { createDocument, getDocument, listDocuments } from "../integrations/docmost.ts";
import { getTicket, listTickets, transitionTicket } from "../integrations/jira.ts";
import { chat } from "../integrations/llm.ts";
import { testIntegration } from "../integrations/index.ts";
import { publish } from "./bus.ts";
import { APP_TOKEN_COOKIE, APP_TOKEN_HEADER, appToken } from "./session.ts";
import { sse } from "./sse.ts";
import { serveAsset } from "./static.ts";

const VERSION = "0.1.0";
const MAX_BODY_BYTES = 1_000_000;

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

  try {
    const message = await chat(
      {
        provider: provider.provider,
        model: provider.model ?? undefined,
        baseUrl: provider.base_url ?? undefined,
        apiKey: provider.api_key ?? undefined,
      },
      parsed.data.messages,
    );
    await record("chat.message", { projectId, providerId: provider.id });
    return json({ message });
  } catch (error) {
    return json({ error: (error as Error).message }, 502);
  }
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

async function listTicketsHandler(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const ctx = await integrationContext(projectId, "jira");
  if (!ctx) return json({ configured: false, tickets: [] });

  const parsed = JiraConfig.safeParse(ctx.config);
  if (!parsed.success) {
    return json({ configured: true, error: "Konfigurasi Jira tidak valid.", tickets: [] });
  }
  try {
    return json({ configured: true, tickets: await listTickets(parsed.data) });
  } catch (error) {
    return json({ configured: true, error: (error as Error).message, tickets: [] });
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
    if (documentItem && method === "GET") {
      return await getDocumentHandler(documentItem[1], documentItem[2]);
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

    const chatRoute = pathname.match(/^\/api\/projects\/([^/]+)\/chat$/);
    if (chatRoute && method === "POST") return await chatHandler(chatRoute[1], req);

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
