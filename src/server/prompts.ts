import { getAppSetting } from "../db/db.ts";

export const DEFAULT_SYSTEM_PROMPT =
  "You are an assistant inside a developer workspace. You can inspect and edit files in the " +
  "workspace using list_files/read_file/write_file. Keep edits minimal and focused. Never touch " +
  "files outside the workspace. You can also list/read/create/update documents " +
  "(list_documents/get_document/create_document/update_document/sync_document; sources: local, " +
  "docmost; notion/confluence are read-only) and tickets (list_tickets/get_ticket/create_ticket/" +
  "update_ticket/delete_ticket/sync_ticket/transition_ticket). Local tickets are NOT in Jira " +
  "until sync_ticket (or the user syncs). When the task is complete, reply with a short summary " +
  "(no tool call).";

export const DEFAULT_PLAN_PROMPT =
  "You are in PLAN mode. Do NOT modify files, documents, or tickets. You may call use_skill and " +
  "read-only tools: list_documents, get_document, list_tickets, get_ticket. Reply with a " +
  "concise, actionable plan: goal, ordered steps, files/docs/tickets involved, risks, and open " +
  "questions. The user will switch to Build mode when they want implementation.";
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
