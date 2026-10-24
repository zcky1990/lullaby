export interface ParsedSlashSkill {
  skillName: string | null;
  text: string;
}

const SLASH_RE = /^\/([a-z0-9][a-z0-9_-]{0,63})(?:\s+|$)(.*)$/is;

export function parseSlashSkill(input: string): ParsedSlashSkill {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { skillName: null, text: trimmed };
  const match = SLASH_RE.exec(trimmed);
  if (!match) return { skillName: null, text: trimmed };
  return {
    skillName: match[1].toLowerCase(),
    text: match[2].trim(),
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
