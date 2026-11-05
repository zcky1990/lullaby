import { api, type DocumentSource, type TicketSource } from "@/lib/api";
import type { ChatDragDocument, ChatDragSource, ChatDragTicket } from "@/lib/chat-drag";

/**
 * Konversi item dokumen/tiket menjadi lampiran teks untuk chat.
 *
 * Server chat menerima lampiran `{ type: "text", data }`, jadi isi dokumen/tiket
 * dikirim sebagai markdown di dalam lampiran — bukan sebagai path file — karena
 * dokumen bisa berasal dari Docmost/Notion/Confluence.
 */
export const MAX_CONTEXT_CHARS = 180_000;

export interface ChatContextAttachment {
  name: string;
  text: string;
}

const SOURCE_LABEL: Record<ChatDragSource | TicketSource, string> = {
  local: "Local",
  docmost: "Docmost",
  notion: "Notion",
  confluence: "Confluence",
  jira: "Jira",
  clickup: "ClickUp",
};

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

export function clipContext(text: string, max = MAX_CONTEXT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…(dipotong karena terlalu panjang)`;
}

/** Deskripsi tiket dari Jira/ClickUp sering berupa HTML; ubah jadi teks biasa. */
export function htmlToPlainText(value: string): string {
  return value
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value);
}

export interface ChatDocumentContextInput {
  title: string;
  source: ChatDragSource;
  content: string;
  path?: string;
  id?: string;
}

export function formatDocumentContext(doc: ChatDocumentContextInput): ChatContextAttachment {
  const meta = [`- Sumber: ${SOURCE_LABEL[doc.source]}`];
  if (doc.path) meta.push(`- Path: ${doc.path}`);
  if (doc.id) meta.push(`- Page ID: ${doc.id}`);
  const body = doc.content.trim() || "_Dokumen kosong._";
  const text = [
    `# Dokumen: ${doc.title}`,
    "",
    ...meta,
    "",
    "---",
    "",
    body,
  ].join("\n");
  return { name: doc.title, text: clipContext(text) };
}

export interface ChatTicketContextInput {
  key: string;
  summary: string;
  status?: string;
  priority?: string;
  type?: string;
  assignee?: string;
  reporter?: string;
  updated?: string;
  url?: string;
  labels?: string[];
  description?: string;
  source?: TicketSource;
}

export function formatTicketContext(ticket: ChatTicketContextInput): ChatContextAttachment {
  const rawDescription = ticket.description?.trim() ?? "";
  const description = rawDescription && looksLikeHtml(rawDescription)
    ? htmlToPlainText(rawDescription)
    : rawDescription;
  const meta: string[] = [];
  if (ticket.status) meta.push(`- Status: ${ticket.status}`);
  if (ticket.priority) meta.push(`- Prioritas: ${ticket.priority}`);
  if (ticket.type) meta.push(`- Tipe: ${ticket.type}`);
  if (ticket.assignee) meta.push(`- Assignee: ${ticket.assignee}`);
  if (ticket.reporter) meta.push(`- Reporter: ${ticket.reporter}`);
  if (ticket.labels?.length) meta.push(`- Label: ${ticket.labels.join(", ")}`);
  if (ticket.updated) meta.push(`- Update: ${ticket.updated}`);
  if (ticket.url) meta.push(`- Link: ${ticket.url}`);
  if (ticket.source) meta.push(`- Sumber: ${SOURCE_LABEL[ticket.source]}`);

  const lines = [`# Tiket ${ticket.key}: ${ticket.summary}`, ""];
  if (meta.length) lines.push(...meta, "");
  lines.push("## Deskripsi", description || "_Tidak ada deskripsi._");
  return {
    name: `${ticket.key} — ${ticket.summary}`,
    text: clipContext(lines.join("\n")),
  };
}

export async function buildDocumentContext(
  projectId: string,
  payload: ChatDragDocument,
): Promise<ChatContextAttachment> {
  if (payload.source === "local") {
    const { document } = await api.getLocalDocument(projectId, payload.path ?? "");
    return formatDocumentContext({
      title: document.title || payload.title,
      source: "local",
      path: document.path,
      content: document.content,
    });
  }
  const source: DocumentSource = payload.source;
  const { document } = await api.getDocument(projectId, payload.id ?? "", source);
  return formatDocumentContext({
    title: document.title || payload.title,
    source,
    id: payload.id,
    content: document.content,
  });
}

export async function buildTicketContext(
  projectId: string,
  payload: ChatDragTicket,
): Promise<ChatContextAttachment> {
  if (payload.localId) {
    const { ticket } = await api.getLocalTicket(projectId, payload.localId);
    return formatTicketContext(ticket);
  }
  const source = payload.source === "jira" || payload.source === "clickup"
    ? payload.source
    : undefined;
  const { ticket } = await api.getTicket(projectId, payload.key, source);
  return formatTicketContext(ticket);
}
