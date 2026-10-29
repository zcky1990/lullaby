import {
  ConfluenceConfig,
  DocmostConfig,
  DocumentSource,
  NotionConfig,
} from "../../config/schema.ts";
import {
  getIntegration,
  getLocalDocumentMeta,
  getProject,
  listLocalDocumentMeta,
  markLocalDocumentSynced,
  markLocalDocumentSyncError,
  moveLocalDocumentMeta,
} from "../../db/db.ts";
import {
  createLocalDocument,
  listLocalDocuments,
  readLocalDocument,
  updateLocalDocument,
} from "../../fs/documents.ts";
import {
  createDocument,
  getDocument,
  listDocuments,
  updateDocument,
} from "../../integrations/docmost.ts";
import {
  getDocument as getConfluenceDocument,
  listDocuments as listConfluenceDocuments,
} from "../../integrations/confluence.ts";
import {
  getDocument as getNotionDocument,
  listDocuments as listNotionDocuments,
} from "../../integrations/notion.ts";

const MAX_RESULT = 60_000;

export type DocToolSource = "local" | "docmost" | "notion" | "confluence";

function clip(value: unknown): string {
  return JSON.stringify(value).slice(0, MAX_RESULT);
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

async function integrationConfig(
  projectId: string,
  kind: "docmost" | "notion" | "confluence",
): Promise<Record<string, unknown> | null> {
  const row = await getIntegration(projectId, kind);
  if (!row) return null;
  try {
    return JSON.parse(row.config) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseSource(raw: unknown): DocToolSource | null {
  const value = String(raw ?? "local").trim().toLowerCase();
  if (value === "local") return "local";
  const parsed = DocumentSource.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function listDocumentsTool(
  projectId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const source = parseSource(args.source ?? "local");
  if (!source) {
    return 'Error: source harus "local", "docmost", "notion", atau "confluence".';
  }
  const pageId = typeof args.pageId === "string" && args.pageId.trim()
    ? args.pageId.trim()
    : undefined;

  const project = await getProject(projectId);
  if (!project) return "Error: project tidak ditemukan.";

  if (source === "local") {
    const root = project.document_path?.trim();
    if (!root) return "Document workspace belum diatur (Project Settings → Documents).";
    try {
      const [entries, meta] = await Promise.all([
        listLocalDocuments(root),
        listLocalDocumentMeta(projectId),
      ]);
      const byPath = new Map(meta.map((row) => [row.path, row]));
      return clip({
        source,
        configured: true,
        documents: entries.map((entry) => localDocumentPayload(entry, byPath.get(entry.path))),
      });
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }

  const config = await integrationConfig(projectId, source);
  if (!config) return `Integrasi ${source} belum dikonfigurasi.`;

  try {
    if (source === "notion") {
      const parsed = NotionConfig.safeParse(config);
      if (!parsed.success) return "Konfigurasi Notion tidak valid.";
      const { documents } = await listNotionDocuments(parsed.data, pageId);
      return clip({ source, configured: true, documents });
    }
    if (source === "confluence") {
      const parsed = ConfluenceConfig.safeParse(config);
      if (!parsed.success) return "Konfigurasi Confluence tidak valid.";
      const { documents } = await listConfluenceDocuments(parsed.data, pageId);
      return clip({ source, configured: true, documents });
    }
    const parsed = DocmostConfig.safeParse(config);
    if (!parsed.success) return "Konfigurasi Docmost tidak valid.";
    const spaceId = parsed.data.spaceId ?? project.docmost_space_id ?? undefined;
    const { documents } = await listDocuments(parsed.data, spaceId, pageId);
    return clip({ source, configured: true, documents });
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

export async function getDocumentTool(
  projectId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const source = parseSource(args.source ?? "local");
  if (!source) {
    return 'Error: source harus "local", "docmost", "notion", atau "confluence".';
  }
  const project = await getProject(projectId);
  if (!project) return "Error: project tidak ditemukan.";

  if (source === "local") {
    const root = project.document_path?.trim();
    if (!root) return "Document workspace belum diatur.";
    const path = typeof args.path === "string" ? args.path.trim() : "";
    if (!path) return "Error: path wajib untuk source=local.";
    try {
      const doc = await readLocalDocument(root, path);
      const meta = await getLocalDocumentMeta(projectId, doc.path);
      return clip({
        source,
        document: { ...doc, ...localDocumentPayload(doc, meta ?? undefined) },
      });
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }

  const pageId = typeof args.pageId === "string"
    ? args.pageId.trim()
    : typeof args.path === "string"
    ? args.path.trim()
    : "";
  if (!pageId) return "Error: pageId wajib untuk remote source.";

  const config = await integrationConfig(projectId, source);
  if (!config) return `Integrasi ${source} belum dikonfigurasi.`;

  try {
    if (source === "notion") {
      const parsed = NotionConfig.safeParse(config);
      if (!parsed.success) return "Konfigurasi Notion tidak valid.";
      return clip({ source, document: await getNotionDocument(parsed.data, pageId) });
    }
    if (source === "confluence") {
      const parsed = ConfluenceConfig.safeParse(config);
      if (!parsed.success) return "Konfigurasi Confluence tidak valid.";
      return clip({ source, document: await getConfluenceDocument(parsed.data, pageId) });
    }
    const parsed = DocmostConfig.safeParse(config);
    if (!parsed.success) return "Konfigurasi Docmost tidak valid.";
    return clip({ source, document: await getDocument(parsed.data, pageId) });
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

export async function createDocumentTool(
  projectId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const source = parseSource(args.source ?? "local");
  if (source !== "local" && source !== "docmost") {
    return "Error: create_document hanya untuk source=local atau docmost.";
  }
  const title = typeof args.title === "string" ? args.title.trim() : "";
  if (!title) return "Error: title wajib.";

  const project = await getProject(projectId);
  if (!project) return "Error: project tidak ditemukan.";

  if (source === "local") {
    const root = project.document_path?.trim();
    if (!root) return "Document workspace belum diatur.";
    try {
      const doc = await createLocalDocument(root, title);
      return clip({ source, document: { ...doc, ...localDocumentPayload(doc) } });
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }

  const config = await integrationConfig(projectId, "docmost");
  if (!config) return "Integrasi Docmost belum dikonfigurasi.";
  const parsedCfg = DocmostConfig.safeParse(config);
  if (!parsedCfg.success) return "Konfigurasi Docmost tidak valid.";
  const spaceId = parsedCfg.data.spaceId ?? project.docmost_space_id ?? undefined;
  if (!spaceId) return "Space ID Docmost belum diisi.";
  const parentPageId = typeof args.parentId === "string" && args.parentId.trim()
    ? args.parentId.trim()
    : typeof args.parentPageId === "string" && args.parentPageId.trim()
    ? args.parentPageId.trim()
    : undefined;
  try {
    const document = await createDocument(parsedCfg.data, {
      spaceId,
      title,
      parentPageId,
    });
    const content = typeof args.content === "string" ? args.content : undefined;
    if (content != null) {
      const updated = await updateDocument(parsedCfg.data, {
        pageId: document.id,
        title,
        content,
      });
      return clip({ source, document: updated });
    }
    return clip({ source, document });
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

export async function updateDocumentTool(
  projectId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const source = parseSource(args.source ?? "local");
  if (source !== "local" && source !== "docmost") {
    return "Error: update_document hanya untuk source=local atau docmost.";
  }
  const project = await getProject(projectId);
  if (!project) return "Error: project tidak ditemukan.";

  if (source === "local") {
    const root = project.document_path?.trim();
    if (!root) return "Document workspace belum diatur.";
    const path = typeof args.path === "string" ? args.path.trim() : "";
    if (!path) return "Error: path wajib untuk source=local.";
    try {
      const doc = await updateLocalDocument(root, path, {
        title: typeof args.title === "string" ? args.title : undefined,
        content: typeof args.content === "string" ? args.content : undefined,
      });
      if (doc.path !== path) {
        await moveLocalDocumentMeta(projectId, path, doc.path);
      }
      const meta = await getLocalDocumentMeta(projectId, doc.path);
      return clip({
        source,
        document: { ...doc, ...localDocumentPayload(doc, meta ?? undefined) },
      });
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }

  const pageId = typeof args.pageId === "string" ? args.pageId.trim() : "";
  if (!pageId) return "Error: pageId wajib untuk docmost.";
  const content = typeof args.content === "string" ? args.content : undefined;
  if (content == null) return "Error: content wajib untuk update Docmost.";
  const config = await integrationConfig(projectId, "docmost");
  if (!config) return "Integrasi Docmost belum dikonfigurasi.";
  const parsedCfg = DocmostConfig.safeParse(config);
  if (!parsedCfg.success) return "Konfigurasi Docmost tidak valid.";
  try {
    const document = await updateDocument(parsedCfg.data, {
      pageId,
      title: typeof args.title === "string" ? args.title : undefined,
      content,
    });
    return clip({ source, document });
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

export async function syncDocumentTool(
  projectId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const path = typeof args.path === "string" ? args.path.trim() : "";
  if (!path) return "Error: path dokumen lokal wajib.";

  const project = await getProject(projectId);
  if (!project) return "Error: project tidak ditemukan.";
  const root = project.document_path?.trim();
  if (!root) return "Document workspace belum diatur.";

  const config = await integrationConfig(projectId, "docmost");
  if (!config) return "Integrasi Docmost belum dikonfigurasi.";
  const parsedCfg = DocmostConfig.safeParse(config);
  if (!parsedCfg.success) return "Konfigurasi Docmost tidak valid.";
  const spaceId = parsedCfg.data.spaceId?.trim() || project.docmost_space_id?.trim();
  if (!spaceId) return "Space ID Docmost belum diisi.";

  let pageId = "";
  try {
    const doc = await readLocalDocument(root, path);
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
    const updatedMeta = await getLocalDocumentMeta(projectId, doc.path);
    return clip({
      source: "local",
      synced: true,
      document: { ...doc, ...localDocumentPayload(doc, updatedMeta ?? undefined) },
    });
  } catch (error) {
    const message = (error as Error).message;
    if (pageId) await markLocalDocumentSynced(projectId, path, pageId);
    await markLocalDocumentSyncError(projectId, path, message);
    return `Error: ${message}`;
  }
}
