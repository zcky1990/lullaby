import type { ChatChange, LlmProviderRow } from "../db/db.ts";
import {
  appendChatMessage,
  createChatSession,
  createLocalTicket,
  getChatSession,
  listChatMessages,
} from "../db/db.ts";
import {
  listDirectory,
  readWorkspaceFile,
  readWorkspaceFileRaw,
  writeWorkspaceFile,
} from "../fs/workspace.ts";
import { request } from "../integrations/http.ts";
import { diffLines } from "./diff.ts";
import { loadEnabledSkills, readSkillBody, type SkillInfo } from "./skills.ts";

export interface ChatAttachment {
  type: "image" | "text" | "workspace";
  name: string;
  mime?: string;
  path?: string;
  data?: string;
}

export interface ChatTurn {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  attachments?: ChatAttachment[];
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
  attachments?: ChatAttachment[];
}

export interface CreatedTicket {
  id: string;
  key: string;
  title: string;
}

export type ChatResponse =
  | {
    status: "done";
    message: string;
    sessionId: string;
    changes: ChatChange[];
    createdTickets: CreatedTicket[];
  }
  | {
    status: "approval_required";
    runId: string;
    pending: PendingApproval[];
    sessionId: string;
    changes: ChatChange[];
    createdTickets: CreatedTicket[];
  }
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
  "focused. Never touch files outside the workspace. Use create_ticket to record a ticket in " +
  "the project's LOCAL backlog (it is not synced to Jira until the user syncs it manually; " +
  "never claim it already exists in Jira). When the task is complete, reply with a short " +
  "summary (no tool call).";

const PLAN_PROMPT =
  "You are in PLAN mode. Do NOT modify files and do NOT create tickets. You may call use_skill " +
  "(read-only) to load relevant skill instructions. Reply with a concise, actionable plan: " +
  "goal, ordered steps, files/areas likely involved, risks, and open questions. The user will " +
  "switch to Build mode when they want implementation.";

function skillPrompt(skills: SkillInfo[]): string {
  if (!skills.length) return "";
  return "\n\nAvailable skills (call use_skill with the exact name when the task matches, " +
    "then follow its instructions):\n" +
    skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n");
}

function systemPrompt(
  workspace: string | null,
  mode: "plan" | "build",
  skills: SkillInfo[],
): string {
  const skillList = skillPrompt(skills);
  if (mode === "plan") {
    const base = workspace
      ? `${PLAN_PROMPT}\nThe workspace root is: ${workspace}. Paths in your plan are relative to it.`
      : PLAN_PROMPT;
    return `${base}${skillList}`;
  }
  if (!workspace) {
    return `${SYSTEM_PROMPT} No workspace is configured for this project, so file tools are ` +
      `unavailable; you can still use create_ticket to record tickets locally.${skillList}`;
  }
  return `${SYSTEM_PROMPT}\nThe workspace root is: ${workspace}. All tool paths are relative ` +
    `to this root (for example "src/index.ts"). Do not use absolute paths or "..".${skillList}`;
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

const TICKET_TOOL: ToolDef = {
  name: "create_ticket",
  description:
    "Create a ticket in the project's local backlog. It is stored locally and NOT synced to " +
    "Jira; the user can sync it manually later.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short ticket title." },
      description: { type: "string", description: "Detailed ticket description." },
      status: {
        type: "string",
        enum: ["Backlog", "To Do", "In Progress", "Test", "Done"],
      },
      priority: { type: "string", enum: ["Low", "Medium", "High", "Urgent"] },
      type: { type: "string", enum: ["Task", "Bug", "Story"] },
    },
    required: ["title"],
  },
};

const USE_SKILL_TOOL: ToolDef = {
  name: "use_skill",
  description:
    "Load the full instructions of an available skill by name (read-only). Call this when a " +
    "listed skill matches the task, then follow the returned instructions.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Skill name exactly as listed." },
    },
    required: ["name"],
  },
};

const TICKET_STATUSES = ["Backlog", "To Do", "In Progress", "Test", "Done"] as const;
const TICKET_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
const TICKET_TYPES = ["Task", "Bug", "Story"] as const;

function pickTicketValue<T extends string>(
  options: readonly T[],
  value: unknown,
  fallback: T,
): T {
  const wanted = String(value ?? "").toLowerCase();
  return options.find((option) => option.toLowerCase() === wanted) ?? fallback;
}

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
  changes: ChatChange[];
  projectId: string;
  mode: "plan" | "build";
  skills: Map<string, SkillInfo>;
  createdTickets: CreatedTicket[];
  createdAt: number;
}

const runs = new Map<string, Run>();

function pruneRuns(): void {
  const now = Date.now();
  for (const [id, run] of runs) {
    if (now - run.createdAt > RUN_TTL_MS) runs.delete(id);
  }
}

function toolsFor(
  workspace: string | null,
  mode: "plan" | "build",
  hasSkills: boolean,
): ToolDef[] {
  const tools: ToolDef[] = hasSkills ? [USE_SKILL_TOOL] : [];
  if (mode === "plan") return tools;
  tools.push(TICKET_TOOL);
  if (workspace) tools.push(...TOOL_DEFS);
  return tools;
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

const MAX_TEXT_ATTACHMENT = 200_000;

function attachmentText(attachments: ChatAttachment[] | undefined): string {
  if (!attachments?.length) return "";
  return attachments
    .filter((item) => item.type === "text")
    .map((item) => `\n\n--- ${item.name} ---\n${(item.data ?? "").slice(0, MAX_TEXT_ATTACHMENT)}`)
    .join("");
}

function parseImageDataUrl(data: string): { mediaType: string; base64: string } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(data.trim());
  if (!match) return null;
  return { mediaType: match[1].toLowerCase(), base64: match[2].replace(/\s+/g, "") };
}

async function executeTool(run: Run, call: ToolCall): Promise<string> {
  const args = safeParse(call.arguments);
  if (call.name === "use_skill") {
    const name = String(args.name ?? "").trim().toLowerCase();
    const skill = run.skills.get(name);
    if (!skill) {
      const available = [...run.skills.keys()].join(", ") || "(tidak ada)";
      return `Skill "${name}" tidak ditemukan. Tersedia: ${available}`;
    }
    try {
      const body = await readSkillBody(skill);
      return `Skill: ${skill.name} (${skill.source})\n\n${body}`;
    } catch (error) {
      return `Gagal memuat skill "${skill.name}": ${(error as Error).message}`;
    }
  }
  if (call.name === "create_ticket") {
    const title = String(args.title ?? "").trim().slice(0, 200);
    if (!title) return "Error: title is required.";
    const ticket = await createLocalTicket(run.projectId, {
      title,
      description: String(args.description ?? "").slice(0, 8000),
      status: pickTicketValue(TICKET_STATUSES, args.status, "Backlog"),
      priority: args.priority
        ? pickTicketValue(TICKET_PRIORITIES, args.priority, "Medium")
        : undefined,
      type: pickTicketValue(TICKET_TYPES, args.type, "Task"),
    });
    const key = `LOCAL-${ticket.id.slice(0, 6).toUpperCase()}`;
    run.createdTickets.push({ id: ticket.id, key, title: ticket.title });
    return `Created local ticket ${key}: "${ticket.title}" (status ${ticket.status}). ` +
      "It is stored locally and NOT synced to Jira yet.";
  }

  const workspace = run.workspace;
  if (!workspace) return "No workspace configured.";
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
  return `Unknown tool: ${call.name}`;
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const MAX_WORKSPACE_IMAGE_BYTES = 4_000_000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function resolveAttachments(
  workspace: string | null,
  attachments: ChatAttachment[] | undefined,
): Promise<ChatAttachment[]> {
  if (!attachments?.length) return [];
  const result: ChatAttachment[] = [];
  for (const item of attachments) {
    if (item.type !== "workspace") {
      result.push(item);
      continue;
    }
    const path = item.path ?? "";
    if (!workspace) {
      result.push({
        type: "text",
        name: item.name,
        data: `(file ${path} tidak dapat dibaca: workspace belum diatur)`,
      });
      continue;
    }
    const extension = path.split(".").pop()?.toLowerCase() ?? "";
    const mime = IMAGE_MIME[extension];
    try {
      if (mime) {
        const raw = await readWorkspaceFileRaw(workspace, path);
        if (raw.size > MAX_WORKSPACE_IMAGE_BYTES) {
          result.push({
            type: "text",
            name: item.name,
            data: `(gambar ${path} terlalu besar untuk dilampirkan)`,
          });
          continue;
        }
        result.push({
          type: "image",
          name: item.name,
          mime,
          data: `data:${mime};base64,${toBase64(raw.bytes)}`,
        });
        continue;
      }
      const file = await readWorkspaceFile(workspace, path);
      if (file.binary) {
        result.push({
          type: "text",
          name: item.name,
          data: `(file biner ${path} tidak dapat ditampilkan)`,
        });
        continue;
      }
      result.push({
        type: "text",
        name: item.name,
        data: `${file.content}${file.truncated ? "\n… (dipotong)" : ""}`,
      });
    } catch (error) {
      result.push({
        type: "text",
        name: item.name,
        data: `(gagal membaca ${path}: ${(error as Error).message})`,
      });
    }
  }
  return result;
}

async function writeFileWithChange(run: Run, call: ToolCall): Promise<string> {
  if (!run.workspace) return "No workspace configured.";
  const args = safeParse(call.arguments);
  const path = typeof args.path === "string" ? args.path : "";
  const content = String(args.content ?? "");

  let before = "";
  let exists = false;
  try {
    const file = await readWorkspaceFile(run.workspace, path);
    exists = true;
    before = file.binary ? "" : file.content;
  } catch {
    exists = false;
  }

  await writeWorkspaceFile(run.workspace, path, content);
  const result = diffLines(before, content);
  const change: ChatChange = {
    path,
    action: exists ? "update" : "create",
    diff: result.diff,
    added: result.added,
    removed: result.removed,
  };
  const index = run.changes.findIndex((item) => item.path === path);
  if (index >= 0) run.changes[index] = change;
  else run.changes.push(change);
  return `Wrote ${path} (+${result.added}/-${result.removed})`;
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
          result = allowed ? await writeFileWithChange(run, call) : "Ditolak oleh user.";
        }
      } else if (
        !run.workspace && call.name !== "create_ticket" && call.name !== "use_skill"
      ) {
        result = "No workspace configured.";
      } else {
        result = await executeTool(run, call);
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
    if (turn.role === "user" && turn.attachments?.length) {
      const text = `${turn.content}${attachmentText(turn.attachments)}`;
      const images = turn.attachments.filter((item) => item.type === "image");
      if (!images.length) return { role: "user", content: text };
      return {
        role: "user",
        content: [
          ...(text ? [{ type: "text", text }] : []),
          ...images.map((image) => ({ type: "image_url", image_url: { url: image.data ?? "" } })),
        ],
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
    if (turn.role === "user" && turn.attachments?.length) {
      const text = `${turn.content}${attachmentText(turn.attachments)}`;
      const blocks: Block[] = [];
      if (text) blocks.push({ type: "text", text });
      for (const image of turn.attachments) {
        if (image.type !== "image") continue;
        const parsed = parseImageDataUrl(image.data ?? "");
        if (parsed) {
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: parsed.mediaType, data: parsed.base64 },
          });
        }
      }
      messages.push({ role: "user", content: blocks.length ? blocks : text });
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
    const tools = toolsFor(run.workspace, run.mode, run.skills.size > 0);
    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await complete(run.provider, run.turns, tools, run.temperature);
      if (run.mode === "plan") {
        const skillCalls = response.toolCalls.filter((call) => call.name === "use_skill");
        if (skillCalls.length === 0) {
          const message = response.text ||
            "(Mode plan: tidak ada tool yang dijalankan. Aktifkan mode Build untuk implementasi.)";
          run.turns.push({ role: "assistant", content: message });
          await appendChatMessage(run.sessionId, "assistant", message, []);
          runs.delete(run.id);
          return {
            status: "done",
            message,
            sessionId: run.sessionId,
            changes: [],
            createdTickets: [],
          };
        }
        run.turns.push({
          role: "assistant",
          content: response.text,
          toolCalls: response.toolCalls,
        });
        for (const call of response.toolCalls) {
          let result: string;
          if (call.name === "use_skill") {
            try {
              result = await executeTool(run, call);
            } catch (error) {
              result = `Error: ${(error as Error).message}`;
            }
          } else {
            result = "Tool tidak tersedia di mode Plan.";
          }
          run.turns.push({ role: "tool", toolCallId: call.id, content: result });
        }
        continue;
      }
      if (response.toolCalls.length === 0) {
        run.turns.push({ role: "assistant", content: response.text });
        await appendChatMessage(run.sessionId, "assistant", response.text, run.changes);
        runs.delete(run.id);
        return {
          status: "done",
          message: response.text,
          sessionId: run.sessionId,
          changes: run.changes,
          createdTickets: run.createdTickets,
        };
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
          changes: run.changes,
          createdTickets: run.createdTickets,
          pending: needsApproval.map((call) => ({
            id: call.id,
            tool: call.name,
            summary: summarize(call),
          })),
        };
      }

      await executeBatch(run, response.toolCalls);
    }
    const message = "(berhenti: batas langkah tercapai)";
    await appendChatMessage(run.sessionId, "assistant", message, run.changes);
    runs.delete(run.id);
    return {
      status: "done",
      message,
      sessionId: run.sessionId,
      changes: run.changes,
      createdTickets: run.createdTickets,
    };
  } catch (error) {
    runs.delete(run.id);
    return { status: "error", error: (error as Error).message, sessionId: run.sessionId };
  }
}

const TICKET_GENERATION_PROMPT =
  "You generate actionable implementation tickets from a document. Read the document and call " +
  "create_ticket for each ticket (1-5 tickets). Each ticket needs a short imperative title, a " +
  "description containing context and acceptance criteria, a sensible priority (Low/Medium/High/Urgent), " +
  "and a type (Task/Bug/Story). Status should usually be 'To Do'. Tickets are stored locally and " +
  "synced to Jira later by the user. Only use create_ticket; do not describe tickets without " +
  "creating them. When finished, reply with a short summary.";

export async function generateTicketsFromDocument(
  projectId: string,
  provider: LlmProviderRow,
  title: string,
  content: string,
  variant = "medium",
): Promise<{ tickets: CreatedTicket[]; message: string }> {
  const run: Run = {
    id: crypto.randomUUID(),
    provider,
    workspace: null,
    sessionId: "",
    temperature: VARIANT_TEMPERATURE[variant],
    turns: [
      { role: "system", content: TICKET_GENERATION_PROMPT },
      {
        role: "user",
        content: `Document: ${title}\n\n${content.slice(0, 30_000)}`,
      },
    ],
    pendingBatch: [],
    pending: [],
    decisions: new Map(),
    alwaysAllow: new Set(),
    changes: [],
    projectId,
    mode: "build",
    skills: new Map(),
    createdTickets: [],
    createdAt: Date.now(),
  };

  for (let step = 0; step < 5; step++) {
    const response = await complete(provider, run.turns, [TICKET_TOOL], run.temperature);
    if (response.toolCalls.length === 0) {
      return { tickets: run.createdTickets, message: response.text };
    }
    run.turns.push({
      role: "assistant",
      content: response.text,
      toolCalls: response.toolCalls,
    });
    for (const call of response.toolCalls) {
      let result: string;
      if (call.name !== "create_ticket") {
        result = "Tool tidak tersedia. Gunakan create_ticket.";
      } else {
        try {
          result = await executeTool(run, call);
        } catch (error) {
          result = `Error: ${(error as Error).message}`;
        }
      }
      run.turns.push({ role: "tool", toolCallId: call.id, content: result });
    }
    if (run.createdTickets.length >= 10) break;
  }
  return {
    tickets: run.createdTickets,
    message: run.createdTickets.length ? "Tiket dibuat." : "(tidak ada tiket yang dibuat)",
  };
}

export async function startChat(
  projectId: string,
  provider: LlmProviderRow,
  workspace: string | null,
  messages: VisibleMessage[],
  sessionId?: string,
  variant: string = "medium",
  mode: "plan" | "build" = "build",
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

  const resolved = await Promise.all(
    messages.map(async (message) => ({
      ...message,
      attachments: await resolveAttachments(workspace, message.attachments),
    })),
  );

  const skills = await loadEnabledSkills(workspace);
  const skillMap = new Map(skills.map((skill) => [skill.name, skill]));

  const run: Run = {
    id: crypto.randomUUID(),
    provider,
    workspace,
    sessionId: session.id,
    temperature: VARIANT_TEMPERATURE[variant],
    turns: [
      { role: "system", content: systemPrompt(workspace, mode, skills) },
      ...resolved.map((message) => ({
        role: message.role,
        content: message.content,
        attachments: message.attachments,
      })),
    ],
    pendingBatch: [],
    pending: [],
    decisions: new Map(),
    alwaysAllow: new Set(),
    changes: [],
    projectId,
    mode,
    skills: skillMap,
    createdTickets: [],
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
      changes: run.changes,
      createdTickets: run.createdTickets,
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
