import { dirname, join } from "node:path";
import type { LlmProviderRow } from "../../db/db.ts";
import { listWorkspaceFiles, resolveWithin } from "../../fs/workspace.ts";
import type { ChatTurn, ToolCall } from "./types.ts";

const CURSOR_DEFAULT_MODEL = "composer-2";
const CURSOR_TIMEOUT_MS = 180_000;
const CURSOR_TOOLS = ["read", "grep", "glob", "ls", "edit", "task"] as const;
const MAX_FILES = 3000;
const MAX_WRITE_BYTES = 500_000;
const MAX_WRITES = 100;
const CURSOR_CALL_PREFIX = "cursor_";

function textAttachments(turn: ChatTurn): string {
  if (!turn.attachments?.length) return "";
  return turn.attachments
    .filter((item) => item.type === "text")
    .map((item) => `\n\n--- ${item.name} ---\n${(item.data ?? "").slice(0, 200_000)}`)
    .join("");
}

function promptFor(turns: ChatTurn[]): string {
  const system = turns
    .filter((turn) => turn.role === "system")
    .map((turn) => turn.content)
    .join("\n\n");
  const conversation = turns
    .filter((turn) => turn.role !== "system")
    .map((turn) => {
      if (turn.role === "tool") return `Tool result:\n${turn.content}`;
      if (turn.role === "assistant") {
        const calls = turn.toolCalls?.length
          ? `\nTool calls: ${turn.toolCalls.map((call) => call.name).join(", ")}`
          : "";
        return `Assistant:\n${turn.content}${calls}`;
      }
      return `User:\n${turn.content}${textAttachments(turn)}`;
    })
    .join("\n\n");

  const instruction = system ? `Additional instructions from the application:\n${system}\n\n` : "";
  const runtime =
    "Runtime note: you can inspect files with read, grep, glob, and ls and edit them " +
    "with edit (including Write and StrReplace). Shell and delete are unavailable. All file edits " +
    "are staged and shown to the user for approval, so finish with a short summary.";
  return `${instruction}${runtime}\n\n` +
    `Continue the conversation below as the assistant. Answer the latest user message.\n\n` +
    conversation;
}

function imageParts(turns: ChatTurn[]): Array<{ data: string; mimeType: string }> {
  const lastUser = [...turns].reverse().find((turn) => turn.role === "user");
  if (!lastUser?.attachments?.length) return [];
  const images: Array<{ data: string; mimeType: string }> = [];
  for (const item of lastUser.attachments) {
    if (item.type !== "image" || !item.data) continue;
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(item.data.trim());
    if (!match) continue;
    images.push({
      data: match[2].replace(/\s+/g, ""),
      mimeType: match[1].toLowerCase(),
    });
  }
  return images;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function copyWorkspace(workspace: string): Promise<string> {
  const temp = await Deno.makeTempDir({ prefix: "rnd-cursor-" });
  const index = await listWorkspaceFiles(workspace, MAX_FILES);
  for (const rel of index.files) {
    const source = resolveWithin(workspace, rel);
    if (!source) continue;
    const target = join(temp, rel);
    try {
      await Deno.mkdir(dirname(target), { recursive: true });
      await Deno.copyFile(source, target);
    } catch {
      // skip unreadable files
    }
  }
  return temp;
}

export async function collectCursorWrites(
  temp: string,
  workspace: string,
): Promise<{ writes: Array<{ path: string; content: string }>; notes: string[] }> {
  const index = await listWorkspaceFiles(temp, MAX_FILES);
  const writes: Array<{ path: string; content: string }> = [];
  const notes: string[] = [];
  const decoder = new TextDecoder();
  let skipped = 0;

  for (const rel of index.files) {
    if (rel === ".cursor" || rel.startsWith(".cursor/")) continue;
    if (writes.length >= MAX_WRITES) {
      notes.push(`Perubahan dibatasi ${MAX_WRITES} file; sisanya tidak diajukan.`);
      break;
    }
    const target = join(temp, rel);
    let bytes: Uint8Array;
    try {
      bytes = await Deno.readFile(target);
    } catch {
      continue;
    }
    const source = resolveWithin(workspace, rel);
    const before = source ? await Deno.readFile(source).catch(() => null) : null;
    if (before && sameBytes(before, bytes)) continue;
    if (bytes.byteLength > MAX_WRITE_BYTES || bytes.includes(0)) {
      skipped += 1;
      continue;
    }
    writes.push({ path: rel, content: decoder.decode(bytes) });
  }

  if (skipped > 0) {
    notes.push(`${skipped} file biner/terlalu besar tidak diajukan untuk review.`);
  }
  return { writes, notes };
}

function isPendingCursorToolTurn(turn: ChatTurn | undefined): boolean {
  return turn?.role === "tool" && !!turn.toolCallId?.startsWith(CURSOR_CALL_PREFIX);
}

export async function completeCursor(
  provider: LlmProviderRow,
  turns: ChatTurn[],
  workspace?: string | null,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const apiKey = provider.api_key?.trim();
  if (!apiKey) throw new Error("Cursor API key belum diisi.");
  const model = provider.model?.trim() || CURSOR_DEFAULT_MODEL;

  if (isPendingCursorToolTurn(turns[turns.length - 1])) {
    return {
      text: "Perubahan dari Cursor sudah diproses. Beri tahu saya jika ada yang perlu dilanjutkan.",
      toolCalls: [],
    };
  }

  const temp = workspace ? await copyWorkspace(workspace) : null;
  const { Agent } = await import("@cursor/sdk");
  const agent = await Agent.create({
    apiKey,
    model: { id: model },
    tools: [...CURSOR_TOOLS],
    ...(temp ? { local: { cwd: temp } } : {}),
  });

  try {
    const images = imageParts(turns);
    const run = await agent.send({
      text: promptFor(turns),
      ...(images.length ? { images } : {}),
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void run.cancel().catch(() => {});
        reject(new Error(`Cursor run timeout setelah ${CURSOR_TIMEOUT_MS / 1000} detik.`));
      }, CURSOR_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([run.wait(), timeout]);
      if (result.status !== "finished") {
        throw new Error(result.error?.message ?? `Cursor run ${result.status}.`);
      }
      if (!temp || !workspace) {
        return { text: result.result ?? "", toolCalls: [] };
      }
      const { writes, notes } = await collectCursorWrites(temp, workspace);
      const text = [result.result ?? "", ...notes].filter(Boolean).join("\n\n");
      return {
        text,
        toolCalls: writes.map((write) => ({
          id: `${CURSOR_CALL_PREFIX}${crypto.randomUUID()}`,
          name: "write_file",
          arguments: JSON.stringify(write),
        })),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } finally {
    agent.close();
    if (temp) {
      try {
        await Deno.remove(temp, { recursive: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

export interface CursorModelInfo {
  id: string;
  name: string;
  description?: string;
}

export async function listCursorModels(apiKey: string): Promise<CursorModelInfo[]> {
  if (!apiKey.trim()) throw new Error("Cursor API key belum diisi.");
  const { Cursor } = await import("@cursor/sdk");
  const models = await Cursor.models.list({ apiKey });
  return models.map((model) => ({
    id: model.id,
    name: model.displayName || model.id,
    description: model.description,
  }));
}

export async function testCursor(
  apiKey: string,
): Promise<{ ok: boolean; message: string; count?: number }> {
  if (!apiKey.trim()) return { ok: false, message: "Cursor API key belum diisi." };
  const { Cursor } = await import("@cursor/sdk");
  const models = await Cursor.models.list({ apiKey });
  return {
    ok: true,
    message: `Cursor terhubung (${models.length} model tersedia).`,
    count: models.length,
  };
}
