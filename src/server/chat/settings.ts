import { getAppSetting } from "../../db/db.ts";
import { normalizeMaxSteps } from "./max-steps.ts";

const AUTO_APPROVE_WRITES_KEY = "auto_approve_writes";
const CHAT_DISABLED_TOOLS_KEY = "chat_disabled_tools";
const CHAT_MAX_STEPS_KEY = "chat_max_steps";

export interface ChatToolsSettings {
  autoApproveWrites: boolean;
  disabledTools: string[];
  /** null = unlimited (OpenCode-style default). */
  maxSteps: number | null;
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function readChatToolsSettings(): Promise<ChatToolsSettings> {
  const autoApproveWrites = (await getAppSetting(AUTO_APPROVE_WRITES_KEY)) === "true";
  const disabledTools = parseStringArray(await getAppSetting(CHAT_DISABLED_TOOLS_KEY));
  const rawMax = (await getAppSetting(CHAT_MAX_STEPS_KEY))?.trim() ?? "";
  const maxSteps = rawMax === "" || rawMax === "0" ? null : normalizeMaxSteps(Number(rawMax));
  return { autoApproveWrites, disabledTools, maxSteps };
}

export { AUTO_APPROVE_WRITES_KEY, CHAT_DISABLED_TOOLS_KEY, CHAT_MAX_STEPS_KEY };
