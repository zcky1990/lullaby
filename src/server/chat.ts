import type { LlmProviderRow } from "../db/db.ts";
import {
  appendChatMessage,
  createChatSession,
  getChatSession,
  listChatMessages,
} from "../db/db.ts";
import { listDirectory, readWorkspaceFile, writeWorkspaceFile } from "../fs/workspace.ts";
import { request } from "../integrations/http.ts";

export interface ChatTurn {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface VisibleMessage {
  role: "user" | "assistant";
  content: string;
}

export type ChatResponse =
  | { status: "done"; message: string; sessionId: string }
  | { status: "approval_required"; runId: string; pending: PendingApproval[]; sessionId: string }
  | { status: "error"; error: string; sessionId?: string };

export interface PendingApproval {
  id: string;
  tool: string;
  summary: string;
}

const MAX_STEPS = 6;
const RUN_TTL_MS = 10 * 60 * 1000;
const MAX_TOOL_RESULT = 60_000;

const SYSTEM_PROMPT =
  "You are an assistant inside a developer workspace. You can inspect and edit files in the " +
  "workspace using the provided tools. Use list_files/read_file to inspect before editing. " +
  "Use write_file to create or overwrite a file with full content. Keep edits minimal and " +
  "focused. Never touch files outside the workspace. When the task is complete, reply with a " +
  "short summary (no tool call).";

function systemPrompt(workspace: string | null): string {
  if (!workspace) {
    return `${SYSTEM_PROMPT} No workspace is configured for this project, so file tools are ` +
      "unavailable; reply without tool calls.";
  }
  return `${SYSTEM_PROMPT}\nThe workspace root is: ${workspace}. All tool paths are relative ` +
    'to this root (for example "src/index.ts"). Do not use absolute paths or "..".';
}

const TOOL_DEFS: ToolDef[] = [
  {
    name: "list_files",
    description: "List files and directories at a path relative to the workspace root.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative path (default root)." } },
    },
  },
  {
    name: "read_file",
    description: "Read a text file from the workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative file path." } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a text file in the workspace with the given content.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path." },
        content: { type: "string", description: "Full new file content." },
      },
      required: ["path", "content"],
    },
  },
];

const WRITE_TOOLS = new Set(["write_file"]);

interface Run {
  id: string;
  provider: LlmProviderRow;
  workspace: string | null;
  sessionId: string;
  temperature?: number;
  turns: ChatTurn[];
  pendingBatch: ToolCall[];
  pending: ToolCall[];
  decisions: Map<string, "once" | "always" | "deny">;
  alwaysAllow: Set<string>;
  createdAt: number;
}

const runs = new Map<string, Run>();

function pruneRuns(): void {
  const now = Date.now();
  for (const [id, run] of runs) {
    if (now - run.createdAt > RUN_TTL_MS) runs.delete(id);
  }
}

function toolsFor(workspace: string | null): ToolDef[] {
  return workspace ? TOOL_DEFS : [];
}

function summarize(call: ToolCall): string {
  try {
    const args = JSON.parse(call.arguments || "{}") as { path?: string };
    return args.path ? `${call.name}(${args.path})` : call.name;
  } catch {
    return call.name;
  }
}

function safeParse(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function executeTool(workspace: string, call: ToolCall): Promise<string> {
  const args = safeParse(call.arguments);
  const path = typeof args.path === "string" ? args.path : "";
  if (call.name === "list_files") {
    const listing = await listDirectory(workspace, path);
    return JSON.stringify(listing.entries).slice(0, MAX_TOOL_RESULT);
  }
  if (call.name === "read_file") {
    const file = await readWorkspaceFile(workspace, path);
    if (file.binary) return "(binary file, not shown)";
    return file.content.slice(0, MAX_TOOL_RESULT);
  }
  if (call.name === "write_file") {
    await writeWorkspaceFile(workspace, path, String(args.content ?? ""));
    return `Wrote ${path}`;
  }
  return `Unknown tool: ${call.name}`;
}

async function executeBatch(run: Run, batch: ToolCall[]): Promise<void> {
  for (const call of batch) {
    let result: string;
    try {
      if (WRITE_TOOLS.has(call.name)) {
        if (!run.workspace) {
          result = "No workspace configured.";
        } else {
          const decision = run.decisions.get(call.id);
          const allowed = run.alwaysAllow.has(call.name) || decision === "once" ||
            decision === "always";
          result = allowed ? await executeTool(run.workspace, call) : "Ditolak oleh user.";
        }
      } else if (!run.workspace) {
        result = "No workspace configured.";
      } else {
        result = await executeTool(run.workspace, call);
      }
    } catch (error) {
      result = `Error: ${(error as Error).message}`;
    }
    run.turns.push({ role: "tool", toolCallId: call.id, content: result });
  }
}

function openAiMessages(turns: ChatTurn[]) {
  return turns.map((turn) => {
    if (turn.role === "tool") {
      return { role: "tool", tool_call_id: turn.toolCallId, content: turn.content };
    }
    if (turn.role === "assistant" && turn.toolCalls?.length) {
      return {
        role: "assistant",
        content: turn.content || null,
        tool_calls: turn.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    return { role: turn.role, content: turn.content };
  });
}

async function completeOpenAi(
  provider: LlmProviderRow,
  turns: ChatTurn[],
  tools: ToolDef[],
  temperature?: number,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const base = (provider.base_url ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("baseUrl provider LLM belum diisi.");
  const body: Record<string, unknown> = {
    model: provider.model ?? "",
    messages: openAiMessages(turns),
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (tools.length) {
    body.tools = tools.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
    body.tool_choice = "auto";
  }
  const res = await request(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${provider.api_key ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${res.text.slice(0, 300)}`);
  const json = JSON.parse(res.text || "{}") as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  };
  const message = json.choices?.[0]?.message;
  const toolCalls = (message?.tool_calls ?? []).map((call, index) => ({
    id: call.id ?? `call_${index}`,
    name: call.function?.name ?? "",
    arguments: call.function?.arguments ?? "{}",
  }));
  return { text: message?.content ?? "", toolCalls };
}

async function completeAnthropic(
  provider: LlmProviderRow,
  turns: ChatTurn[],
  tools: ToolDef[],
  temperature?: number,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const base = (provider.base_url ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("baseUrl provider LLM belum diisi.");

  const system = turns
    .filter((turn) => turn.role === "system")
    .map((turn) => turn.content)
    .join("\n\n");

  type Block = Record<string, unknown>;
  const messages: Array<{ role: "user" | "assistant"; content: string | Block[] }> = [];
  for (const turn of turns) {
    if (turn.role === "system") continue;
    if (turn.role === "tool") {
      const block: Block = {
        type: "tool_result",
        tool_use_id: turn.toolCallId,
        content: turn.content,
      };
      const last = messages[messages.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        messages.push({ role: "user", content: [block] });
      }
      continue;
    }
    if (turn.role === "assistant" && turn.toolCalls?.length) {
      const content: Block[] = [];
      if (turn.content) content.push({ type: "text", text: turn.content });
      for (const call of turn.toolCalls) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: safeParse(call.arguments),
        });
      }
      messages.push({ role: "assistant", content });
      continue;
    }
    messages.push({ role: turn.role, content: turn.content });
  }

  const body: Record<string, unknown> = {
    model: provider.model ?? "",
    max_tokens: 2048,
    system: system || undefined,
    messages,
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (tools.length) {
    body.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  const res = await request(`${base}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": provider.api_key ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${res.text.slice(0, 300)}`);
  const json = JSON.parse(res.text || "{}") as {
    content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }>;
  };
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const block of json.content ?? []) {
    if (block.type === "text" && block.text) text += block.text;
    if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id ?? `call_${toolCalls.length}`,
        name: block.name ?? "",
        arguments: JSON.stringify(block.input ?? {}),
      });
    }
  }
  return { text, toolCalls };
}

function complete(
  provider: LlmProviderRow,
  turns: ChatTurn[],
  tools: ToolDef[],
  temperature?: number,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const type = (provider.provider || "openai").toLowerCase();
  return type === "anthropic"
    ? completeAnthropic(provider, turns, tools, temperature)
    : completeOpenAi(provider, turns, tools, temperature);
}

const VARIANT_TEMPERATURE: Record<string, number | undefined> = {
  low: 0.2,
  medium: 0.5,
  high: 0.9,
};

async function advance(run: Run): Promise<ChatResponse> {
  try {
    const tools = toolsFor(run.workspace);
    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await complete(run.provider, run.turns, tools, run.temperature);
      if (response.toolCalls.length === 0) {
        run.turns.push({ role: "assistant", content: response.text });
        await appendChatMessage(run.sessionId, "assistant", response.text);
        runs.delete(run.id);
        return { status: "done", message: response.text, sessionId: run.sessionId };
      }

      run.turns.push({
        role: "assistant",
        content: response.text,
        toolCalls: response.toolCalls,
      });

      const needsApproval = response.toolCalls.filter(
        (call) => WRITE_TOOLS.has(call.name) && !run.alwaysAllow.has(call.name),
      );
      if (needsApproval.length > 0) {
        run.pendingBatch = response.toolCalls;
        run.pending = needsApproval;
        run.decisions = new Map();
        return {
          status: "approval_required",
          runId: run.id,
          sessionId: run.sessionId,
          pending: needsApproval.map((call) => ({
            id: call.id,
            tool: call.name,
            summary: summarize(call),
          })),
        };
      }

      await executeBatch(run, response.toolCalls);
    }
    runs.delete(run.id);
    return {
      status: "done",
      message: "(berhenti: batas langkah tercapai)",
      sessionId: run.sessionId,
    };
  } catch (error) {
    runs.delete(run.id);
    return { status: "error", error: (error as Error).message, sessionId: run.sessionId };
  }
}

export async function startChat(
  projectId: string,
  provider: LlmProviderRow,
  workspace: string | null,
  messages: VisibleMessage[],
  sessionId?: string,
  variant: string = "medium",
): Promise<ChatResponse> {
  pruneRuns();

  let session = sessionId ? await getChatSession(sessionId) : null;
  if (!session || session.project_id !== projectId) session = null;
  if (!session) {
    const firstUser = messages.find((message) => message.role === "user")?.content ?? "Chat";
    session = await createChatSession(projectId, firstUser.slice(0, 60) || "Chat");
  }

  const stored = await listChatMessages(session.id);
  const lastMessage = messages[messages.length - 1];
  const lastStored = stored[stored.length - 1];
  if (
    lastMessage &&
    (!lastStored ||
      lastStored.role !== lastMessage.role ||
      lastStored.content !== lastMessage.content)
  ) {
    await appendChatMessage(session.id, lastMessage.role, lastMessage.content);
  }

  const run: Run = {
    id: crypto.randomUUID(),
    provider,
    workspace,
    sessionId: session.id,
    temperature: VARIANT_TEMPERATURE[variant],
    turns: [
      { role: "system", content: systemPrompt(workspace) },
      ...messages.map((message) => ({ role: message.role, content: message.content })),
    ],
    pendingBatch: [],
    pending: [],
    decisions: new Map(),
    alwaysAllow: new Set(),
    createdAt: Date.now(),
  };
  runs.set(run.id, run);
  return await advance(run);
}

export async function approveChat(
  runId: string,
  callId: string,
  action: "once" | "always" | "deny",
): Promise<ChatResponse> {
  pruneRuns();
  const run = runs.get(runId);
  if (!run) return { status: "error", error: "run_not_found" };

  const pending = run.pending.find((call) => call.id === callId);
  if (!pending) return { status: "error", error: "pending_not_found" };

  run.decisions.set(callId, action);
  if (action === "always") run.alwaysAllow.add(pending.name);
  run.pending = run.pending.filter((call) => call.id !== callId);

  if (run.pending.length > 0) {
    return {
      status: "approval_required",
      runId: run.id,
      sessionId: run.sessionId,
      pending: run.pending.map((call) => ({
        id: call.id,
        tool: call.name,
        summary: summarize(call),
      })),
    };
  }

  await executeBatch(run, run.pendingBatch);
  run.pendingBatch = [];
  return await advance(run);
}
