import type { LlmProviderRow } from "../../db/db.ts";
import {
  DEFAULT_PLAN_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  type PromptSettings,
  readPromptSettings,
} from "../prompts.ts";
import { loadEnabledSkills, projectSlug, readSkillBody, type SkillInfo } from "../skills.ts";
import { systemPrompt } from "./agent.ts";
import { complete, safeParse } from "./llm.ts";
import { applyWriteFile, executeTool, toolsFor, WRITE_TOOLS } from "./tools.ts";
import type { ChatTurn, CreatedTicket, Run, ToolCall } from "./types.ts";

const DEFAULT_MAX_STEPS = 6;
const VARIANT_TEMPERATURE: Record<string, number> = {
  short: 0.2,
  medium: 0.5,
  long: 0.9,
};

const DEFAULT_PROMPTS: PromptSettings = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  planPrompt: DEFAULT_PLAN_PROMPT,
};

export interface HeadlessAgentInput {
  provider: LlmProviderRow;
  projectId: string;
  projectName: string;
  workspace: string | null;
  mode?: "plan" | "build";
  skillName?: string;
  variant?: "short" | "medium" | "long";
  temperature?: number;
  maxTokens?: number;
  maxSteps?: number;
  /** Extra system text from workflow `with.system` / `llm.system`. */
  system?: string;
  /** Role persona prepended via `systemPrompt`. */
  persona?: string;
  /** Conversation turns (user/assistant/history). System turns are ignored. */
  turns: ChatTurn[];
  isCanceled?: () => boolean;
}

export interface HeadlessToolLog {
  name: string;
  summary: string;
}

export interface HeadlessAgentResult {
  message: string;
  toolLog: HeadlessToolLog[];
  createdTickets: CreatedTicket[];
  filesTouched: string[];
  canceled: boolean;
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

function makeRun(
  provider: LlmProviderRow,
  projectId: string,
  workspace: string | null,
  mode: "plan" | "build",
  skills: Map<string, SkillInfo>,
  temperature: number | undefined,
  turns: ChatTurn[],
): Run {
  return {
    id: crypto.randomUUID(),
    provider,
    workspace,
    sessionId: "",
    temperature,
    turns,
    pendingBatch: [],
    pendingChanges: new Map(),
    batchResults: new Map(),
    changes: [],
    projectId,
    mode,
    skills,
    createdTickets: [],
    createdAt: Date.now(),
  };
}

export async function runHeadlessAgent(input: HeadlessAgentInput): Promise<HeadlessAgentResult> {
  const mode = input.mode ?? "build";
  const maxSteps = Math.min(12, Math.max(1, input.maxSteps ?? DEFAULT_MAX_STEPS));
  const slug = projectSlug(input.projectName, input.projectId);
  const skills = await loadEnabledSkills(input.workspace, slug);
  const skillMap = new Map(skills.map((skill) => [skill.name, skill]));
  const prompts = await readPromptSettings().catch(() => DEFAULT_PROMPTS);

  let activeSkill: { name: string; body: string } | null = null;
  const wantedSkill = input.skillName?.trim().toLowerCase() || "";
  if (wantedSkill) {
    const skill = skillMap.get(wantedSkill);
    if (!skill) {
      throw new Error(`Skill "${wantedSkill}" tidak ditemukan.`);
    }
    activeSkill = { name: skill.name, body: await readSkillBody(skill) };
  }

  const temperature = input.temperature ??
    (input.variant ? VARIANT_TEMPERATURE[input.variant] : undefined);

  let system = systemPrompt(
    input.workspace,
    mode,
    skills,
    input.persona,
    activeSkill,
    prompts,
  );
  if (input.system?.trim()) {
    system = `${input.system.trim()}\n\n${system}`;
  }

  const turns: ChatTurn[] = [{ role: "system", content: system }];
  for (const turn of input.turns) {
    if (turn.role === "system") continue;
    turns.push(turn);
  }

  const run = makeRun(
    input.provider,
    input.projectId,
    input.workspace,
    mode,
    skillMap,
    temperature,
    turns,
  );
  const toolLog: HeadlessToolLog[] = [];
  const filesTouched: string[] = [];
  const tools = toolsFor(run.workspace, run.mode, run.skills.size > 0);

  for (let step = 0; step < maxSteps; step++) {
    if (input.isCanceled?.()) {
      return {
        message: "(dibatalkan)",
        toolLog,
        createdTickets: run.createdTickets,
        filesTouched,
        canceled: true,
      };
    }

    const response = await complete(
      run.provider,
      run.turns,
      tools,
      run.temperature,
      input.maxTokens,
    );

    if (run.mode === "plan") {
      const skillCalls = response.toolCalls.filter((call) => call.name === "use_skill");
      if (skillCalls.length === 0) {
        const message = response.text ||
          "(Mode plan: tidak ada tool yang dijalankan. Aktifkan mode Build untuk implementasi.)";
        run.turns.push({ role: "assistant", content: message });
        return {
          message,
          toolLog,
          createdTickets: run.createdTickets,
          filesTouched,
          canceled: false,
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
        toolLog.push({ name: call.name, summary: toolSummary(call, result) });
        run.turns.push({ role: "tool", toolCallId: call.id, content: result });
      }
      continue;
    }

    if (response.toolCalls.length === 0) {
      run.turns.push({ role: "assistant", content: response.text });
      return {
        message: response.text,
        toolLog,
        createdTickets: run.createdTickets,
        filesTouched,
        canceled: false,
      };
    }

    run.turns.push({
      role: "assistant",
      content: response.text,
      toolCalls: response.toolCalls,
    });

    for (const call of response.toolCalls) {
      if (input.isCanceled?.()) {
        return {
          message: "(dibatalkan)",
          toolLog,
          createdTickets: run.createdTickets,
          filesTouched,
          canceled: true,
        };
      }
      let result: string;
      try {
        if (WRITE_TOOLS.has(call.name)) {
          if (!run.workspace) {
            result = "No workspace configured.";
          } else {
            result = await applyWriteFile(run.workspace, call);
            const args = safeParse(call.arguments);
            if (typeof args.path === "string" && args.path) {
              filesTouched.push(args.path);
            }
          }
        } else if (!run.workspace && call.name !== "create_ticket" && call.name !== "use_skill") {
          result = "No workspace configured.";
        } else {
          result = await executeTool(run, call);
        }
      } catch (error) {
        result = `Error: ${(error as Error).message}`;
      }
      toolLog.push({ name: call.name, summary: toolSummary(call, result) });
      run.turns.push({ role: "tool", toolCallId: call.id, content: result });
    }
  }

  return {
    message: "(berhenti: batas langkah tercapai)",
    toolLog,
    createdTickets: run.createdTickets,
    filesTouched,
    canceled: false,
  };
}
