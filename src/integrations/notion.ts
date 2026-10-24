import type { NotionConfig } from "../config/schema.ts";
import type { DocContent, DocSummary } from "./docmost.ts";
import { request, type TestResult, truncate } from "./http.ts";

const NOTION_API = "https://api.notion.com";
const NOTION_VERSION = "2022-06-28";

export interface ListDocumentsResult {
  documents: DocSummary[];
  sample?: string;
}

function statusMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Ditolak (401/403): token tidak valid atau halaman belum dibagikan ke integration.";
  }
  if (status === 404) return "Halaman tidak ditemukan (404).";
  if (status === 429) return "Rate limit (429): coba lagi nanti.";
  return `Notion merespons HTTP ${status}.`;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function requireToken(cfg: NotionConfig): string {
  if (!cfg.apiToken) throw new Error("Integration token Notion belum diisi.");
  return cfg.apiToken;
}

function richTextPlain(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const row = item as Record<string, unknown>;
      return String(row.plain_text ?? "");
    })
    .join("");
}

function pageTitle(page: Record<string, unknown>): string {
  const props = page.properties as Record<string, unknown> | undefined;
  if (props) {
    for (const value of Object.values(props)) {
      if (!value || typeof value !== "object") continue;
      const prop = value as Record<string, unknown>;
      if (prop.type === "title") {
        const title = richTextPlain(prop.title);
        if (title) return title;
      }
    }
  }
  const childPage = page.child_page as Record<string, unknown> | undefined;
  if (childPage?.title) return String(childPage.title);
  const childDb = page.child_database as Record<string, unknown> | undefined;
  if (childDb?.title) return String(childDb.title);
  return "(untitled)";
}

function toPageSummary(item: Record<string, unknown>): DocSummary | null {
  const object = String(item.object ?? "");
  const type = String(item.type ?? "");
  const id = item.id ? String(item.id) : null;
  if (!id) return null;

  if (object === "page" || type === "child_page") {
    return {
      id,
      title: pageTitle(item),
      hasChildren: true,
    };
  }
  if (object === "database" || type === "child_database") {
    return {
      id,
      title: pageTitle(item),
      hasChildren: true,
    };
  }
  return null;
}

async function notionRequest(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<{ status: number; ok: boolean; text: string }> {
  const method = init.method ?? "GET";
  const res = await request(`${NOTION_API}${path}`, {
    ...init,
    method,
    headers: { ...headers(token), ...(init.headers as Record<string, string> | undefined) },
  });
  return res;
}

export async function testNotion(cfg: NotionConfig): Promise<TestResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  if (!cfg.apiToken) {
    return { ok: false, message: "Integration token belum diisi.", latencyMs: elapsed() };
  }
  try {
    const res = await notionRequest("/v1/users/me", cfg.apiToken);
    if (res.ok) {
      return {
        ok: true,
        status: res.status,
        message: "Notion merespons.",
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
      message: `Gagal menghubungi Notion: ${(error as Error).message}`,
      latencyMs: elapsed(),
    };
  }
}

async function listBlockChildren(cfg: NotionConfig, blockId: string): Promise<DocSummary[]> {
  const token = requireToken(cfg);
  const documents: DocSummary[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);
    const res = await notionRequest(
      `/v1/blocks/${encodeURIComponent(blockId)}/children?${query}`,
      token,
    );
    if (!res.ok) throw new Error(`${statusMessage(res.status)} ${truncate(res.text, 300)}`);
    const json = JSON.parse(res.text || "{}") as Record<string, unknown>;
    const results = Array.isArray(json.results) ? json.results as Record<string, unknown>[] : [];
    for (const item of results) {
      const summary = toPageSummary(item);
      if (summary) documents.push(summary);
    }
    cursor = json.has_more && json.next_cursor ? String(json.next_cursor) : undefined;
  } while (cursor);
  return documents;
}

async function searchPages(cfg: NotionConfig): Promise<ListDocumentsResult> {
  const token = requireToken(cfg);
  const documents: DocSummary[] = [];
  let cursor: string | undefined;
  let sample: string | undefined;
  do {
    const body: Record<string, unknown> = {
      page_size: 50,
      filter: { property: "object", value: "page" },
    };
    if (cursor) body.start_cursor = cursor;
    const res = await notionRequest("/v1/search", token, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${statusMessage(res.status)} ${truncate(res.text, 300)}`);
    const json = JSON.parse(res.text || "{}") as Record<string, unknown>;
    if (!sample) sample = truncate(res.text, 800);
    const results = Array.isArray(json.results) ? json.results as Record<string, unknown>[] : [];
    for (const item of results) {
      const summary = toPageSummary(item);
      if (summary) documents.push(summary);
    }
    cursor = json.has_more && json.next_cursor ? String(json.next_cursor) : undefined;
  } while (cursor);
  return { documents, sample };
}

export async function listDocuments(
  cfg: NotionConfig,
  pageId?: string,
): Promise<ListDocumentsResult> {
  requireToken(cfg);
  const root = pageId?.trim() || cfg.parentPageId?.trim();
  if (root) {
    const documents = await listBlockChildren(cfg, root);
    return {
      documents,
      ...(documents.length === 0 ? { sample: `Tidak ada child page di ${root}.` } : {}),
    };
  }
  return await searchPages(cfg);
}

function blockToMarkdown(block: Record<string, unknown>, depth = 0): string {
  const type = String(block.type ?? "");
  const data = (block[type] as Record<string, unknown> | undefined) ?? {};
  const text = richTextPlain(data.rich_text ?? data.text);
  const indent = "  ".repeat(depth);

  switch (type) {
    case "paragraph":
      return text ? `${indent}${text}\n\n` : "\n";
    case "heading_1":
      return `# ${text}\n\n`;
    case "heading_2":
      return `## ${text}\n\n`;
    case "heading_3":
      return `### ${text}\n\n`;
    case "bulleted_list_item":
      return `${indent}- ${text}\n`;
    case "numbered_list_item":
      return `${indent}1. ${text}\n`;
    case "to_do": {
      const checked = Boolean(data.checked);
      return `${indent}- [${checked ? "x" : " "}] ${text}\n`;
    }
    case "quote":
      return `> ${text}\n\n`;
    case "code": {
      const lang = data.language ? String(data.language) : "";
      return `\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
    }
    case "divider":
      return `---\n\n`;
    case "child_page":
      return `${indent}- [[${String(data.title ?? "Untitled")}]]\n`;
    case "child_database":
      return `${indent}- Database: ${String(data.title ?? "Untitled")}\n`;
    case "image": {
      const file = data.file as Record<string, unknown> | undefined;
      const external = data.external as Record<string, unknown> | undefined;
      const url = String(file?.url ?? external?.url ?? "");
      const caption = richTextPlain(data.caption);
      return url ? `![${caption || "image"}](${url})\n\n` : "";
    }
    default:
      return text ? `${indent}${text}\n\n` : "";
  }
}

async function listRawBlocks(
  cfg: NotionConfig,
  blockId: string,
): Promise<Record<string, unknown>[]> {
  const token = requireToken(cfg);
  const blocks: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);
    const res = await notionRequest(
      `/v1/blocks/${encodeURIComponent(blockId)}/children?${query}`,
      token,
    );
    if (!res.ok) throw new Error(`${statusMessage(res.status)} ${truncate(res.text, 300)}`);
    const json = JSON.parse(res.text || "{}") as Record<string, unknown>;
    const results = Array.isArray(json.results) ? json.results as Record<string, unknown>[] : [];
    blocks.push(...results);
    cursor = json.has_more && json.next_cursor ? String(json.next_cursor) : undefined;
  } while (cursor);
  return blocks;
}

async function blocksToMarkdown(
  cfg: NotionConfig,
  blockId: string,
  depth = 0,
): Promise<string> {
  const blocks = await listRawBlocks(cfg, blockId);
  let out = "";
  for (const block of blocks) {
    out += blockToMarkdown(block, depth);
    if (block.has_children && block.id && block.type !== "child_page" &&
      block.type !== "child_database") {
      out += await blocksToMarkdown(cfg, String(block.id), depth + 1);
    }
  }
  return out;
}

export async function getDocument(cfg: NotionConfig, pageId: string): Promise<DocContent> {
  const token = requireToken(cfg);
  const pageRes = await notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`, token);
  if (!pageRes.ok) throw new Error(`${statusMessage(pageRes.status)} ${truncate(pageRes.text, 300)}`);
  const page = JSON.parse(pageRes.text || "{}") as Record<string, unknown>;
  const title = pageTitle(page);
  const content = await blocksToMarkdown(cfg, pageId);
  return { id: pageId, title, content };
}
