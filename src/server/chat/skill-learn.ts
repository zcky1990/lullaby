import { join } from "node:path";
import { getProject } from "../../db/db.ts";
import { normalizeSkillName, projectSkillsDir, projectSlug } from "../skills.ts";
import type { ChatTurn, Run, ToolCall } from "./types.ts";

const MAX_GOAL = 200;
const MAX_SKILL_NAME = 40;
const MAX_FILES = 24;
const MAX_STEPS = 12;

export interface SkillToolStep {
  name: string;
  path?: string;
  detail?: string;
}

export interface SkillEvidence {
  goal: string;
  steps: SkillToolStep[];
  files: string[];
  tickets: string[];
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function pathFromArgs(args: Record<string, unknown>): string | undefined {
  for (const key of ["path", "file", "filepath"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function extractSkillEvidence(run: Run): SkillEvidence | null {
  const goalTurn = run.turns.find((turn) => turn.role === "user");
  const goal = (goalTurn?.content ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_GOAL);
  const steps: SkillToolStep[] = [];
  const files = new Set<string>();

  for (const turn of run.turns) {
    if (turn.role !== "assistant" || !turn.toolCalls?.length) continue;
    for (const call of turn.toolCalls) {
      const step = stepFromCall(call);
      if (!step) continue;
      steps.push(step);
      if (step.path) files.add(step.path);
    }
  }

  for (const change of run.changes) {
    if (change.path) files.add(change.path);
  }

  const tickets = run.createdTickets.map((ticket) =>
    `${ticket.key}: ${ticket.title}`.slice(0, 120)
  );

  if (!steps.length && !files.size && !tickets.length) return null;

  return {
    goal: goal || "Build task",
    steps: steps.slice(0, MAX_STEPS),
    files: [...files].slice(0, MAX_FILES),
    tickets,
  };
}

function stepFromCall(call: ToolCall): SkillToolStep | null {
  const args = parseArgs(call.arguments);
  const path = pathFromArgs(args);
  switch (call.name) {
    case "list_files":
      return { name: call.name, path: path ?? (typeof args.path === "string" ? args.path : ".") };
    case "read_file":
    case "write_file":
      return path ? { name: call.name, path } : { name: call.name };
    case "create_ticket": {
      const title = typeof args.title === "string" ? args.title.trim() : "";
      return { name: call.name, detail: title || undefined };
    }
    case "use_skill": {
      const skill = typeof args.name === "string" ? args.name.trim() : "";
      return { name: call.name, detail: skill || undefined };
    }
    default:
      return { name: call.name, path };
  }
}

export function skillNameFromEvidence(evidence: SkillEvidence, sessionId: string): string {
  const fromGoal = normalizeSkillName(evidence.goal, "").slice(0, MAX_SKILL_NAME);
  if (fromGoal.length >= 3) return fromGoal;
  const tools = evidence.steps.map((step) => step.name).filter(Boolean);
  if (tools.length) {
    const fromTools = normalizeSkillName(tools.slice(0, 3).join("-"), "task").slice(
      0,
      MAX_SKILL_NAME,
    );
    if (fromTools) return fromTools;
  }
  return `task-${sessionId.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "chat"}`;
}

export function buildSkillMarkdown(
  name: string,
  evidence: SkillEvidence,
  generatedAt: Date = new Date(),
): string {
  const primaryTools = [...new Set(evidence.steps.map((step) => step.name))].slice(0, 4);
  const description = [
    evidence.goal.slice(0, 160),
    primaryTools.length ? `(${primaryTools.join(", ")})` : "",
  ].filter(Boolean).join(" ").slice(0, 240);

  const title = evidence.goal.slice(0, 80) || name;
  const steps = evidence.steps.length
    ? evidence.steps.map((step, index) => {
      const bits = [step.name];
      if (step.path) bits.push(step.path);
      if (step.detail) bits.push(step.detail);
      return `${index + 1}. ${bits.join(" — ")}`;
    }).join("\n")
    : "1. Inspect relevant files\n2. Apply the change\n3. Verify the result";

  const files = evidence.files.length
    ? evidence.files.map((file) => `- ${file}`).join("\n")
    : "- (none recorded)";

  const tickets = evidence.tickets.length
    ? `\n## Tickets\n${evidence.tickets.map((ticket) => `- ${ticket}`).join("\n")}\n`
    : "";

  return `---
name: ${name}
description: ${description.replace(/\n/g, " ")}
---
# ${title}

## Goal
${evidence.goal}

## Typical steps
${steps}

## Files / areas
${files}
${tickets}
## Notes
Auto-generated from Build chat on ${generatedAt.toISOString()}. Update manually if needed.
`;
}

export async function writeProjectSkill(
  slug: string,
  name: string,
  markdown: string,
): Promise<string> {
  const dir = join(projectSkillsDir(slug), name);
  await Deno.mkdir(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  await Deno.writeTextFile(path, markdown);
  return path;
}

export async function learnSkillFromRun(run: Run): Promise<string | null> {
  if (run.mode !== "build") return null;
  const evidence = extractSkillEvidence(run);
  if (!evidence) return null;

  const project = await getProject(run.projectId);
  const slug = projectSlug(project?.name ?? "", run.projectId);
  const name = skillNameFromEvidence(evidence, run.sessionId);
  const markdown = buildSkillMarkdown(name, evidence);
  return await writeProjectSkill(slug, name, markdown);
}

export function scheduleSkillLearn(run: Run): void {
  if (run.mode !== "build") return;
  void learnSkillFromRun(run).catch((error) => {
    console.error("skill learn failed:", (error as Error).message);
  });
}

export function hasToolActivity(turns: ChatTurn[]): boolean {
  return turns.some((turn) => turn.role === "assistant" && (turn.toolCalls?.length ?? 0) > 0);
}
