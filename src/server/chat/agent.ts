import type { LlmProviderRow } from "../../db/db.ts";
import {
  appendChatMessage,
  createChatSession,
  getChatSession,
  listChatMessages,
} from "../../db/db.ts";
import { loadEnabledSkills, type SkillInfo } from "../skills.ts";
import { complete, VARIANT_TEMPERATURE } from "./llm.ts";
import { approvalResponse, prepareWriteChange, setAdvance } from "./review.ts";
import { deleteRun, pruneRuns, setRun } from "./state.ts";
import { executeTool, resolveAttachments, toolsFor, WRITE_TOOLS } from "./tools.ts";
import type { ChatResponse, Run, VisibleMessage } from "./types.ts";

const MAX_STEPS = 6;

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
  persona?: string,
): string {
  const skillList = skillPrompt(skills);
  let prompt: string;
  if (mode === "plan") {
    prompt = workspace
      ? `${PLAN_PROMPT}\nThe workspace root is: ${workspace}. Paths in your plan are relative to it.`
      : PLAN_PROMPT;
  } else if (!workspace) {
    prompt = `${SYSTEM_PROMPT} No workspace is configured for this project, so file tools are ` +
      `unavailable; you can still use create_ticket to record tickets locally.`;
  } else {
    prompt = `${SYSTEM_PROMPT}\nThe workspace root is: ${workspace}. All tool paths are relative ` +
      `to this root (for example "src/index.ts"). Do not use absolute paths or "..".`;
  }
  const withPersona = persona?.trim() ? `${persona.trim()}\n\n${prompt}` : prompt;
  return `${withPersona}${skillList}`;
}

export async function advance(run: Run): Promise<ChatResponse> {
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
          deleteRun(run.id);
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
        deleteRun(run.id);
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

      const batch = response.toolCalls;
      run.pendingBatch = batch;
      run.batchResults = new Map();
      let hasReviews = false;

      for (const call of batch) {
        let result: string;
        try {
          if (WRITE_TOOLS.has(call.name)) {
            const prepared = await prepareWriteChange(run, call);
            if (prepared.change) {
              run.pendingChanges.set(call.id, prepared.change);
              hasReviews = true;
              continue;
            }
            result = prepared.result;
          } else if (!run.workspace && call.name !== "create_ticket" && call.name !== "use_skill") {
            result = "No workspace configured.";
          } else {
            result = await executeTool(run, call);
          }
        } catch (error) {
          result = `Error: ${(error as Error).message}`;
        }
        run.batchResults.set(call.id, result);
      }

      if (hasReviews) return approvalResponse(run);

      for (const call of batch) {
        run.turns.push({
          role: "tool",
          toolCallId: call.id,
          content: run.batchResults.get(call.id) ?? "Tidak dijalankan.",
        });
      }
      run.pendingBatch = [];
      run.batchResults.clear();
    }
    const message = "(berhenti: batas langkah tercapai)";
    await appendChatMessage(run.sessionId, "assistant", message, run.changes);
    deleteRun(run.id);
    return {
      status: "done",
      message,
      sessionId: run.sessionId,
      changes: run.changes,
      createdTickets: run.createdTickets,
    };
  } catch (error) {
    deleteRun(run.id);
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
  mode: "plan" | "build" = "build",
  rolePersona?: string,
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
      { role: "system", content: systemPrompt(workspace, mode, skills, rolePersona) },
      ...resolved.map((message) => ({
        role: message.role,
        content: message.content,
        attachments: message.attachments,
      })),
    ],
    pendingBatch: [],
    pendingChanges: new Map(),
    batchResults: new Map(),
    changes: [],
    projectId,
    mode,
    skills: skillMap,
    createdTickets: [],
    createdAt: Date.now(),
  };
  setRun(run);
  return await advance(run);
}

setAdvance(advance);
