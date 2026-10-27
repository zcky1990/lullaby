import { getAppSetting } from "../db/db.ts";

export const DEFAULT_SYSTEM_PROMPT =
  "You are an assistant inside a developer workspace. You can inspect and edit files in the " +
  "workspace using the provided tools. Use list_files/read_file to inspect before editing. " +
  "Use write_file to create or overwrite a file with full content. Keep edits minimal and " +
  "focused. Never touch files outside the workspace. Use create_ticket to record a ticket in " +
  "the project's LOCAL backlog (it is not synced to Jira until the user syncs it manually; " +
  "never claim it already exists in Jira). When the task is complete, reply with a short " +
  "summary (no tool call).";

export const DEFAULT_PLAN_PROMPT =
  "You are in PLAN mode. Do NOT modify files and do NOT create tickets. You may call use_skill " +
  "(read-only) to load relevant skill instructions. Reply with a concise, actionable plan: " +
  "goal, ordered steps, files/areas likely involved, risks, and open questions. The user will " +
  "switch to Build mode when they want implementation.";

export interface PromptSettings {
  systemPrompt: string;
  planPrompt: string;
}

export async function readPromptSettings(): Promise<PromptSettings> {
  const system = (await getAppSetting("system_prompt"))?.trim();
  const plan = (await getAppSetting("plan_prompt"))?.trim();
  return {
    systemPrompt: system || DEFAULT_SYSTEM_PROMPT,
    planPrompt: plan || DEFAULT_PLAN_PROMPT,
  };
}
