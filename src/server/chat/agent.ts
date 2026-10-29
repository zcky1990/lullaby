import type { LlmProviderRow } from "../../db/db.ts";
import {
  appendChatMessage,
  createChatSession,
  getChatSession,
  getProject,
  listChatMessages,
} from "../../db/db.ts";
import { collectCodeReviewContext, defaultCodeReviewUserMessage } from "../code-review.ts";
import { loadEnabledSkills, projectSlug, readSkillBody, type SkillInfo } from "../skills.ts";
import {
  DEFAULT_PLAN_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  type PromptSettings,
  readPromptSettings,
} from "../prompts.ts";
import { diffLines } from "../diff.ts";
import { complete, VARIANT_TEMPERATURE } from "./llm.ts";
import { approvalResponse, prepareWriteChange, setAdvance } from "./review.ts";
import { readChatToolsSettings } from "./settings.ts";
import { scheduleSkillLearn } from "./skill-learn.ts";
import { deleteRun, pruneRuns, setRun } from "./state.ts";
import {
  applyWriteFile,
  executeTool,
  resolveAttachments,
  toolsFor,
  WRITE_TOOLS,
} from "./tools.ts";
import type { ChatResponse, Run, VisibleMessage } from "./types.ts";

const CODE_REVIEW_SKILL = "code-review";

const MAX_STEPS = 6;

function skillPrompt(skills: SkillInfo[]): string {
  if (!skills.length) return "";
  return "\n\nAvailable skills (call use_skill with the exact name when the task matches, " +
    "then follow its instructions):\n" +
    skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n");
}

export function activeSkillPrompt(name: string, body: string): string {
  return `\n\n## Active skill: ${name}\nThe user invoked /${name}. Follow these instructions for this request:\n\n${body}\n`;
}

const DEFAULT_PROMPTS: PromptSettings = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  planPrompt: DEFAULT_PLAN_PROMPT,
};

export function systemPrompt(
  workspace: string | null,
  mode: "plan" | "build",
  skills: SkillInfo[],
  persona?: string,
  activeSkill?: { name: string; body: string } | null,
  prompts: PromptSettings = DEFAULT_PROMPTS,
): string {
  const skillList = skillPrompt(skills);
  let prompt: string;
  if (mode === "plan") {
    prompt = workspace
      ? `${prompts.planPrompt}\nThe workspace root is: ${workspace}. Paths in your plan are relative to it.`
      : prompts.planPrompt;
  } else if (!workspace) {
    prompt =
      `${prompts.systemPrompt} No workspace is configured for this project, so file tools are ` +
      `unavailable; you can still use create_ticket to record tickets locally.`;
  } else {
    prompt =
      `${prompts.systemPrompt}\nThe workspace root is: ${workspace}. All tool paths are relative ` +
      `to this root (for example "src/index.ts"). Do not use absolute paths or "..".`;
  }
  const withPersona = persona?.trim() ? `${persona.trim()}\n\n${prompt}` : prompt;
  const withActive = activeSkill
    ? `${withPersona}${skillList}${activeSkillPrompt(activeSkill.name, activeSkill.body)}`
    : `${withPersona}${skillList}`;
  return withActive;
}

export async function advance(run: Run): Promise<ChatResponse> {
  try {
    const settings = await readChatToolsSettings();
    const disabledTools = new Set(settings.disabledTools);
    const tools = toolsFor(run.workspace, run.mode, run.skills.size > 0, disabledTools);
    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await complete(run.provider, run.turns, tools, run.temperature);
      if (run.mode === "plan") {
        if (response.toolCalls.length === 0) {
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
        const planAllowed = new Set([
          "use_skill",
          "list_documents",
          "get_document",
          "list_tickets",
          "get_ticket",
        ]);
        for (const call of response.toolCalls) {
          let result: string;
          if (disabledTools.has(call.name)) {
            result = `Tool "${call.name}" dinonaktifkan di Global Settings → Tools.`;
          } else if (!planAllowed.has(call.name)) {
            result = "Tool tidak tersedia di mode Plan.";
          } else {
            try {
              result = await executeTool(run, call);
            } catch (error) {
              result = `Error: ${(error as Error).message}`;
            }
          }
          run.turns.push({ role: "tool", toolCallId: call.id, content: result });
        }
        continue;
      }
      if (response.toolCalls.length === 0) {
        run.turns.push({ role: "assistant", content: response.text });
        await appendChatMessage(run.sessionId, "assistant", response.text, run.changes);
        scheduleSkillLearn(run);
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
          if (disabledTools.has(call.name)) {
            result = `Tool "${call.name}" dinonaktifkan di Global Settings → Tools.`;
          } else if (WRITE_TOOLS.has(call.name)) {
            const prepared = await prepareWriteChange(run, call);
            if (prepared.change) {
              if (settings.autoApproveWrites) {
                if (!run.workspace) {
                  result = "No workspace configured.";
                } else {
                  result = await applyWriteFile(run.workspace, call);
                  const diff = diffLines(prepared.change.before, prepared.change.after);
                  const applied = {
                    path: prepared.change.path,
                    action: prepared.change.action,
                    diff: diff.diff,
                    added: diff.added,
                    removed: diff.removed,
                  };
                  const index = run.changes.findIndex((item) => item.path === applied.path);
                  if (index >= 0) run.changes[index] = applied;
                  else run.changes.push(applied);
                }
              } else {
                run.pendingChanges.set(call.id, prepared.change);
                hasReviews = true;
                continue;
              }
            } else {
              result = prepared.result;
            }
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
    scheduleSkillLearn(run);
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
  skillName?: string,
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

  const project = await getProject(projectId);
  const slug = projectSlug(project?.name ?? "", projectId);
  const skills = await loadEnabledSkills(workspace, slug);
  const skillMap = new Map(skills.map((skill) => [skill.name, skill]));
  const prompts = await readPromptSettings();

  let activeSkill: { name: string; body: string } | null = null;
  const wantedSkill = skillName?.trim().toLowerCase() || "";
  if (wantedSkill) {
    const skill = skillMap.get(wantedSkill);
    if (!skill) {
      return { status: "error", error: "unknown_skill", sessionId: session.id };
    }
    activeSkill = { name: skill.name, body: await readSkillBody(skill) };
  }

  let resolvedMessages = messages;
  let effectiveMode = mode;
  if (wantedSkill === CODE_REVIEW_SKILL) {
    effectiveMode = "plan";
    const last = messages[messages.length - 1];
    if (last?.role === "user") {
      const gitContext = workspace
        ? await collectCodeReviewContext(workspace)
        : "No workspace configured; review from the user request only.";
      const enriched = defaultCodeReviewUserMessage(last.content, gitContext);
      resolvedMessages = [...messages.slice(0, -1), { ...last, content: enriched }];
    }
  }

  const resolved = await Promise.all(
    resolvedMessages.map(async (message) => ({
      ...message,
      attachments: await resolveAttachments(workspace, message.attachments),
    })),
  );

  const run: Run = {
    id: crypto.randomUUID(),
    provider,
    workspace,
    sessionId: session.id,
    temperature: VARIANT_TEMPERATURE[variant],
    turns: [
      {
        role: "system",
        content: systemPrompt(
          workspace,
          effectiveMode,
          skills,
          rolePersona,
          activeSkill,
          prompts,
        ),
      },
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
    mode: effectiveMode,
    skills: skillMap,
    createdTickets: [],
    createdAt: Date.now(),
  };
  setRun(run);
  return await advance(run);
}

setAdvance(advance);
