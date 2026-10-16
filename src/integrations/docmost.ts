import type { DocmostConfig } from "../config/schema.ts";
import { request, type TestResult, truncate } from "./http.ts";

function statusMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Ditolak (401/403): token tidak valid atau API enterprise tidak aktif.";
  }
  if (status === 404) return "Endpoint tidak ditemukan (404): periksa baseUrl.";
  if (status === 429) return "Rate limit (429): coba lagi nanti.";
  return `Docmost merespons HTTP ${status}.`;
}

export interface DocSummary {
  id: string;
  title: string;
  spaceId?: string;
  hasChildren?: boolean;
  children?: DocSummary[];
}

export interface DocContent {
  id: string;
  title?: string;
  content: string;
}

function pickArray(value: unknown): { nodes: Record<string, unknown>[]; found: boolean } {
  if (Array.isArray(value)) return { nodes: value as Record<string, unknown>[], found: true };
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["data", "items", "pages", "results", "spaces", "children"]) {
      if (key in obj) {
        const picked = pickArray(obj[key]);
        if (picked.found) return picked;
      }
    }
  }
  return { nodes: [], found: false };
}

function flattenPages(nodes: Record<string, unknown>[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const node of nodes) {
    out.push(node);
    if (Array.isArray(node.children)) {
      out.push(...flattenPages(node.children as Record<string, unknown>[]));
    }
  }
  return out;
}

function pageIdOf(item: Record<string, unknown>): string | null {
  const id = item.id ?? item.pageId ?? item.slugId;
  return id ? String(id) : null;
}

export function toDocSummary(
  item: Record<string, unknown>,
  fallbackSpaceId?: string,
): DocSummary | null {
  const id = pageIdOf(item);
  if (!id) return null;
  const nested = Array.isArray(item.children)
    ? (item.children as Record<string, unknown>[])
      .map((child) => toDocSummary(child, fallbackSpaceId))
      .filter((child): child is DocSummary => child !== null)
    : [];
  const doc: DocSummary = {
    id,
    title: String(item.title ?? item.name ?? item.slug ?? "(untitled)"),
    spaceId: item.spaceId ? String(item.spaceId) : fallbackSpaceId,
    hasChildren: Boolean(item.hasChildren) || nested.length > 0,
  };
  if (nested.length > 0) doc.children = nested;
  return doc;
}

export async function testDocmost(cfg: DocmostConfig): Promise<TestResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const token = cfg.apiToken ?? null;

  if (!token) {
    return {
      ok: false,
      message: "API token belum diisi.",
      latencyMs: elapsed(),
    };
  }

  try {
    const res = await request(`${base}/api/spaces/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (res.ok) {
      return {
        ok: true,
        status: res.status,
        message: "Koneksi Docmost berhasil.",
        latencyMs: elapsed(),
      };
    }
    return {
      ok: false,
      status: res.status,
      message: statusMessage(res.status),
      detail: truncate(res.text),
      latencyMs: elapsed(),
    };
  } catch (error) {
    return {
      ok: false,
      message: `Gagal menghubungi Docmost: ${(error as Error).message}`,
      latencyMs: elapsed(),
    };
  }
}

export interface ListDocumentsResult {
  documents: DocSummary[];
  sample: string;
}

function parseArray(res: { ok: boolean; status: number; text: string }, endpoint: string) {
  if (!res.ok) throw new Error(statusMessage(res.status));
  let json: unknown;
  try {
    json = JSON.parse(res.text || "null");
  } catch {
    throw new Error("Respons Docmost bukan JSON valid.");
  }
  const { nodes, found } = pickArray(json);
  if (!found) {
    throw new Error(
      `Format respons Docmost tidak dikenali (${endpoint}). Contoh: ${truncate(res.text, 300)}`,
    );
  }
  return { nodes, sample: truncate(res.text, 400) };
}

async function fetchSpaces(cfg: DocmostConfig): Promise<ListDocumentsResult> {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const endpoint = `${base}/api/spaces/`;
  const res = await request(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiToken}`, "Content-Type": "application/json" },
    body: "{}",
  });
  const { nodes, sample } = parseArray(res, endpoint);
  const documents: DocSummary[] = [];
  for (const item of flattenPages(nodes)) {
    const id = item.id ?? item.spaceId ?? item.slugId;
    if (!id) continue;
    documents.push({
      id: String(id),
      title: String(item.name ?? item.title ?? item.slug ?? "(space)"),
      spaceId: String(id),
    });
  }
  return { documents, sample };
}

async function fetchPages(
  cfg: DocmostConfig,
  spaceId: string,
  pageId?: string,
): Promise<ListDocumentsResult> {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const endpoint = `${base}/api/pages/sidebar-pages`;
  const body: Record<string, unknown> = { spaceId };
  if (pageId) body.pageId = pageId;

  const res = await request(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const { nodes, sample } = parseArray(res, endpoint);
  const documents = nodes
    .map((node) => toDocSummary(node, spaceId))
    .filter((doc): doc is DocSummary => doc !== null);

  if (documents.length === 0 && nodes.length > 0) {
    throw new Error(
      `Ditemukan ${nodes.length} item tetapi tanpa id/title. Contoh: ${truncate(res.text, 300)}`,
    );
  }
  return { documents, sample };
}

export async function listDocuments(
  cfg: DocmostConfig,
  spaceIdOverride?: string,
  pageId?: string,
): Promise<ListDocumentsResult> {
  if (!cfg.apiToken) throw new Error("API token Docmost belum diisi.");
  const spaceId = (spaceIdOverride ?? cfg.spaceId)?.trim();

  if (!spaceId) {
    const spaces = await fetchSpaces(cfg);
    if (spaces.documents.length === 1) {
      return await fetchPages(cfg, spaces.documents[0].id, pageId);
    }
    if (pageId) throw new Error("Space ID diperlukan untuk memuat sub-halaman.");
    return spaces;
  }
  return await fetchPages(cfg, spaceId, pageId);
}

export async function getDocument(cfg: DocmostConfig, pageId: string): Promise<DocContent> {
  if (!cfg.apiToken) throw new Error("API token Docmost belum diisi.");
  const base = cfg.baseUrl.replace(/\/+$/, "");

  const res = await request(`${base}/api/pages/info`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ pageId, format: "markdown" }),
  });
  if (!res.ok) throw new Error(statusMessage(res.status));

  const json = JSON.parse(res.text || "{}") as Record<string, unknown>;
  const data = (json.data as Record<string, unknown> | undefined) ?? json;
  return {
    id: pageId,
    title: data.title ? String(data.title) : undefined,
    content: String(data.content ?? data.markdown ?? ""),
  };
}

export interface CreateDocumentInput {
  spaceId: string;
  title: string;
  parentPageId?: string;
}

export async function createDocument(
  cfg: DocmostConfig,
  input: CreateDocumentInput,
): Promise<DocSummary> {
  if (!cfg.apiToken) throw new Error("API token Docmost belum diisi.");
  const base = cfg.baseUrl.replace(/\/+$/, "");

  const body: Record<string, unknown> = {
    spaceId: input.spaceId,
    title: input.title,
  };
  if (input.parentPageId) body.parentPageId = input.parentPageId;

  const res = await request(`${base}/api/pages/create`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${statusMessage(res.status)} ${truncate(res.text, 300)}`);
  }

  const json = JSON.parse(res.text || "{}") as Record<string, unknown>;
  const data = ((json.data as Record<string, unknown> | undefined) ?? json) as Record<
    string,
    unknown
  >;
  const id = data.id ?? data.pageId ?? data.slugId;
  if (!id) {
    throw new Error(`Docmost tidak mengembalikan id halaman. Contoh: ${truncate(res.text, 300)}`);
  }
  return {
    id: String(id),
    title: String(data.title ?? input.title),
    spaceId: input.spaceId,
    hasChildren: false,
  };
}

export interface UpdateDocumentInput {
  pageId: string;
  title?: string;
  content: string;
}

export async function updateDocument(
  cfg: DocmostConfig,
  input: UpdateDocumentInput,
): Promise<DocContent> {
  if (!cfg.apiToken) throw new Error("API token Docmost belum diisi.");
  const base = cfg.baseUrl.replace(/\/+$/, "");

  const body: Record<string, unknown> = {
    pageId: input.pageId,
    operation: "replace",
    content: input.content,
    format: "markdown",
  };
  if (input.title) body.title = input.title;

  const res = await request(`${base}/api/pages/update`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${statusMessage(res.status)} ${truncate(res.text, 300)}`);
  }

  return {
    id: input.pageId,
    title: input.title,
    content: input.content,
  };
}
