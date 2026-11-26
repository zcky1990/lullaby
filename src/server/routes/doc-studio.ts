/**
 * Route menu Doc Studio (dokumen terpandu AI: PRD/BRD/RFC/RCA/…).
 *
 * Pola modul mandiri (sama seperti `routes/chat-review.ts`): mengembalikan `null`
 * bila path bukan milik modul ini, lalu dirangkai di `main.ts`. Jadi `router.ts`
 * (berkas besar dengan blok dispatch yang panjang) tidak perlu disentuh.
 *
 * Endpoint:
 * - `GET    /api/doc-studio/templates`
 * - `GET    /api/settings/doc-studio`
 * - `PUT    /api/settings/doc-studio`
 * - `POST   /api/projects/:id/doc-studio/drafts`
 * - `GET    /api/projects/:id/doc-studio/drafts`
 * - `GET    /api/projects/:id/doc-studio/drafts/:draftId`
 * - `POST   /api/projects/:id/doc-studio/drafts/:draftId/turns`
 * - `POST   /api/projects/:id/doc-studio/drafts/:draftId/finalize`
 * - `DELETE /api/projects/:id/doc-studio/drafts/:draftId`
 */
import {
  DocStudioConfigInput,
  DocStudioDraftInput,
  DocStudioFinalizeInput,
  DocStudioTurnInput,
} from "../../config/schema_doc_studio.ts";
import { getProject } from "../../db/db.ts";
import {
  createDocDraft,
  deleteDocDraft,
  type DocDraftRow,
  getDocDraft,
  listDocDrafts,
  updateDocDraft,
} from "../../db/doc-drafts.ts";
import { createLocalDocument, updateLocalDocument } from "../../fs/documents.ts";
import {
  availableDocTemplates,
  docStudioConfigPayload,
  docStudioConfigReferencesValid,
  docStudioTemplate,
  readDocStudioConfig,
  resolveDocStudioProvider,
  resolveDocStudioRole,
  writeDocStudioConfig,
} from "../docstudio/config.ts";
import {
  type DocStudioContext,
  docStudioFinalize,
  docStudioInterview,
  type DocStudioTurn,
} from "../docstudio/engine.ts";
import { DEFAULT_DOC_STUDIO_PROMPT } from "../docstudio/prompts.ts";
import { HttpError, isAuthorized, json, readJson, record } from "../http.ts";

const TEMPLATES_PATH = "/api/doc-studio/templates";
const SETTINGS_PATH = "/api/settings/doc-studio";
const DRAFTS_PATTERN = /^\/api\/projects\/([^/]+)\/doc-studio\/drafts$/;
const TURNS_PATTERN = /^\/api\/projects\/([^/]+)\/doc-studio\/drafts\/([^/]+)\/turns$/;
const FINALIZE_PATTERN = /^\/api\/projects\/([^/]+)\/doc-studio\/drafts\/([^/]+)\/finalize$/;
const DRAFT_PATTERN = /^\/api\/projects\/([^/]+)\/doc-studio\/drafts\/([^/]+)$/;

/** Decode aman: segmen rusak (`%zz`) dibiarkan apa adanya, bukan melempar URIError. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Rute yang cocok untuk sebuah path + method (dipakai juga oleh test). */
export type DocStudioRoute =
  | { kind: "templates" }
  | { kind: "settings" }
  | { kind: "drafts"; projectId: string; mode: "list" | "create" }
  | { kind: "draft"; projectId: string; draftId: string }
  | { kind: "turns"; projectId: string; draftId: string }
  | { kind: "finalize"; projectId: string; draftId: string };

/**
 * Pencocokan path+method.
 *
 * Koleksi `drafts` melayani dua operasi berbeda (`GET` daftar, `POST` buat
 * draft + interview pertama), jadi mode-nya ditentukan di sini — bukan dengan
 * menganggap semuanya `list` (bug lama: `POST` berakhir `method_not_allowed`).
 */
export function matchDocStudioRoute(pathname: string, method: string): DocStudioRoute | null {
  const verb = method.toUpperCase();
  if (pathname === TEMPLATES_PATH) return { kind: "templates" };
  if (pathname === SETTINGS_PATH) return { kind: "settings" };
  const turnsMatch = TURNS_PATTERN.exec(pathname);
  if (turnsMatch) {
    return {
      kind: "turns",
      projectId: safeDecode(turnsMatch[1]),
      draftId: safeDecode(turnsMatch[2]),
    };
  }
  const finalizeMatch = FINALIZE_PATTERN.exec(pathname);
  if (finalizeMatch) {
    return {
      kind: "finalize",
      projectId: safeDecode(finalizeMatch[1]),
      draftId: safeDecode(finalizeMatch[2]),
    };
  }
  const draftsMatch = DRAFTS_PATTERN.exec(pathname);
  if (draftsMatch) {
    return {
      kind: "drafts",
      projectId: safeDecode(draftsMatch[1]),
      mode: verb === "POST" ? "create" : "list",
    };
  }
  const draftMatch = DRAFT_PATTERN.exec(pathname);
  if (draftMatch) {
    return {
      kind: "draft",
      projectId: safeDecode(draftMatch[1]),
      draftId: safeDecode(draftMatch[2]),
    };
  }
  return null;
}

export interface DocStudioDraftPayload {
  id: string;
  projectId: string;
  typeId: string;
  roleId: string | null;
  title: string;
  status: string;
  documentPath: string | null;
  transcript: DocStudioTurn[];
  createdAt: string;
  updatedAt: string;
}

function parseTranscript(raw: string): DocStudioTurn[] {
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        role: (item as DocStudioTurn).role === "assistant" ? "assistant" : "user",
        content: String((item as DocStudioTurn).content ?? ""),
      }));
  } catch {
    return [];
  }
}

function serializeDraft(row: DocDraftRow): DocStudioDraftPayload {
  return {
    id: row.id,
    projectId: row.project_id,
    typeId: row.type_id,
    roleId: row.role_id,
    title: row.title,
    status: row.status,
    documentPath: row.document_path,
    transcript: parseTranscript(row.transcript),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json(error.body, error.status);
  return json({ error: (error as Error).message }, 500);
}

/** Root document workspace project; `null` bila belum diatur. */
function documentRoot(project: { document_path: string | null }): string | null {
  const path = project.document_path?.trim();
  return path ? path : null;
}

async function contextForDraft(
  draft: DocDraftRow,
): Promise<{ ctx: DocStudioContext } | { error: string; status: number }> {
  const cfg = await readDocStudioConfig();
  const template = docStudioTemplate(draft.type_id, cfg);
  if (!template) return { error: "template_not_found", status: 400 };
  const role = await resolveDocStudioRole(draft.type_id, cfg, draft.role_id);
  const provider = await resolveDocStudioProvider(cfg, role);
  if (!provider) return { error: "llm_not_configured", status: 400 };
  const override = cfg.types[draft.type_id]?.prompt ?? "";
  return {
    ctx: {
      provider,
      template,
      persona: role?.persona ?? null,
      promptOverride: override,
      language: cfg.language,
    },
  };
}

async function handleTemplates(req: Request): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return json({ error: "method_not_allowed" }, 405);
  const cfg = await readDocStudioConfig();
  return json({
    templates: await availableDocTemplates(cfg),
    language: cfg.language,
    defaultRoleId: cfg.defaultRoleId,
    types: cfg.types,
  });
}

async function handleSettings(req: Request): Promise<Response> {
  const method = req.method.toUpperCase();
  if (method === "GET") {
    const payload = await docStudioConfigPayload();
    return json({ ...payload, defaultPrompt: DEFAULT_DOC_STUDIO_PROMPT });
  }
  if (method !== "PUT") return json({ error: "method_not_allowed" }, 405);

  const parsed = DocStudioConfigInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const refs = await docStudioConfigReferencesValid(parsed.data);
  if (!refs.ok) return json({ error: refs.error }, 400);
  await writeDocStudioConfig(parsed.data);
  await record("settings.doc_studio_updated", {});
  const payload = await docStudioConfigPayload();
  return json({ ...payload, defaultPrompt: DEFAULT_DOC_STUDIO_PROMPT });
}

async function handleCreateDraft(projectId: string, req: Request): Promise<Response> {
  if (req.method.toUpperCase() !== "POST") return json({ error: "method_not_allowed" }, 405);
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const root = documentRoot(project);
  if (!root) return json({ error: "document_workspace_missing" }, 400);

  const parsed = DocStudioDraftInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const cfg = await readDocStudioConfig();
  const template = docStudioTemplate(parsed.data.typeId, cfg);
  if (!template) return json({ error: "template_not_found" }, 400);
  const role = await resolveDocStudioRole(template.id, cfg, parsed.data.roleId);
  const provider = await resolveDocStudioProvider(cfg, role);
  if (!provider) return json({ error: "llm_not_configured" }, 400);

  const interview = await docStudioInterview({
    provider,
    template,
    persona: role?.persona ?? null,
    promptOverride: cfg.types[template.id]?.prompt ?? "",
    language: cfg.language,
  }, []);

  const draft = await createDocDraft({
    projectId,
    typeId: template.id,
    roleId: role?.id ?? null,
    title: template.label,
    transcript: interview.transcript,
  });
  await record("docstudio.draft_created", {
    projectId,
    draftId: draft.id,
    typeId: template.id,
  });
  return json({
    draft: serializeDraft(draft),
    reply: interview.reply,
    ready: interview.ready,
    template,
    roleName: role?.name ?? null,
  }, 201);
}

async function handleListDrafts(projectId: string, req: Request): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return json({ error: "method_not_allowed" }, 405);
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const drafts = await listDocDrafts(projectId);
  return json({ drafts: drafts.map(serializeDraft) });
}

async function handleDraft(projectId: string, draftId: string, req: Request): Promise<Response> {
  const method = req.method.toUpperCase();
  const draft = await getDocDraft(draftId);
  if (!draft || draft.project_id !== projectId) return json({ error: "draft_not_found" }, 404);
  if (method === "GET") return json({ draft: serializeDraft(draft) });
  if (method === "DELETE") {
    await deleteDocDraft(draftId);
    await record("docstudio.draft_deleted", { projectId, draftId });
    return json({ ok: true });
  }
  return json({ error: "method_not_allowed" }, 405);
}

async function handleTurn(projectId: string, draftId: string, req: Request): Promise<Response> {
  if (req.method.toUpperCase() !== "POST") return json({ error: "method_not_allowed" }, 405);
  const draft = await getDocDraft(draftId);
  if (!draft || draft.project_id !== projectId) return json({ error: "draft_not_found" }, 404);
  if (draft.status === "saved") return json({ error: "draft_already_saved" }, 400);

  const parsed = DocStudioTurnInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const resolved = await contextForDraft(draft);
  if ("error" in resolved) return json({ error: resolved.error }, resolved.status);

  const interview = await docStudioInterview(
    resolved.ctx,
    parseTranscript(draft.transcript),
    parsed.data.message,
  );
  const updated = await updateDocDraft(draftId, {
    transcript: interview.transcript,
    status: interview.ready ? "ready" : "interviewing",
  });
  return json({
    draft: serializeDraft(updated ?? draft),
    reply: interview.reply,
    ready: interview.ready,
  });
}

async function handleFinalize(
  projectId: string,
  draftId: string,
  req: Request,
): Promise<Response> {
  if (req.method.toUpperCase() !== "POST") return json({ error: "method_not_allowed" }, 405);
  const draft = await getDocDraft(draftId);
  if (!draft || draft.project_id !== projectId) return json({ error: "draft_not_found" }, 404);
  const project = await getProject(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const root = documentRoot(project);
  if (!root) return json({ error: "document_workspace_missing" }, 400);

  const parsed = DocStudioFinalizeInput.safeParse(await readJson(req).catch(() => ({})));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const resolved = await contextForDraft(draft);
  if ("error" in resolved) return json({ error: resolved.error }, resolved.status);

  const result = await docStudioFinalize(resolved.ctx, parseTranscript(draft.transcript));
  const title = parsed.data.title?.trim() || result.title;
  const created = await createLocalDocument(root, title);
  const saved = await updateLocalDocument(root, created.path, { content: result.markdown });
  const updated = await updateDocDraft(draftId, {
    status: "saved",
    documentPath: saved.path,
    title: saved.title,
  });
  await record("docstudio.document_saved", {
    projectId,
    draftId,
    path: saved.path,
    typeId: draft.type_id,
  });
  return json({
    draft: serializeDraft(updated ?? draft),
    document: { path: saved.path, title: saved.title },
  });
}

/** Dispatch berdasarkan rute hasil `matchDocStudioRoute`. */
async function dispatchDocStudioRoute(
  route: DocStudioRoute,
  req: Request,
): Promise<Response> {
  switch (route.kind) {
    case "templates":
      return await handleTemplates(req);
    case "settings":
      return await handleSettings(req);
    case "drafts":
      return route.mode === "create"
        ? await handleCreateDraft(route.projectId, req)
        : await handleListDrafts(route.projectId, req);
    case "draft":
      return await handleDraft(route.projectId, route.draftId, req);
    case "turns":
      return await handleTurn(route.projectId, route.draftId, req);
    case "finalize":
      return await handleFinalize(route.projectId, route.draftId, req);
    default:
      // Dijaga oleh tipe: menambah `kind` baru tanpa cabang akan gagal typecheck.
      return json({ error: "not_found" }, 404);
  }
}

/**
 * Handler modul Doc Studio. Mengembalikan `null` bila path bukan milik modul ini
 * sehingga rantai handler di `main.ts` bisa lanjut.
 */
export async function handleDocStudioRequest(req: Request): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  const route = matchDocStudioRoute(pathname, req.method);
  if (!route) return null;

  if (!isAuthorized(req)) return json({ error: "unauthorized" }, 401);

  try {
    return await dispatchDocStudioRoute(route, req);
  } catch (error) {
    return errorResponse(error);
  }
}
