import type { LlmProviderRow } from "../../db/db.ts";
import {
  appendChatMessage,
  createChatSession,
  getChatSession,
  getProject,
  listChatMessages,
  setChatSessionCursorAgentId,
} from "../../db/db.ts";
import { collectCodeReviewContext, defaultCodeReviewUserMessage } from "../code-review.ts";
import { loadEnabledSkills, projectSlug, readSkillBody, type SkillInfo } from "../skills.ts";
import {
  DEFAULT_PLAN_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  type PromptSettings,
  readPromptSettings,
} from "../prompts.ts";
import type { CursorConversationMessage, CursorStreamEvent } from "./cursor.ts";
import { complete, type CompleteResult, VARIANT_TEMPERATURE } from "./llm.ts";
import {
  approvalResponse,
  deferredReviewResponse,
  prepareWriteChange,
  recordAppliedWrite,
  setAdvance,
} from "./review.ts";
import { isFinalMaxStep, shouldContinueSteps, toolsForStep, turnsForStep } from "./max-steps.ts";
import { addAutoApprovedTool, readChatToolsSettings } from "./settings.ts";
import { scheduleSkillLearn } from "./skill-learn.ts";
import { describeToolCall, emitChatStep, summarizeToolResult } from "./steps.ts";
import { deleteRun, pruneRuns, setRun } from "./state.ts";
import { loadMcpChatTools } from "./mcp-tools.ts";
import {
  applyWriteFile,
  executeTool,
  isMcpChatTool,
  resolveAttachments,
  toolsFor,
  WRITE_TOOLS,
} from "./tools.ts";
import type {
  ChatResponse,
  ChatStep,
  Run,
  ToolPermissionDecision,
  VisibleMessage,
} from "./types.ts";

export async function syncCursorConversation(
  sessionId: string,
  conversation: CursorConversationMessage[] | undefined,
  excludeTexts: string[] = [],
): Promise<void> {
  if (!conversation?.length) return;
  const stored = await listChatMessages(sessionId);
  const existing = new Set(
    stored.filter((message) => message.role === "assistant").map((message) =>
      message.content.trim()
    ),
  );
  for (const text of excludeTexts) {
    if (text.trim()) existing.add(text.trim());
  }
  for (const message of conversation) {
    if (message.role !== "assistant") continue;
    const content = message.content.trim();
    if (!content || existing.has(content)) continue;
    await appendChatMessage(sessionId, "assistant", content, []);
    existing.add(content);
  }
}

async function rememberCursorResult(run: Run, response: CompleteResult): Promise<void> {
  if (response.cursorAgentId && response.cursorAgentId !== run.cursorAgentId) {
    run.cursorAgentId = response.cursorAgentId;
    await setChatSessionCursorAgentId(run.sessionId, response.cursorAgentId);
  }
  await syncCursorConversation(run.sessionId, response.conversation, [response.text]);
}

const CODE_REVIEW_SKILL = "code-review";

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

function describeCursorTool(name: string | undefined, args: unknown): string {
  const record = args && typeof args === "object" ? args as Record<string, unknown> : {};
  const path = typeof record.path === "string"
    ? record.path
    : typeof record.file_path === "string"
    ? record.file_path
    : "";
  switch ((name ?? "").toLowerCase()) {
    case "read":
      return path ? `Membaca ${path}` : "Membaca file";
    case "write":
    case "edit":
    case "strreplace":
      return path ? `Mengedit ${path}` : "Mengedit file";
    case "grep":
      return "Mencari di kode";
    case "glob":
      return "Mencari file";
    case "ls":
      return path ? `Melihat folder ${path}` : "Melihat isi workspace";
    case "task":
      return "Menjalankan sub-agent";
    default:
      return name ? `Menjalankan ${name}` : "Menjalankan tool Cursor";
  }
}

function cursorResultDetail(result: unknown): string | undefined {
  if (result === undefined || result === null) return undefined;
  let text: string;
  try {
    text = typeof result === "string" ? result : JSON.stringify(result);
  } catch {
    text = String(result);
  }
  if (!text) return undefined;
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 160 ? `${collapsed.slice(0, 160)}…` : collapsed;
}

function deltaDetail(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 240 ? `…${collapsed.slice(-240)}` : collapsed;
}

function createCursorProgress(
  run: Run,
  thinkingId: string,
): { onEvent: (event: CursorStreamEvent) => void; dispose: () => void } {
  let activity = false;
  let thinkingText = "";
  let assistantText = "";
  let lastThinkingEmit = 0;
  let lastAssistantEmit = 0;
  let lastEventAt = Date.now();
  let stalled = false;
  const lastToolEmit = new Map<string, number>();
  const startedAt = Date.now();
  const markActive = () => {
    if (activity) return;
    activity = true;
    emitChatStep(run, {
      id: thinkingId,
      kind: "thinking",
      status: "done",
      title: "Cursor mulai bekerja",
    });
  };
  const timer = setInterval(() => {
    if (isCancelled(run)) return;
    const now = Date.now();
    if (!activity) {
      emitChatStep(run, {
        id: thinkingId,
        kind: "thinking",
        status: "running",
        title: "Cursor sedang bekerja…",
        detail: `${Math.round((now - startedAt) / 1000)} detik`,
      });
      return;
    }
    if (now - lastEventAt < 60_000) return;
    stalled = true;
    emitChatStep(run, {
      id: "cursor-stall",
      kind: "thinking",
      status: "running",
      title: "Cursor belum mengirim progres…",
      detail: `${Math.round((now - lastEventAt) / 1000)} detik tanpa update — ` +
        "masih menunggu, atau klik Stop untuk membatalkan.",
    });
  }, 5_000);
  return {
    onEvent: (event) => {
      lastEventAt = Date.now();
      if (stalled) {
        stalled = false;
        emitChatStep(run, {
          id: "cursor-stall",
          kind: "thinking",
          status: "done",
          title: "Progres Cursor kembali",
        });
      }
      if (event.type === "status") {
        switch (event.status) {
          case "setup":
            emitChatStep(run, {
              id: "cursor-setup",
              kind: "thinking",
              status: "running",
              title: event.message || "Menyiapkan agent Cursor…",
            });
            return;
          case "starting":
            emitChatStep(run, {
              id: "cursor-setup",
              kind: "thinking",
              status: "running",
              title: event.message || "Menghubungkan ke Cursor…",
            });
            return;
          case "running":
            emitChatStep(run, {
              id: "cursor-setup",
              kind: "thinking",
              status: "done",
              title: "Agent Cursor berjalan",
            });
            return;
          case "snapshot":
            emitChatStep(run, {
              id: "cursor-snapshot",
              kind: "thinking",
              status: "running",
              title: event.message || "Menyiapkan snapshot workspace…",
            });
            return;
          case "snapshot-done":
            emitChatStep(run, {
              id: "cursor-snapshot",
              kind: "thinking",
              status: "done",
              title: event.message ? `Snapshot siap (${event.message})` : "Snapshot siap",
            });
            return;
          case "requests":
            emitChatStep(run, {
              id: "cursor-requests",
              kind: "thinking",
              status: "running",
              title: "Menyiapkan tool…",
              detail: event.message,
            });
            return;
          default:
            return;
        }
      }
      if (event.type === "tool_call") {
        markActive();
        const id = `cursor-tool-${event.callId ?? crypto.randomUUID()}`;
        const title = describeCursorTool(event.name, event.args);
        if (event.status === "running") {
          const now = Date.now();
          const last = lastToolEmit.get(id) ?? 0;
          if (now - last < 200) return;
          lastToolEmit.set(id, now);
          emitChatStep(run, {
            id,
            kind: "tool",
            status: "running",
            title,
            toolName: event.name,
            detail: event.args ? cursorResultDetail(event.args) : undefined,
          });
          return;
        }
        emitChatStep(run, {
          id,
          kind: "tool",
          status: event.status === "error" ? "error" : "done",
          title,
          toolName: event.name,
          detail: cursorResultDetail(event.result) ?? cursorResultDetail(event.args),
        });
        return;
      }
      if (event.type === "task") {
        markActive();
        emitChatStep(run, {
          id: `cursor-task-${event.callId ?? "current"}`,
          kind: "tool",
          status: event.status === "error"
            ? "error"
            : event.status === "running"
            ? "running"
            : "done",
          title: "Menjalankan sub-agent Cursor",
          detail: event.text ? deltaDetail(event.text) : undefined,
        });
        return;
      }
      if (event.type === "thinking") {
        if (event.text) thinkingText += event.text;
        markActive();
        const now = Date.now();
        if (event.status !== "completed" && now - lastThinkingEmit < 200) return;
        lastThinkingEmit = now;
        emitChatStep(run, {
          id: thinkingId,
          kind: "thinking",
          status: event.status === "completed" ? "done" : "running",
          title: event.status === "completed" ? "Selesai berpikir" : "Cursor berpikir…",
          detail: thinkingText ? deltaDetail(thinkingText) : undefined,
        });
        return;
      }
      if (event.type === "assistant") {
        if (event.text) assistantText += event.text;
        markActive();
        const now = Date.now();
        if (now - lastAssistantEmit < 150) return;
        lastAssistantEmit = now;
        emitChatStep(run, {
          id: "cursor-assistant",
          kind: "assistant",
          status: "running",
          title: "Menulis jawaban…",
          detail: assistantText ? deltaDetail(assistantText) : undefined,
        });
        return;
      }
      if (event.type === "summary") {
        emitChatStep(run, {
          id: "cursor-summary",
          kind: "thinking",
          status: event.status === "error"
            ? "error"
            : event.status === "completed"
            ? "done"
            : "running",
          title: "Merangkum percakapan…",
        });
      }
    },
    dispose: () => clearInterval(timer),
  };
}

const PERMISSION_TIMEOUT_MS = 10 * 60_000;

function needsToolPermission(
  run: Run,
  toolName: string,
  settings: { disabledTools: string[]; autoApproveTools: string[] },
): boolean {
  if (settings.disabledTools.includes(toolName)) return false;
  if (settings.autoApproveTools.includes(toolName)) return false;
  if (run.allowedTools?.has(toolName)) return false;
  return true;
}

function requestToolPermission(
  run: Run,
  toolName: string,
  label: string,
): Promise<{ id: string; decision: ToolPermissionDecision }> {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    function settle(decision: ToolPermissionDecision) {
      clearTimeout(timer);
      if (run.pendingPermission?.id === id) run.pendingPermission = undefined;
      resolve({ id, decision });
    }
    const timer = setTimeout(() => settle("deny"), PERMISSION_TIMEOUT_MS);
    run.pendingPermission = { id, toolName, resolve: settle };
    emitChatStep(run, {
      id,
      kind: "permission",
      status: "running",
      title: `Butuh izin: ${label}`,
      detail: "Pilih Allow once, Always allow, atau No.",
      toolName,
    });
  });
}

async function ensureToolPermission(
  run: Run,
  call: { name: string },
  label: string,
  settings: { disabledTools: string[]; autoApproveTools: string[] },
): Promise<{ outcome: "allowed" | "denied" | "cancelled"; id?: string }> {
  if (!needsToolPermission(run, call.name, settings)) return { outcome: "allowed" };
  const { id, decision } = await requestToolPermission(run, call.name, label);
  if (isCancelled(run)) return { outcome: "cancelled", id };
  if (decision === "deny") {
    emitChatStep(run, {
      id,
      kind: "permission",
      status: "error",
      title: `Ditolak: ${label}`,
      detail: "Tool tidak dijalankan.",
      toolName: call.name,
    });
    return { outcome: "denied", id };
  }
  if (decision === "always") {
    try {
      await addAutoApprovedTool(call.name);
    } catch {
      // keep the run going even if persisting the preference fails
    }
  }
  run.allowedTools?.add(call.name);
  emitChatStep(run, {
    id,
    kind: "permission",
    status: "done",
    title: decision === "always" ? `Selalu diizinkan: ${label}` : `Diizinkan: ${label}`,
    toolName: call.name,
  });
  return { outcome: "allowed", id };
}

function isCancelled(run: Run): boolean {
  return run.cancelled === true || run.abort?.signal.aborted === true;
}

function cancelledResponse(run: Run): ChatResponse {
  run.cancelled = true;
  emitChatStep(run, {
    id: "run-cancelled",
    kind: "thinking",
    status: "done",
    title: "Chat dihentikan",
  });
  deleteRun(run.id);
  return { status: "cancelled", message: "Chat dihentikan.", sessionId: run.sessionId };
}

/**
 * Ends a run. When writes were applied with end-of-run review enabled, the run
 * stays in memory (with its pending changes) so the Review tab can still revert
 * them after the answer is complete.
 */
function finishRun(run: Run, response: ChatResponse): ChatResponse {
  if (response.status === "done" && run.pendingChanges.size > 0) {
    emitChatStep(run, {
      id: "review-deferred",
      kind: "approval",
      status: "done",
      title: `${run.pendingChanges.size} perubahan diterapkan`,
      detail: "Semua perubahan sudah ditulis. Review/revert kapan saja di tab Review.",
    });
    run.finishedAt = Date.now();
    run.emit = undefined;
    setRun(run);
    return deferredReviewResponse(run, response.message);
  }
  deleteRun(run.id);
  return response;
}

export async function advance(run: Run): Promise<ChatResponse> {
  try {
    if (isCancelled(run)) return cancelledResponse(run);
    const settings = await readChatToolsSettings();
    const disabledTools = new Set(settings.disabledTools);
    const mcp = await loadMcpChatTools();
    run.mcpTools = mcp.byName;
    const tools = [
      ...toolsFor(run.workspace, run.mode, run.skills.size > 0, disabledTools),
      ...mcp.defs,
    ];
    const deferReview = settings.writeReviewMode === "end";
    const applyWrites = settings.autoApproveWrites || deferReview;
    const maxSteps = settings.maxSteps;
    for (let step = 0; shouldContinueSteps(step, maxSteps); step++) {
      if (isCancelled(run)) return cancelledResponse(run);
      const finalStep = isFinalMaxStep(step, maxSteps);
      const thinkingId = crypto.randomUUID();
      emitChatStep(run, {
        id: thinkingId,
        kind: "thinking",
        status: "running",
        title: step === 0 ? "Menganalisis permintaan…" : "Melanjutkan ke langkah berikutnya…",
      });
      const cursorProgress = (run.provider.provider || "").toLowerCase() === "cursor"
        ? createCursorProgress(run, thinkingId)
        : null;
      let response: CompleteResult;
      try {
        response = await complete(
          run.provider,
          turnsForStep(run.turns, finalStep),
          toolsForStep(tools, finalStep),
          run.temperature,
          undefined,
          {
            workspace: run.workspace,
            cursorAgentId: run.cursorAgentId,
            mode: run.mode,
            signal: run.abort?.signal,
            ...(cursorProgress ? { onEvent: cursorProgress.onEvent } : {}),
          },
        );
      } catch (error) {
        if (isCancelled(run)) return cancelledResponse(run);
        emitChatStep(run, {
          id: thinkingId,
          kind: "thinking",
          status: "error",
          title: "Gagal menghubungi model",
          detail: (error as Error).message,
        });
        throw error;
      } finally {
        cursorProgress?.dispose();
      }
      if (isCancelled(run)) return cancelledResponse(run);
      emitChatStep(run, {
        id: thinkingId,
        kind: "thinking",
        status: "done",
        title: "Analisis selesai",
      });
      await rememberCursorResult(run, response);

      if (finalStep || response.toolCalls.length === 0) {
        const message = response.text ||
          (run.mode === "plan"
            ? "(Mode plan: tidak ada tool yang dijalankan. Aktifkan mode Build untuk implementasi.)"
            : "(selesai)");
        run.turns.push({ role: "assistant", content: message });
        await appendChatMessage(run.sessionId, "assistant", message, run.changes);
        emitChatStep(run, {
          id: "assistant-final",
          kind: "assistant",
          status: "done",
          title: "Selesai",
        });
        if (run.mode === "build") scheduleSkillLearn(run);
        return finishRun(run, {
          status: "done",
          message,
          sessionId: run.sessionId,
          changes: run.mode === "plan" ? [] : run.changes,
          createdTickets: run.mode === "plan" ? [] : run.createdTickets,
        });
      }

      if (run.mode === "plan") {
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
          if (isCancelled(run)) return cancelledResponse(run);
          const stepId = `tool-${call.id}`;
          const label = describeToolCall(call);
          const allowedByPlan = planAllowed.has(call.name) || isMcpChatTool(call.name);
          const permission = allowedByPlan && !disabledTools.has(call.name)
            ? await ensureToolPermission(run, call, label, settings)
            : { outcome: "allowed" as const };
          if (permission.outcome === "cancelled") return cancelledResponse(run);
          if (permission.outcome === "denied") {
            run.turns.push({
              role: "tool",
              toolCallId: call.id,
              content: `Tool "${call.name}" dibatalkan oleh pengguna.`,
            });
            continue;
          }
          emitChatStep(run, {
            id: stepId,
            kind: "tool",
            status: "running",
            title: label,
            toolName: call.name,
          });
          let result: string;
          if (disabledTools.has(call.name)) {
            result = `Tool "${call.name}" dinonaktifkan di Global Settings → Tools.`;
          } else if (!planAllowed.has(call.name) && !isMcpChatTool(call.name)) {
            result = "Tool tidak tersedia di mode Plan.";
          } else {
            try {
              result = await executeTool(run, call);
            } catch (error) {
              result = `Error: ${(error as Error).message}`;
            }
          }
          emitChatStep(run, {
            id: stepId,
            kind: "tool",
            status: result.startsWith("Error:") ? "error" : "done",
            title: label,
            toolName: call.name,
            detail: summarizeToolResult(result),
          });
          run.turns.push({ role: "tool", toolCallId: call.id, content: result });
        }
        continue;
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
        if (isCancelled(run)) return cancelledResponse(run);
        const stepId = `tool-${call.id}`;
        const label = describeToolCall(call);
        const permission = await ensureToolPermission(run, call, label, settings);
        if (permission.outcome === "cancelled") return cancelledResponse(run);
        if (permission.outcome === "denied") {
          run.batchResults.set(call.id, `Tool "${call.name}" dibatalkan oleh pengguna.`);
          continue;
        }
        emitChatStep(run, {
          id: stepId,
          kind: "tool",
          status: "running",
          title: label,
          toolName: call.name,
        });
        let result: string;
        try {
          if (disabledTools.has(call.name)) {
            result = `Tool "${call.name}" dinonaktifkan di Global Settings → Tools.`;
          } else if (WRITE_TOOLS.has(call.name)) {
            const prepared = await prepareWriteChange(run, call);
            if (prepared.change) {
              if (applyWrites) {
                if (!run.workspace) {
                  result = "No workspace configured.";
                } else {
                  result = await applyWriteFile(run.workspace, call);
                  recordAppliedWrite(run, prepared.change, deferReview);
                  if (deferReview) {
                    emitChatStep(run, {
                      id: `applied-${call.id}`,
                      kind: "approval",
                      status: "done",
                      title: `Diterapkan: ${prepared.change.path}`,
                      toolName: call.name,
                      detail: "Perubahan bisa di-review atau di-revert di tab Review.",
                    });
                  }
                }
              } else {
                run.pendingChanges.set(call.id, prepared.change);
                hasReviews = true;
                emitChatStep(run, {
                  id: stepId,
                  kind: "approval",
                  status: "done",
                  title: `Menunggu persetujuan: ${prepared.change.path}`,
                  toolName: call.name,
                  detail: "Buka Review untuk menerima atau menolak perubahan.",
                });
                continue;
              }
            } else {
              result = prepared.result;
            }
          } else if (
            !run.workspace &&
            call.name !== "create_ticket" &&
            call.name !== "use_skill" &&
            !isMcpChatTool(call.name)
          ) {
            result = "No workspace configured.";
          } else {
            result = await executeTool(run, call);
          }
        } catch (error) {
          result = `Error: ${(error as Error).message}`;
        }
        emitChatStep(run, {
          id: stepId,
          kind: "tool",
          status: result.startsWith("Error:") ? "error" : "done",
          title: label,
          toolName: call.name,
          detail: summarizeToolResult(result),
        });
        run.batchResults.set(call.id, result);
      }

      if (hasReviews) {
        run.emit = undefined;
        return approvalResponse(run);
      }

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
    if (isCancelled(run)) return cancelledResponse(run);
    const message = "(selesai)";
    await appendChatMessage(run.sessionId, "assistant", message, run.changes);
    emitChatStep(run, {
      id: "assistant-final",
      kind: "assistant",
      status: "done",
      title: "Selesai",
    });
    scheduleSkillLearn(run);
    return finishRun(run, {
      status: "done",
      message,
      sessionId: run.sessionId,
      changes: run.changes,
      createdTickets: run.createdTickets,
    });
  } catch (error) {
    if (isCancelled(run)) return cancelledResponse(run);
    emitChatStep(run, {
      id: "run-error",
      kind: "thinking",
      status: "error",
      title: "Terjadi kesalahan",
      detail: (error as Error).message,
    });
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
  emit?: (step: ChatStep) => void,
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
    cursorAgentId: session.cursor_agent_id,
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
    mcpTools: new Map(),
    createdTickets: [],
    createdAt: Date.now(),
    emit,
    abort: new AbortController(),
    allowedTools: new Set(),
  };
  setRun(run);
  return await advance(run);
}

setAdvance(advance);
