import { getAppSetting } from "../../db/db.ts";

const AUTO_APPROVE_WRITES_KEY = "auto_approve_writes";
const CHAT_DISABLED_TOOLS_KEY = "chat_disabled_tools";

export interface ChatToolsSettings {
  autoApproveWrites: boolean;
  disabledTools: string[];
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
  return { autoApproveWrites, disabledTools };
}

export { AUTO_APPROVE_WRITES_KEY, CHAT_DISABLED_TOOLS_KEY };
