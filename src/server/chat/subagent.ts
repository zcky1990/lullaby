import { getLlmProvider, getProject, getRole, type LlmProviderRow } from "../../db/db.ts";
import {
  DEFAULT_PLAN_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  type PromptSettings,
  readPromptSettings,
} from "../prompts.ts";
import { loadEnabledSkills, projectSlug, readSkillBody, type SkillInfo } from "../skills.ts";
import { complete, safeParse } from "./llm.ts";
import {
  isFinalMaxStep,
  shouldContinueSteps,
  toolsForStep,
  turnsForStep,
} from "./max-steps.ts";
import { loadMcpChatTools } from "./mcp-tools.ts";
import { prepareWriteChange, recordAppliedWrite } from "./review.ts";
import { describeToolCall, emitChatStep, summarizeToolResult } from "./steps.ts";
import {
  applyWriteFile,
  executeTool,
  isMcpChatTool,
  SPAWN_AGENT_TOOL_NAME,
  toolsFor,
  WRITE_TOOLS,
} from "./tools.ts";
import type { ChatTurn, CreatedTicket, Run, ToolCall } from "./types.ts";

export const MAX_SUBAGENT_DEPTH = 1;
export const MAX_SUBAGENTS_PER_RUN = 3;
export const DEFAULT_SUBAGENT_STEPS = 20;
export const MAX_SUBAGENT_STEPS = 50;
const MAX_RESULT_MESSAGE = 8_000;

const DEFAULT_PROMPTS: PromptSettings = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  planPrompt: DEFAULT_PLAN_PROMPT,
};

export interface SpawnAgentArgs {
  prompt: string;
  mode?: "plan" | "build";
  roleId?: string;
  skillName?: string;
  maxSteps?: number;
}

export interface SpawnAgentOptions {
  deferReview: boolean;
  disabledTools: ReadonlySet<string>;
}

export interface SubagentToolLog {
  name: string;
  summary: string;
}

export interface SubagentResult {
  message: string;
  toolLog: SubagentToolLog[];
  createdTickets: CreatedTicket[];
  filesTouched: string[];
  canceled: boolean;
  error?: string;
}

function isCursorProvider(provider: LlmProviderRow): boolean {
  return (provider.provider || "").toLowerCase() === "cursor";
}

function isCancelled(run: Run): boolean {
  return Boolean(run.cancelled || run.abort?.signal.aborted);
}

export function normalizeSubagentSteps(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SUBAGENT_STEPS;
  return Math.min(MAX_SUBAGENT_STEPS, Math.floor(n));
}

export function parseSpawnAgentArgs(raw: unknown): SpawnAgentArgs | { error: string } {
  const args = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (!prompt) return { error: "prompt wajib diisi." };
  const modeRaw = typeof args.mode === "string" ? args.mode.trim().toLowerCase() : "";
  const mode = modeRaw === "plan" || modeRaw === "build" ? modeRaw : undefined;
  const roleId = typeof args.roleId === "string" && args.roleId.trim()
    ? args.roleId.trim()
    : undefined;
  const skillName = typeof args.skillName === "string" && args.skillName.trim()
    ? args.skillName.trim()
    : undefined;
  return {
    prompt,
    mode,
    roleId,
    skillName,
    maxSteps: normalizeSubagentSteps(args.maxSteps),
  };
}

function toolSummary(call: ToolCall, result: string): string {
  const args = safeParse(call.arguments);
  if (call.name === "write_file") {
    const path = typeof args.path === "string" ? args.path : "?";
    return `write_file(${path})`;
  }
  if (call.name === "read_file" || call.name === "list_files") {
    const path = typeof args.path === "string" ? args.path : ".";
    return `${call.name}(${path})`;
  }
  if (call.name === "use_skill") {
    return `use_skill(${String(args.name ?? "")})`;
  }
  if (call.name === "create_ticket") {
    return `create_ticket(${String(args.title ?? "").slice(0, 60)})`;
  }
  return `${call.name}: ${result.slice(0, 120)}`;
}

function makeChildRun(
  parent: Run,
  provider: LlmProviderRow,
  mode: "plan" | "build",
  skills: Map<string, SkillInfo>,
  turns: ChatTurn[],
): Run {
  return {
    id: crypto.randomUUID(),
    provider,
    workspace: parent.workspace,
    sessionId: parent.sessionId,
    temperature: parent.temperature,
    turns,
    pendingBatch: [],
    pendingChanges: new Map(),
    batchResults: new Map(),
    changes: [],
    projectId: parent.projectId,
    mode,
    skills,
    mcpTools: new Map(),
    createdTickets: [],
    createdAt: Date.now(),
    parentRunId: parent.id,
    abort: parent.abort,
  };
}

function resultJson(payload: SubagentResult): string {
  const message = payload.message.length > MAX_RESULT_MESSAGE
    ? `${payload.message.slice(0, MAX_RESULT_MESSAGE)}…`
    : payload.message;
  return JSON.stringify({
    message,
    filesTouched: payload.filesTouched,
    createdTickets: payload.createdTickets,
    toolLog: payload.toolLog,
    canceled: payload.canceled,
    ...(payload.error ? { error: payload.error } : {}),
  });
}

/**
 * Run a depth-1 child agent for the parent chat run.
 * Writes are applied and merged into the parent's pendingChanges/Review.
 */
export async function runSpawnAgent(
  parent: Run,
  rawArgs: unknown,
  options: SpawnAgentOptions,
): Promise<string> {
  if (parent.parentRunId) {
    return resultJson({
      message: "",
      toolLog: [],
      createdTickets: [],
      filesTouched: [],
      canceled: false,
      error: `spawn_agent ditolak: depth maksimal ${MAX_SUBAGENT_DEPTH}.`,
    });
  }
  if (isCursorProvider(parent.provider)) {
    return resultJson({
      message: "",
      toolLog: [],
      createdTickets: [],
      filesTouched: [],
      canceled: false,
      error: "spawn_agent tidak tersedia untuk provider Cursor (pakai tool task bawaan).",
    });
  }
  if ((parent.activeSubagentCount ?? 0) >= MAX_SUBAGENTS_PER_RUN) {
    return resultJson({
      message: "",
      toolLog: [],
      createdTickets: [],
      filesTouched: [],
      canceled: false,
      error: `Maksimal ${MAX_SUBAGENTS_PER_RUN} subagent per run.`,
    });
  }
  if (isCancelled(parent)) {
    return resultJson({
      message: "(dibatalkan)",
      toolLog: [],
      createdTickets: [],
      filesTouched: [],
      canceled: true,
    });
  }

  const parsed = parseSpawnAgentArgs(rawArgs);
  if ("error" in parsed) {
    return resultJson({
      message: "",
      toolLog: [],
      createdTickets: [],
      filesTouched: [],
      canceled: false,
      error: parsed.error,
    });
  }

  const mode = parsed.mode ?? parent.mode;
  const maxSteps = normalizeSubagentSteps(parsed.maxSteps);
  let provider = parent.provider;
  let persona: string | undefined;

  if (parsed.roleId) {
    const role = await getRole(parsed.roleId);
    if (!role) {
      return resultJson({
        message: "",
        toolLog: [],
        createdTickets: [],
        filesTouched: [],
        canceled: false,
        error: `Role "${parsed.roleId}" tidak ditemukan.`,
      });
    }
    persona = role.persona || undefined;
    if (role.provider_id) {
      const roleProvider = await getLlmProvider(role.provider_id);
      if (!roleProvider) {
        return resultJson({
          message: "",
          toolLog: [],
          createdTickets: [],
          filesTouched: [],
          canceled: false,
          error: `Provider role "${parsed.roleId}" tidak ditemukan.`,
        });
      }
      if (isCursorProvider(roleProvider)) {
        return resultJson({
          message: "",
          toolLog: [],
          createdTickets: [],
          filesTouched: [],
          canceled: false,
          error: "spawn_agent tidak mendukung role dengan provider Cursor.",
        });
      }
      provider = roleProvider;
    }
  }

  const project = await getProject(parent.projectId);
  const slug = projectSlug(project?.name ?? "", parent.projectId);
  const skills = await loadEnabledSkills(parent.workspace, slug);
  const skillMap = new Map(skills.map((skill) => [skill.name, skill]));
  const prompts = await readPromptSettings().catch(() => DEFAULT_PROMPTS);

  let activeSkill: { name: string; body: string } | null = null;
  const wantedSkill = parsed.skillName?.trim().toLowerCase() || "";
  if (wantedSkill) {
    const skill = skillMap.get(wantedSkill);
    if (!skill) {
      return resultJson({
        message: "",
        toolLog: [],
        createdTickets: [],
        filesTouched: [],
        canceled: false,
        error: `Skill "${wantedSkill}" tidak ditemukan.`,
      });
    }
    activeSkill = { name: skill.name, body: await readSkillBody(skill) };
  }

  const childDisabled = new Set([...options.disabledTools, SPAWN_AGENT_TOOL_NAME]);
  const { systemPrompt } = await import("./agent.ts");
  const mcp = await loadMcpChatTools();
  const system = systemPrompt(
    parent.workspace,
    mode,
    skills,
    persona,
    activeSkill,
    prompts,
    mcp.serverSummaries,
    mcp.mode,
  );
  const turns: ChatTurn[] = [
    { role: "system", content: system },
    { role: "user", content: parsed.prompt },
  ];

  const child = makeChildRun(parent, provider, mode, skillMap, turns);
  parent.childRunIds = [...(parent.childRunIds ?? []), child.id];
  parent.activeSubagentCount = (parent.activeSubagentCount ?? 0) + 1;

  const toolLog: SubagentToolLog[] = [];
  const filesTouched: string[] = [];
  const promptPreview = parsed.prompt.replace(/\s+/g, " ").slice(0, 80);

  try {
    emitChatStep(parent, {
      id: `subagent-${child.id}-start`,
      kind: "tool",
      status: "running",
      title: `Subagent: ${promptPreview}${parsed.prompt.length > 80 ? "…" : ""}`,
      toolName: SPAWN_AGENT_TOOL_NAME,
      detail: `mode=${mode}, maxSteps=${maxSteps}`,
    });

    if (isCancelled(parent)) {
      emitChatStep(parent, {
        id: `subagent-${child.id}-start`,
        kind: "tool",
        status: "error",
        title: "Subagent dibatalkan",
        toolName: SPAWN_AGENT_TOOL_NAME,
      });
      return resultJson({
        message: "(dibatalkan)",
        toolLog,
        createdTickets: [],
        filesTouched,
        canceled: true,
      });
    }

    child.mcpTools = mcp.byName;
    const tools = [
      ...toolsFor(child.workspace, child.mode, child.skills.size > 0, childDisabled, {
        allowSpawnAgent: false,
      }),
      ...mcp.defs,
    ];

    for (let step = 0; shouldContinueSteps(step, maxSteps); step++) {
      if (isCancelled(parent)) {
        emitChatStep(parent, {
          id: `subagent-${child.id}-start`,
          kind: "tool",
          status: "error",
          title: "Subagent dibatalkan",
          toolName: SPAWN_AGENT_TOOL_NAME,
        });
        return resultJson({
          message: "(dibatalkan)",
          toolLog,
          createdTickets: child.createdTickets,
          filesTouched,
          canceled: true,
        });
      }

      const thinkingId = `subagent-${child.id}-think-${step}`;
      emitChatStep(parent, {
        id: thinkingId,
        kind: "thinking",
        status: "running",
        title: step === 0 ? "Subagent: menganalisis…" : "Subagent: melanjutkan…",
        toolName: SPAWN_AGENT_TOOL_NAME,
      });

      const finalStep = isFinalMaxStep(step, maxSteps);
      let response;
      try {
        response = await complete(
          child.provider,
          turnsForStep(child.turns, finalStep),
          toolsForStep(tools, finalStep),
          child.temperature,
          undefined,
          {
            workspace: child.workspace,
            mode: child.mode,
            signal: parent.abort?.signal,
          },
        );
      } catch (error) {
        emitChatStep(parent, {
          id: thinkingId,
          kind: "thinking",
          status: "error",
          title: "Subagent gagal menghubungi model",
          toolName: SPAWN_AGENT_TOOL_NAME,
          detail: (error as Error).message,
        });
        return resultJson({
          message: "",
          toolLog,
          createdTickets: child.createdTickets,
          filesTouched,
          canceled: isCancelled(parent),
          error: (error as Error).message,
        });
      }

      emitChatStep(parent, {
        id: thinkingId,
        kind: "thinking",
        status: "done",
        title: "Subagent: analisis selesai",
        toolName: SPAWN_AGENT_TOOL_NAME,
      });

      if (finalStep || response.toolCalls.length === 0) {
        const message = response.text ||
          (mode === "plan"
            ? "(Mode plan: tidak ada tool yang dijalankan.)"
            : "(selesai)");
        child.turns.push({ role: "assistant", content: message });
        for (const ticket of child.createdTickets) {
          if (!parent.createdTickets.some((item) => item.id === ticket.id)) {
            parent.createdTickets.push(ticket);
          }
        }
        emitChatStep(parent, {
          id: `subagent-${child.id}-start`,
          kind: "tool",
          status: "done",
          title: `Subagent selesai`,
          toolName: SPAWN_AGENT_TOOL_NAME,
          detail: summarizeToolResult(message),
        });
        return resultJson({
          message,
          toolLog,
          createdTickets: child.createdTickets,
          filesTouched,
          canceled: false,
        });
      }

      child.turns.push({
        role: "assistant",
        content: response.text,
        toolCalls: response.toolCalls,
      });

      const planAllowed = new Set([
        "use_skill",
        "list_documents",
        "get_document",
        "list_tickets",
        "get_ticket",
      ]);

      for (const call of response.toolCalls) {
        if (isCancelled(parent)) {
          emitChatStep(parent, {
            id: `subagent-${child.id}-start`,
            kind: "tool",
            status: "error",
            title: "Subagent dibatalkan",
            toolName: SPAWN_AGENT_TOOL_NAME,
          });
          return resultJson({
            message: "(dibatalkan)",
            toolLog,
            createdTickets: child.createdTickets,
            filesTouched,
            canceled: true,
          });
        }

        if (call.name === SPAWN_AGENT_TOOL_NAME) {
          const denied = `spawn_agent ditolak: depth maksimal ${MAX_SUBAGENT_DEPTH}.`;
          toolLog.push({ name: call.name, summary: denied });
          child.turns.push({ role: "tool", toolCallId: call.id, content: denied });
          continue;
        }

        const stepId = `subagent-${child.id}-tool-${call.id}`;
        const label = `Subagent: ${describeToolCall(call)}`;
        emitChatStep(parent, {
          id: stepId,
          kind: "tool",
          status: "running",
          title: label,
          toolName: SPAWN_AGENT_TOOL_NAME,
        });

        let result: string;
        try {
          if (childDisabled.has(call.name)) {
            result = `Tool "${call.name}" dinonaktifkan.`;
          } else if (mode === "plan") {
            if (!planAllowed.has(call.name) && !isMcpChatTool(call.name)) {
              result = "Tool tidak tersedia di mode Plan.";
            } else {
              result = await executeTool(child, call);
            }
          } else if (WRITE_TOOLS.has(call.name)) {
            if (!parent.workspace) {
              result = "No workspace configured.";
            } else {
              const prepared = await prepareWriteChange(parent, call);
              if (prepared.change) {
                result = await applyWriteFile(parent.workspace, call);
                await recordAppliedWrite(parent, prepared.change, options.deferReview);
                filesTouched.push(prepared.change.path);
                if (options.deferReview) {
                  emitChatStep(parent, {
                    id: `subagent-applied-${call.id}`,
                    kind: "approval",
                    status: "done",
                    title: `Subagent diterapkan: ${prepared.change.path}`,
                    toolName: SPAWN_AGENT_TOOL_NAME,
                    detail: "Perubahan digabung ke tab Review parent.",
                  });
                }
              } else {
                result = prepared.result;
              }
            }
          } else if (
            !child.workspace &&
            call.name !== "create_ticket" &&
            call.name !== "use_skill" &&
            !isMcpChatTool(call.name)
          ) {
            result = "No workspace configured.";
          } else {
            result = await executeTool(child, call);
          }
        } catch (error) {
          result = `Error: ${(error as Error).message}`;
        }

        toolLog.push({ name: call.name, summary: toolSummary(call, result) });
        emitChatStep(parent, {
          id: stepId,
          kind: "tool",
          status: result.startsWith("Error:") ? "error" : "done",
          title: label,
          toolName: SPAWN_AGENT_TOOL_NAME,
          detail: summarizeToolResult(result),
        });
        child.turns.push({ role: "tool", toolCallId: call.id, content: result });
      }
    }

    for (const ticket of child.createdTickets) {
      if (!parent.createdTickets.some((item) => item.id === ticket.id)) {
        parent.createdTickets.push(ticket);
      }
    }
    emitChatStep(parent, {
      id: `subagent-${child.id}-start`,
      kind: "tool",
      status: "done",
      title: "Subagent selesai",
      toolName: SPAWN_AGENT_TOOL_NAME,
    });
    return resultJson({
      message: "(selesai)",
      toolLog,
      createdTickets: child.createdTickets,
      filesTouched,
      canceled: false,
    });
  } finally {
    parent.activeSubagentCount = Math.max(0, (parent.activeSubagentCount ?? 1) - 1);
  }
}
