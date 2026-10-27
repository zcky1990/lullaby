import type { ConfluenceConfig } from "../config/schema.ts";
import type { DocContent, DocSummary } from "./docmost.ts";
import { request, type TestResult, truncate } from "./http.ts";

export interface ListDocumentsResult {
  documents: DocSummary[];
  sample?: string;
}

const SPACE_PREFIX = "space:";

function statusMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Ditolak (401/403): email/token tidak valid atau tidak punya akses.";
  }
  if (status === 404) return "Endpoint/halaman tidak ditemukan (404): periksa baseUrl.";
  if (status === 429) return "Rate limit (429): coba lagi nanti.";
  return `Confluence merespons HTTP ${status}.`;
}

function apiRoot(cfg: ConfluenceConfig): string {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  if (/\/wiki$/i.test(base)) return base;
  return `${base}/wiki`;
}

function authHeader(cfg: ConfluenceConfig): string | null {
  if (!cfg.email || !cfg.apiToken) return null;
  return `Basic ${btoa(`${cfg.email}:${cfg.apiToken}`)}`;
}

function headers(cfg: ConfluenceConfig): Record<string, string> {
  const auth = authHeader(cfg);
  const out: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (auth) out.Authorization = auth;
  return out;
}

function spaceId(key: string): string {
  return `${SPACE_PREFIX}${key}`;
}

function parseSpaceId(id: string): string | null {
  return id.startsWith(SPACE_PREFIX) ? id.slice(SPACE_PREFIX.length) : null;
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h([1-6])>/gi, "\n\n")
    .replace(/<h([1-6])[^>]*>/gi, (_, level) => `${"#".repeat(Number(level))} `)
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<code[^>]*>/gi, "`")
    .replace(/<\/code>/gi, "`")
    .replace(/<pre[^>]*>/gi, "```\n")
    .replace(/<\/pre>/gi, "\n```\n")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function confluenceGet(
  cfg: ConfluenceConfig,
  path: string,
): Promise<{ status: number; ok: boolean; text: string }> {
  return await request(`${apiRoot(cfg)}${path}`, {
    method: "GET",
    headers: headers(cfg),
  });
}

export async function testConfluence(cfg: ConfluenceConfig): Promise<TestResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  if (!cfg.email || !cfg.apiToken) {
    return {
      ok: false,
      message: "Email dan API token belum diisi.",
      latencyMs: elapsed(),
    };
  }
  try {
    const res = await confluenceGet(cfg, "/rest/api/space?limit=1");
    if (res.ok) {
      return {
        ok: true,
        status: res.status,
        message: "Confluence merespons.",
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
      message: `Gagal menghubungi Confluence: ${(error as Error).message}`,
      latencyMs: elapsed(),
    };
  }
}

async function listSpaces(cfg: ConfluenceConfig): Promise<ListDocumentsResult> {
  const documents: DocSummary[] = [];
  let start = 0;
  let sample: string | undefined;
  for (;;) {
    const res = await confluenceGet(cfg, `/rest/api/space?limit=50&start=${start}`);
    if (!res.ok) throw new Error(`${statusMessage(res.status)} ${truncate(res.text, 300)}`);
    if (!sample) sample = truncate(res.text, 800);
    const json = JSON.parse(res.text || "{}") as Record<string, unknown>;
    const results = Array.isArray(json.results) ? json.results as Record<string, unknown>[] : [];
    for (const space of results) {
      const key = space.key ? String(space.key) : null;
      if (!key) continue;
      documents.push({
        id: spaceId(key),
        title: String(space.name ?? key),
        spaceId: key,
        hasChildren: true,
      });
    }
    const size = Number(json.size ?? results.length);
    const limit = Number(json.limit ?? 50);
    if (size < limit) break;
    start += limit;
  }
  return { documents, sample };
}

async function listPagesInSpace(
  cfg: ConfluenceConfig,
  spaceKey: string,
  parentId?: string,
): Promise<ListDocumentsResult> {
  const documents: DocSummary[] = [];
  let start = 0;
  let sample: string | undefined;
  const baseQuery = parentId
    ? `/rest/api/content/${encodeURIComponent(parentId)}/child/page?limit=50&start=`
    : `/rest/api/content?spaceKey=${
      encodeURIComponent(spaceKey)
    }&type=page&expand=ancestors,children.page&limit=50&start=`;

  for (;;) {
    const res = await confluenceGet(cfg, `${baseQuery}${start}`);
    if (!res.ok) throw new Error(`${statusMessage(res.status)} ${truncate(res.text, 300)}`);
    if (!sample) sample = truncate(res.text, 800);
    const json = JSON.parse(res.text || "{}") as Record<string, unknown>;
    const results = Array.isArray(json.results) ? json.results as Record<string, unknown>[] : [];

    for (const page of results) {
      if (!parentId) {
        const ancestors = page.ancestors as unknown[] | undefined;
        if (Array.isArray(ancestors) && ancestors.length > 0) continue;
      }
      const id = page.id ? String(page.id) : null;
      if (!id) continue;
      const children = (page.children as Record<string, unknown> | undefined)?.page as
        | Record<string, unknown>
        | undefined;
      const childSize = Number(children?.size ?? 0);
      documents.push({
        id,
        title: String(page.title ?? "(untitled)"),
        spaceId: spaceKey,
        hasChildren: childSize > 0 || Boolean(page.hasChildren),
      });
    }

    const size = Number(json.size ?? results.length);
    const limit = Number(json.limit ?? 50);
    if (size < limit) break;
    start += limit;
  }

  return { documents, sample };
}

export async function listDocuments(
  cfg: ConfluenceConfig,
  pageId?: string,
): Promise<ListDocumentsResult> {
  if (!cfg.email || !cfg.apiToken) {
    throw new Error("Email/API token Confluence belum diisi.");
  }
  if (pageId) {
    const spaceKey = parseSpaceId(pageId);
    if (spaceKey) return await listPagesInSpace(cfg, spaceKey);
    const pageRes = await confluenceGet(
      cfg,
      `/rest/api/content/${encodeURIComponent(pageId)}?expand=space`,
    );
    if (!pageRes.ok) {
      throw new Error(`${statusMessage(pageRes.status)} ${truncate(pageRes.text, 300)}`);
    }
    const page = JSON.parse(pageRes.text || "{}") as Record<string, unknown>;
    const space = page.space as Record<string, unknown> | undefined;
    const key = String(space?.key ?? cfg.spaceKey ?? "");
    return await listPagesInSpace(cfg, key, pageId);
  }

  const spaceKey = cfg.spaceKey?.trim();
  if (spaceKey) return await listPagesInSpace(cfg, spaceKey);
  return await listSpaces(cfg);
}

export async function getDocument(cfg: ConfluenceConfig, pageId: string): Promise<DocContent> {
  if (!cfg.email || !cfg.apiToken) {
    throw new Error("Email/API token Confluence belum diisi.");
  }
  if (parseSpaceId(pageId)) {
    throw new Error("Pilih halaman, bukan space.");
  }
  const res = await confluenceGet(
    cfg,
    `/rest/api/content/${encodeURIComponent(pageId)}?expand=body.storage,body.view,space`,
  );
  if (!res.ok) throw new Error(`${statusMessage(res.status)} ${truncate(res.text, 300)}`);
  const page = JSON.parse(res.text || "{}") as Record<string, unknown>;
  const body = page.body as Record<string, unknown> | undefined;
  const storage = body?.storage as Record<string, unknown> | undefined;
  const view = body?.view as Record<string, unknown> | undefined;
  const raw = String(view?.value ?? storage?.value ?? "");
  return {
    id: pageId,
    title: String(page.title ?? "(untitled)"),
    content: htmlToPlain(raw),
  };
}
