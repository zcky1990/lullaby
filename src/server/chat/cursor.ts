import { dirname, join } from "node:path";
import type { LlmProviderRow } from "../../db/db.ts";
import { listWorkspaceFiles, resolveWithin } from "../../fs/workspace.ts";
import { loadCursorSdk, withCursorConnectTransport } from "./cursor-sdk.ts";
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

export function isCloudCursorAgentId(agentId: string | null | undefined): boolean {
  return !!agentId?.trim().toLowerCase().startsWith("bc-");
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

function skipCursorMeta(rel: string): boolean {
  return rel === ".cursor" || rel.startsWith(".cursor/");
}

export async function snapshotWorkspaceFiles(
  workspace: string,
): Promise<Map<string, Uint8Array>> {
  const index = await listWorkspaceFiles(workspace, MAX_FILES);
  const out = new Map<string, Uint8Array>();
  for (const rel of index.files) {
    if (skipCursorMeta(rel)) continue;
    const path = resolveWithin(workspace, rel);
    if (!path) continue;
    try {
      out.set(rel, await Deno.readFile(path));
    } catch {
      // skip unreadable
    }
  }
  return out;
}

async function loadBeforeBytes(
  before: string | ReadonlyMap<string, Uint8Array>,
  rel: string,
): Promise<Uint8Array | null> {
  if (typeof before !== "string") return before.get(rel) ?? null;
  const source = resolveWithin(before, rel);
  if (!source) return null;
  try {
    return await Deno.readFile(source);
  } catch {
    return null;
  }
}

/**
 * Diff `afterRoot` against a workspace path or an in-memory snapshot.
 * Used for temp-copy (legacy) and real-cwd snapshot flows.
 */
export async function collectCursorWrites(
  afterRoot: string,
  before: string | ReadonlyMap<string, Uint8Array>,
): Promise<{ writes: Array<{ path: string; content: string }>; notes: string[] }> {
  const index = await listWorkspaceFiles(afterRoot, MAX_FILES);
  const writes: Array<{ path: string; content: string }> = [];
  const notes: string[] = [];
  const decoder = new TextDecoder();
  let skipped = 0;

  for (const rel of index.files) {
    if (skipCursorMeta(rel)) continue;
    if (writes.length >= MAX_WRITES) {
      notes.push(`Perubahan dibatasi ${MAX_WRITES} file; sisanya tidak diajukan.`);
      break;
    }
    const target = join(afterRoot, rel);
    let bytes: Uint8Array;
    try {
      bytes = await Deno.readFile(target);
    } catch {
      continue;
    }
    const previous = await loadBeforeBytes(before, rel);
    if (previous && sameBytes(previous, bytes)) continue;
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

/** Restore workspace to pre-agent snapshot after collecting Review proposals. */
export async function revertWorkspaceToSnapshot(
  workspace: string,
  before: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  const index = await listWorkspaceFiles(workspace, MAX_FILES);
  for (const rel of index.files) {
    if (skipCursorMeta(rel)) continue;
    const path = resolveWithin(workspace, rel);
    if (!path) continue;
    const previous = before.get(rel);
    if (!previous) {
      try {
        await Deno.remove(path);
      } catch {
        // ignore
      }
      continue;
    }
    let current: Uint8Array | null = null;
    try {
      current = await Deno.readFile(path);
    } catch {
      current = null;
    }
    if (current && sameBytes(current, previous)) continue;
    try {
      await Deno.mkdir(dirname(path), { recursive: true });
      await Deno.writeFile(path, previous);
    } catch {
      // ignore restore errors
    }
  }

  for (const [rel, bytes] of before) {
    if (skipCursorMeta(rel)) continue;
    const path = resolveWithin(workspace, rel);
    if (!path) continue;
    try {
      await Deno.stat(path);
    } catch {
      try {
        await Deno.mkdir(dirname(path), { recursive: true });
        await Deno.writeFile(path, bytes);
      } catch {
        // ignore
      }
    }
  }
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

function localAgentOptions(workspace: string | null, mode: "plan" | "build") {
  const tools = mode === "plan" ? [...CURSOR_PLAN_TOOLS] : [...CURSOR_BUILD_TOOLS];
  return {
    tools,
    ...(workspace
      ? {
        local: {
          cwd: workspace,
          settingSources: ["project"] as Array<"project">,
        },
      }
      : {}),
    ...(mode === "plan" ? { mode: "plan" as const } : {}),
  };
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
  const workspace = opts.workspace?.trim() || null;
  const cloud = isCloudCursorAgentId(opts.cursorAgentId);

  if (isPendingCursorToolTurn(turns[turns.length - 1])) {
    return {
      text: "Perubahan dari Cursor sudah diproses. Beri tahu saya jika ada yang perlu dilanjutkan.",
      toolCalls: [],
      cursorAgentId: opts.cursorAgentId ?? undefined,
    };
  }

  if (!cloud && !workspace) {
    throw new Error("Workspace project belum diatur untuk Cursor local agent.");
  }

  const snapshot = !cloud && workspace && mode === "build"
    ? await snapshotWorkspaceFiles(workspace)
    : null;

  const { Agent, CursorAgentError } = await loadCursorSdk();

  const agentOptions = cloud
    ? {
      apiKey,
      model: { id: model },
      ...(mode === "plan" ? { mode: "plan" as const } : {}),
    }
    : {
      apiKey,
      model: { id: model },
      ...localAgentOptions(workspace, mode),
    };

  return await withCursorConnectTransport(async () => {
    let agent: Awaited<ReturnType<typeof Agent.create>>;
    let resumed = false;

    try {
      if (opts.cursorAgentId) {
        try {
          agent = await Agent.resume(opts.cursorAgentId, agentOptions);
          resumed = true;
        } catch (error) {
          if (cloud) {
            throw new Error(
              `Gagal resume cloud agent ${opts.cursorAgentId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
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

        if (cloud) {
          const note = "Cloud agent berjalan di VM Cursor (bukan workspace lokal); " +
            "perubahan file tidak diajukan ke Review lokal.";
          return {
            text: [result.result ?? "", note].filter(Boolean).join("\n\n"),
            toolCalls: [],
            cursorAgentId: agentId,
            conversation,
          };
        }

        if (!workspace || mode === "plan" || !snapshot) {
          return {
            text: result.result ?? "",
            toolCalls: [],
            cursorAgentId: agentId,
            conversation,
          };
        }

        const { writes, notes } = await collectCursorWrites(workspace, snapshot);
        try {
          await revertWorkspaceToSnapshot(workspace, snapshot);
        } catch {
          notes.push(
            "Peringatan: gagal mengembalikan sebagian file ke snapshot; cek git status.",
          );
        }
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
    } catch (error) {
      if (snapshot && workspace) {
        try {
          await revertWorkspaceToSnapshot(workspace, snapshot);
        } catch {
          // best-effort restore after failure
        }
      }
      throw error;
    }
  });
}

export interface CursorModelInfo {
  id: string;
  name: string;
  description?: string;
}

const CURSOR_MODELS_TIMEOUT_MS = 12_000;

export async function listCursorModels(apiKey: string): Promise<CursorModelInfo[]> {
  if (!apiKey.trim()) throw new Error("Cursor API key belum diisi.");
  const { Cursor } = await loadCursorSdk();
  const models = await withCursorConnectTransport(() =>
    Promise.race([
      Cursor.models.list({ apiKey }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error("Cursor models list timed out")),
          CURSOR_MODELS_TIMEOUT_MS,
        );
      }),
    ])
  );
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
  const { Cursor } = await loadCursorSdk();
  const models = await withCursorConnectTransport(() => Cursor.models.list({ apiKey }));
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
  runtime: "local" | "cloud";
}

export async function listLocalCursorAgents(
  cwd: string,
  limit = 30,
): Promise<CursorListedAgent[]> {
  if (!cwd.trim()) return [];
  const { Agent } = await loadCursorSdk();
  const listed = await withCursorConnectTransport(() =>
    Agent.list({
      runtime: "local",
      cwd,
      limit,
    })
  );
  return (listed.items ?? []).map((item) => ({
    agentId: item.agentId,
    name: item.name || item.agentId,
    summary: item.summary || item.name || item.agentId,
    lastModified: item.lastModified ?? Date.now(),
    runtime: "local" as const,
  }));
}

export async function listCloudCursorAgents(
  apiKey: string,
  limit = 30,
): Promise<CursorListedAgent[]> {
  if (!apiKey.trim()) return [];
  const { Agent } = await loadCursorSdk();
  const listed = await withCursorConnectTransport(() =>
    Agent.list({
      runtime: "cloud",
      apiKey,
      limit,
    })
  );
  return (listed.items ?? []).map((item) => ({
    agentId: item.agentId,
    name: item.name || item.agentId,
    summary: item.summary || item.name || item.agentId,
    lastModified: item.lastModified ?? Date.now(),
    runtime: "cloud" as const,
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

export interface HydrateCursorOptions {
  cwd?: string | null;
  apiKey?: string | null;
}

export async function hydrateCursorConversation(
  cursorAgentId: string,
  cwdOrOptions?: string | null | HydrateCursorOptions,
): Promise<CursorConversationMessage[]> {
  if (!cursorAgentId.trim()) return [];
  const opts: HydrateCursorOptions = typeof cwdOrOptions === "string" || cwdOrOptions == null
    ? { cwd: cwdOrOptions }
    : cwdOrOptions;
  const cloud = isCloudCursorAgentId(cursorAgentId);
  const cwd = opts.cwd?.trim() || undefined;
  const apiKey = opts.apiKey?.trim() || undefined;
  const { Agent } = await loadCursorSdk();

  const fromMessages = async (): Promise<CursorConversationMessage[]> => {
    const options: Record<string, unknown> = { limit: 100 };
    if (cloud) {
      if (apiKey) options.apiKey = apiKey;
    } else {
      options.runtime = "local";
      if (cwd) options.cwd = cwd;
    }
    const messages = await Agent.messages.list(
      cursorAgentId,
      options as Parameters<typeof Agent.messages.list>[1],
    );
    const out: CursorConversationMessage[] = [];
    for (const item of messages) {
      const text = extractAgentMessageText(item.message);
      if (!text) continue;
      if (item.type === "user" || item.type === "assistant") {
        out.push({ role: item.type, content: text });
      }
    }
    return out;
  };

  const fromRuns = async (): Promise<CursorConversationMessage[]> => {
    const runs = await Agent.listRuns(
      cursorAgentId,
      cloud
        ? { runtime: "cloud", ...(apiKey ? { apiKey } : {}), limit: 5 }
        : { runtime: "local", ...(cwd ? { cwd } : {}), limit: 5 },
    );
    for (const run of runs.items ?? []) {
      try {
        if (typeof run.supports === "function" && !run.supports("conversation")) continue;
        const conversation = conversationFromSdkTurns(await run.conversation());
        if (conversation.length) return conversation;
      } catch {
        // try next run
      }
    }
    return [];
  };

  return await withCursorConnectTransport(async () => {
    // Cloud: prefer listRuns (supports apiKey). Local: prefer messages.list.
    if (cloud) {
      try {
        const runs = await fromRuns();
        if (runs.length) return runs;
      } catch {
        // fall through
      }
      try {
        return await fromMessages();
      } catch {
        return [];
      }
    }

    try {
      const messages = await fromMessages();
      if (messages.length) return messages;
    } catch {
      // fall through
    }
    try {
      return await fromRuns();
    } catch {
      return [];
    }
  });
}
