export interface ParsedSlashSkill {
  skillName: string | null;
  text: string;
  command?: "autoskill" | null;
}

const SLASH_RE = /^\/([a-z0-9][a-z0-9_-]{0,63})(?:\s+|$)(.*)$/is;
export const AUTOSKILL_COMMAND = "autoskill";

export function isAutoskillCommand(input: string): boolean {
  const parsed = parseSlashSkill(input);
  return parsed.command === AUTOSKILL_COMMAND;
}

export function parseSlashSkill(input: string): ParsedSlashSkill {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { skillName: null, text: trimmed, command: null };
  const match = SLASH_RE.exec(trimmed);
  if (!match) return { skillName: null, text: trimmed, command: null };
  const name = match[1].toLowerCase();
  if (name === AUTOSKILL_COMMAND) {
    return { skillName: null, text: match[2].trim(), command: AUTOSKILL_COMMAND };
  }
  return {
    skillName: name,
    text: match[2].trim(),
    command: null,
  };
}

export function detectSlashQuery(input: string, cursor = input.length): {
  active: boolean;
  query: string;
  start: number;
} {
  const before = input.slice(0, cursor);
  const match = /(^|\s)\/([a-z0-9_-]*)$/i.exec(before);
  if (!match) return { active: false, query: "", start: -1 };
  return {
    active: true,
    query: match[2].toLowerCase(),
    start: before.length - match[2].length - 1,
  };
}
