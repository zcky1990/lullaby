import { dirname, join } from "node:path";
import type { LlmProviderRow } from "../../db/db.ts";
import { listWorkspaceFiles, resolveWithin } from "../../fs/workspace.ts";
import type { ChatTurn, ToolCall } from "./types.ts";

const CURSOR_DEFAULT_MODEL = "composer-2";
const CURSOR_TIMEOUT_MS = 180_000;
const CURSOR_BUILD_TOOLS = ["read", "grep", "glob", "ls", "edit", "task"] as const;
const CURSOR_PLAN_TOOLS = ["read", "grep", "glob", "ls", "task"] as const;
const MAX_FILES = 3000;
const MAX_WRITE_BYTES = 500_000;
const MAX_WRITES = 100;
const CURSOR_CALL_PREFIX = "cursor_";

export interface CursorCompleteOptions {
  workspace?: string | null;
  cursorAgentId?: string | null;
  mode?: "plan" | "build";
}

export interface CursorConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CursorCompleteResult {
  text: string;
  toolCalls: ToolCall[];
  cursorAgentId?: string;
  conversation?: CursorConversationMessage[];
}

function textAttachments(turn: ChatTurn): string {
  if (!turn.attachments?.length) return "";
  return turn.attachments
    .filter((item) => item.type === "text")
    .map((item) => `\n\n--- ${item.name} ---\n${(item.data ?? "").slice(0, 200_000)}`)
    .join("");
}

export function latestUserPrompt(turns: ChatTurn[]): string {
  const lastUser = [...turns].reverse().find((turn) => turn.role === "user");
  if (!lastUser) return "";
  return `${lastUser.content}${textAttachments(lastUser)}`.trim();
}

export function bootstrapCursorPrompt(turns: ChatTurn[]): string {
  const system = turns
    .filter((turn) => turn.role === "system")
    .map((turn) => turn.content)
    .join("\n\n");
  const user = latestUserPrompt(turns);
  const instruction = system ? `Additional instructions from the application:\n${system}\n\n` : "";
  const runtime =
    "Runtime note: you can inspect files with read, grep, glob, and ls and edit them " +
    "with edit (including Write and StrReplace) when available. Shell and delete are unavailable. " +
    "All file edits are staged and shown to the user for approval, so finish with a short summary.";
  return `${instruction}${runtime}\n\n${user}`;
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

function extractTextBlocks(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: string; text?: string };
    if (item.type === "text" && typeof item.text === "string" && item.text.trim()) {
      parts.push(item.text.trim());
    }
  }
  return parts.join("\n\n").trim();
}

export function conversationFromSdkTurns(raw: unknown): CursorConversationMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: CursorConversationMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const turn = item as {
      type?: string;
      turn?: {
        userMessage?: { text?: string };
        steps?: Array<{ type?: string; message?: { text?: string } }>;
      };
    };
    if (turn.type !== "agentConversationTurn" || !turn.turn) continue;
    const userText = turn.turn.userMessage?.text?.trim();
    if (userText) out.push({ role: "user", content: userText });
    for (const step of turn.turn.steps ?? []) {
      if (step.type === "assistantMessage" && step.message?.text?.trim()) {
        out.push({ role: "assistant", content: step.message.text.trim() });
      }
    }
  }
  return out;
}

async function disposeAgent(agent: { close?: () => void | Promise<void> }): Promise<void> {
  try {
    await agent.close?.();
  } catch {
    // ignore dispose errors
  }
}

export async function completeCursor(
  provider: LlmProviderRow,
  turns: ChatTurn[],
  options: CursorCompleteOptions | string | null = {},
): Promise<CursorCompleteResult> {
  const opts: CursorCompleteOptions = typeof options === "string" || options == null
    ? { workspace: options }
    : options;

  const apiKey = provider.api_key?.trim();
  if (!apiKey) throw new Error("Cursor API key belum diisi.");
  const model = provider.model?.trim() || CURSOR_DEFAULT_MODEL;
  const mode = opts.mode ?? "build";

  if (isPendingCursorToolTurn(turns[turns.length - 1])) {
    return {
      text: "Perubahan dari Cursor sudah diproses. Beri tahu saya jika ada yang perlu dilanjutkan.",
      toolCalls: [],
      cursorAgentId: opts.cursorAgentId ?? undefined,
    };
  }

  const workspace = opts.workspace ?? null;
  const temp = workspace ? await copyWorkspace(workspace) : null;
  const { Agent, CursorAgentError } = await import("@cursor/sdk");

  const tools = mode === "plan" ? [...CURSOR_PLAN_TOOLS] : [...CURSOR_BUILD_TOOLS];
  const agentOptions = {
    apiKey,
    model: { id: model },
    tools,
    ...(temp ? { local: { cwd: temp } } : {}),
    ...(mode === "plan" ? { mode: "plan" as const } : {}),
  };
  let agent: Awaited<ReturnType<typeof Agent.create>>;
  let resumed = false;

  try {
    if (opts.cursorAgentId) {
      try {
        agent = await Agent.resume(opts.cursorAgentId, agentOptions);
        resumed = true;
      } catch {
        agent = await Agent.create(agentOptions);
      }
    } else {
      agent = await Agent.create(agentOptions);
    }

    const prompt = resumed ? latestUserPrompt(turns) : bootstrapCursorPrompt(turns);
    if (!prompt.trim()) {
      await disposeAgent(agent);
      throw new Error("Pesan user kosong.");
    }

    const images = imageParts(turns);
    let run: Awaited<ReturnType<typeof agent.send>>;
    try {
      run = await agent.send({
        text: prompt,
        ...(images.length ? { images } : {}),
        ...(mode === "plan" ? { mode: "plan" } : {}),
      });
    } catch (error) {
      await disposeAgent(agent);
      if (error instanceof CursorAgentError) {
        throw new Error(`Cursor gagal start: ${error.message}`);
      }
      throw error;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void run.cancel?.().catch(() => {});
        reject(new Error(`Cursor run timeout setelah ${CURSOR_TIMEOUT_MS / 1000} detik.`));
      }, CURSOR_TIMEOUT_MS);
    });

    try {
      const result = await Promise.race([run.wait(), timeout]);
      if (result.status !== "finished") {
        throw new Error(result.error?.message ?? `Cursor run ${result.status}.`);
      }

      let conversation: CursorConversationMessage[] | undefined;
      try {
        if (typeof run.supports === "function" && run.supports("conversation")) {
          conversation = conversationFromSdkTurns(await run.conversation());
        }
      } catch {
        conversation = undefined;
      }

      const agentId = typeof agent.agentId === "string" ? agent.agentId : undefined;
      if (!temp || !workspace) {
        return {
          text: result.result ?? "",
          toolCalls: [],
          cursorAgentId: agentId,
          conversation,
        };
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
        cursorAgentId: agentId,
        conversation,
      };
    } finally {
      if (timer) clearTimeout(timer);
      await disposeAgent(agent);
    }
  } finally {
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

export interface CursorListedAgent {
  agentId: string;
  name: string;
  summary: string;
  lastModified: number;
}

export async function listLocalCursorAgents(
  cwd: string,
  limit = 30,
): Promise<CursorListedAgent[]> {
  if (!cwd.trim()) return [];
  const { Agent } = await import("@cursor/sdk");
  const listed = await Agent.list({
    runtime: "local",
    cwd,
    limit,
  });
  return (listed.items ?? []).map((item) => ({
    agentId: item.agentId,
    name: item.name || item.agentId,
    summary: item.summary || item.name || item.agentId,
    lastModified: item.lastModified ?? Date.now(),
  }));
}

function extractAgentMessageText(message: unknown): string {
  if (!message) return "";
  if (typeof message === "string") return message.trim();
  if (typeof message !== "object") return "";
  const obj = message as Record<string, unknown>;
  if (typeof obj.text === "string") return obj.text.trim();
  if (typeof obj.content === "string") return obj.content.trim();
  if (Array.isArray(obj.content)) return extractTextBlocks(obj.content);
  if (obj.message && typeof obj.message === "object") {
    return extractAgentMessageText(obj.message);
  }
  return "";
}

export async function hydrateCursorConversation(
  cursorAgentId: string,
  cwd?: string | null,
): Promise<CursorConversationMessage[]> {
  if (!cursorAgentId.trim()) return [];
  const { Agent } = await import("@cursor/sdk");
  try {
    const messages = await Agent.messages.list(cursorAgentId, {
      runtime: "local",
      ...(cwd ? { cwd } : {}),
      limit: 100,
    });
    const out: CursorConversationMessage[] = [];
    for (const item of messages) {
      const text = extractAgentMessageText(item.message);
      if (!text) continue;
      if (item.type === "user" || item.type === "assistant") {
        out.push({ role: item.type, content: text });
      }
    }
    if (out.length) return out;
  } catch {
    // fall through to listRuns
  }

  try {
    const runs = await Agent.listRuns(cursorAgentId, {
      runtime: "local",
      ...(cwd ? { cwd } : {}),
      limit: 5,
    });
    for (const run of runs.items ?? []) {
      try {
        if (typeof run.supports === "function" && !run.supports("conversation")) continue;
        const conversation = conversationFromSdkTurns(await run.conversation());
        if (conversation.length) return conversation;
      } catch {
        // try next run
      }
    }
  } catch {
    return [];
  }
  return [];
}
