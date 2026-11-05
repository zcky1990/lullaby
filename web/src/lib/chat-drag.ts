import type { DocumentSource, TicketSource } from "@/lib/api";

/**
 * Kontrak drag-and-drop untuk "seret item dokumen/tiket ke chat sidebar".
 *
 * MIME custom dipakai supaya drop target chat bisa membedakan dokumen/tiket
 * dari file biasa (`Files`) atau path workspace (`application/x-rnd-workspace-path`).
 * `text/plain` tetap diisi sebagai fallback bila item diseret keluar aplikasi.
 */
export const CHAT_DOCUMENT_MIME = "application/x-rnd-chat-document";
export const CHAT_TICKET_MIME = "application/x-rnd-chat-ticket";
export const WORKSPACE_PATH_MIME = "application/x-rnd-workspace-path";

/** Event untuk membuka panel chat saat user mulai menyeret dokumen/tiket. */
export const CHAT_OPEN_REQUEST_EVENT = "rnd:chat-open-request";

export type ChatDragSource = "local" | DocumentSource;

export interface ChatDragDocument {
  kind: "document";
  source: ChatDragSource;
  title: string;
  /** Path relatif, hanya untuk dokumen lokal. */
  path?: string;
  /** Page id, hanya untuk dokumen remote (Docmost/Notion/Confluence). */
  id?: string;
}

export interface ChatDragTicket {
  kind: "ticket";
  key: string;
  title: string;
  localId?: string;
  source?: TicketSource;
}

export type ChatDragPayload = ChatDragDocument | ChatDragTicket;

const DOCUMENT_SOURCES: ChatDragSource[] = ["local", "docmost", "notion", "confluence"];
const TICKET_SOURCES: TicketSource[] = ["local", "jira", "clickup"];

export function chatDragMime(payload: ChatDragPayload): string {
  return payload.kind === "ticket" ? CHAT_TICKET_MIME : CHAT_DOCUMENT_MIME;
}

export function setChatDragData(dataTransfer: DataTransfer, payload: ChatDragPayload): void {
  dataTransfer.setData(chatDragMime(payload), JSON.stringify(payload));
  dataTransfer.setData(
    "text/plain",
    payload.kind === "ticket" ? `${payload.key} ${payload.title}` : payload.title,
  );
  dataTransfer.effectAllowed = "copy";
}

/** Dipanggil di dragstart supaya chat sidebar terbuka jika masih tertutup. */
export function requestChatOpen(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHAT_OPEN_REQUEST_EVENT));
}

/** `dragover` tidak boleh membaca data, jadi deteksi lewat daftar MIME. */
export function isChatDragType(types: readonly string[]): boolean {
  return types.includes(CHAT_DOCUMENT_MIME) || types.includes(CHAT_TICKET_MIME);
}

export function readChatDragData(dataTransfer: DataTransfer): ChatDragPayload | null {
  return (
    parseChatDragPayload(read(dataTransfer, CHAT_DOCUMENT_MIME)) ??
      parseChatDragPayload(read(dataTransfer, CHAT_TICKET_MIME))
  );
}

function read(dataTransfer: DataTransfer, mime: string): string {
  try {
    return dataTransfer.getData(mime) ?? "";
  } catch {
    return "";
  }
}

export function parseChatDragPayload(raw: string): ChatDragPayload | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;

  const data = value as Record<string, unknown>;
  const title = typeof data.title === "string" ? data.title.trim() : "";
  if (!title) return null;

  if (data.kind === "document") {
    const source = typeof data.source === "string" ? data.source : "";
    if (!DOCUMENT_SOURCES.includes(source as ChatDragSource)) return null;
    const path = typeof data.path === "string" ? data.path.trim() : "";
    const id = typeof data.id === "string" ? data.id.trim() : "";
    if (source === "local" ? !path : !id) return null;
    return {
      kind: "document",
      source: source as ChatDragSource,
      title,
      ...(path ? { path } : {}),
      ...(id ? { id } : {}),
    };
  }

  if (data.kind === "ticket") {
    const key = typeof data.key === "string" ? data.key.trim() : "";
    if (!key) return null;
    const localId = typeof data.localId === "string" ? data.localId.trim() : "";
    const source = typeof data.source === "string" &&
        TICKET_SOURCES.includes(data.source as TicketSource)
      ? (data.source as TicketSource)
      : undefined;
    return {
      kind: "ticket",
      key,
      title,
      ...(localId ? { localId } : {}),
      ...(source ? { source } : {}),
    };
  }

  return null;
}
