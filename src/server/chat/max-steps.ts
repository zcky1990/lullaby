import type { ChatTurn, ToolDef } from "./types.ts";

/** OpenCode-style final-step instruction when a configured step limit is reached. */
export const MAX_STEPS_PROMPT = `CRITICAL - MAXIMUM STEPS REACHED

The maximum number of steps allowed for this task has been reached. Tools are disabled until next user input. Respond with text only.

STRICT REQUIREMENTS:
1. Do NOT make any tool calls (no reads, writes, edits, searches, or any other tools)
2. MUST provide a text response summarizing work done so far
3. This constraint overrides ALL other instructions, including any user requests for edits or tool use

Response must include:
- Statement that maximum steps for this agent have been reached
- Summary of what has been accomplished so far
- List of any remaining tasks that were not completed
- Recommendations for what should be done next

Any attempt to use tools is a critical violation. Respond with text ONLY.`;

/** null/undefined = unlimited (OpenCode default). */
export function normalizeMaxSteps(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  if (n < 1) return null;
  return Math.min(200, n);
}

export function isFinalMaxStep(step: number, maxSteps: number | null): boolean {
  return maxSteps != null && step >= maxSteps - 1;
}

export function shouldContinueSteps(step: number, maxSteps: number | null): boolean {
  return maxSteps == null || step < maxSteps;
}

export function toolsForStep(tools: ToolDef[], finalStep: boolean): ToolDef[] {
  return finalStep ? [] : tools;
}

export function turnsForStep(turns: ChatTurn[], finalStep: boolean): ChatTurn[] {
  if (!finalStep) return turns;
  return [...turns, { role: "system", content: MAX_STEPS_PROMPT }];
}
