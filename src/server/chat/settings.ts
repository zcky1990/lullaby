import { getAppSetting, setAppSetting } from "../../db/db.ts";
import { normalizeMaxSteps } from "./max-steps.ts";
import { setPendingReviewTtlMs } from "./state.ts";

const AUTO_APPROVE_WRITES_KEY = "auto_approve_writes";
const CHAT_DISABLED_TOOLS_KEY = "chat_disabled_tools";
const CHAT_AUTO_APPROVE_TOOLS_KEY = "chat_auto_approve_tools";
const CHAT_MAX_STEPS_KEY = "chat_max_steps";
const CHAT_WRITE_REVIEW_MODE_KEY = "chat_write_review_mode";
const CHAT_REVIEW_KEEP_HOURS_KEY = "chat_review_keep_hours";

export const DEFAULT_REVIEW_KEEP_HOURS = 24;
export const MIN_REVIEW_KEEP_HOURS = 1;
export const MAX_REVIEW_KEEP_HOURS = 168;

export type WriteReviewMode = "end" | "before";

export interface ChatToolsSettings {
  autoApproveWrites: boolean;
  disabledTools: string[];
  autoApproveTools: string[];
  /** null = unlimited (OpenCode-style default). */
  maxSteps: number | null;
  /**
   * `end` = writes apply during the run and are reviewed once the run finishes
   * (non-blocking). `before` = legacy gating: the run pauses before writing.
   */
  writeReviewMode: WriteReviewMode;
  /** How long deferred-review runs stay in memory (hours). Default 24. */
  reviewKeepHours: number;
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

export function normalizeWriteReviewMode(raw: string | null | undefined): WriteReviewMode {
  return raw?.trim().toLowerCase() === "before" ? "before" : "end";
}

export function normalizeReviewKeepHours(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_REVIEW_KEEP_HOURS;
  return Math.min(
    MAX_REVIEW_KEEP_HOURS,
    Math.max(MIN_REVIEW_KEEP_HOURS, Math.floor(n)),
  );
}

export function reviewKeepHoursToMs(hours: number): number {
  return normalizeReviewKeepHours(hours) * 60 * 60 * 1000;
}

export async function readChatToolsSettings(): Promise<ChatToolsSettings> {
  const autoApproveWrites = (await getAppSetting(AUTO_APPROVE_WRITES_KEY)) === "true";
  const disabledTools = parseStringArray(await getAppSetting(CHAT_DISABLED_TOOLS_KEY));
  const autoApproveTools = parseStringArray(await getAppSetting(CHAT_AUTO_APPROVE_TOOLS_KEY));
  const rawMax = (await getAppSetting(CHAT_MAX_STEPS_KEY))?.trim() ?? "";
  const maxSteps = rawMax === "" || rawMax === "0" ? null : normalizeMaxSteps(Number(rawMax));
  const writeReviewMode = normalizeWriteReviewMode(
    await getAppSetting(CHAT_WRITE_REVIEW_MODE_KEY),
  );
  const rawKeep = (await getAppSetting(CHAT_REVIEW_KEEP_HOURS_KEY))?.trim() ?? "";
  const reviewKeepHours = rawKeep === ""
    ? DEFAULT_REVIEW_KEEP_HOURS
    : normalizeReviewKeepHours(Number(rawKeep));
  setPendingReviewTtlMs(reviewKeepHoursToMs(reviewKeepHours));
  return {
    autoApproveWrites,
    disabledTools,
    autoApproveTools,
    maxSteps,
    writeReviewMode,
    reviewKeepHours,
  };
}

export async function addAutoApprovedTool(name: string): Promise<void> {
  const settings = await readChatToolsSettings();
  if (settings.autoApproveTools.includes(name)) return;
  const next = [...settings.autoApproveTools, name].slice(-200);
  await setAppSetting(CHAT_AUTO_APPROVE_TOOLS_KEY, JSON.stringify(next));
}

export {
  AUTO_APPROVE_WRITES_KEY,
  CHAT_AUTO_APPROVE_TOOLS_KEY,
  CHAT_DISABLED_TOOLS_KEY,
  CHAT_MAX_STEPS_KEY,
  CHAT_REVIEW_KEEP_HOURS_KEY,
  CHAT_WRITE_REVIEW_MODE_KEY,
};
