import {
  getProject,
  listDueWorkflowSchedules,
  listEventWorkflowSchedules,
  listProjects,
  listWorkflowSchedules,
  touchWorkflowScheduleRun,
  type WorkflowScheduleRow,
} from "../../db/db.ts";
import { log } from "../../core/logger.ts";
import { onBus, type BusEvent } from "../bus.ts";
import { nextCronRun } from "./cron.ts";
import { parseWorkflow } from "./parse.ts";
import { startWorkflowRun } from "./runner.ts";
import { type WorkflowEventTrigger } from "./types.ts";
import { readWorkflow, type WorkflowProject } from "./store.ts";

const TICK_MS = 30_000;
const SKIP_EVENTS = new Set([
  "workflow.run.started",
  "workflow.run.failed",
  "workflow.run.cancel_requested",
  "workflow.run.deleted",
  "app.started",
]);

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let unsubBus: (() => void) | null = null;

function parseEvents(raw: string): WorkflowEventTrigger[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: WorkflowEventTrigger[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const event = (item as { event?: unknown }).event;
      if (typeof event !== "string" || !event.trim()) continue;
      const status = (item as { status?: unknown }).status;
      const trigger: WorkflowEventTrigger = { event: event.trim() };
      if (typeof status === "string" && status.trim()) trigger.status = status.trim();
      out.push(trigger);
    }
    return out;
  } catch {
    return [];
  }
}

function payloadStatus(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const status = (payload as { status?: unknown }).status;
  return typeof status === "string" ? status : undefined;
}

function payloadProjectId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const projectId = (payload as { projectId?: unknown }).projectId;
  return typeof projectId === "string" ? projectId : undefined;
}

async function projectFromId(projectId: string): Promise<WorkflowProject | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  return {
    id: project.id,
    name: project.name,
    workspace_path: project.workspace_path,
  };
}

async function advanceCron(row: WorkflowScheduleRow, from = new Date()): Promise<void> {
  if (!row.cron) {
    await touchWorkflowScheduleRun(row.project_id, row.workflow_slug, { nextRunAt: null });
    return;
  }
  try {
    const next = nextCronRun(row.cron, from, row.timezone ?? undefined);
    await touchWorkflowScheduleRun(row.project_id, row.workflow_slug, { nextRunAt: next });
  } catch (error) {
    log.warn("workflow schedule next_run failed", {
      projectId: row.project_id,
      slug: row.workflow_slug,
      error: String(error),
    });
    await touchWorkflowScheduleRun(row.project_id, row.workflow_slug, { nextRunAt: null });
  }
}

async function launchScheduled(
  row: WorkflowScheduleRow,
  trigger: string,
): Promise<string | null> {
  const project = await projectFromId(row.project_id);
  if (!project?.workspace_path) {
    log.warn("workflow schedule skipped: no workspace", {
      projectId: row.project_id,
      slug: row.workflow_slug,
      trigger,
    });
    return null;
  }

  try {
    const { yaml, path } = await readWorkflow(project, row.workflow_slug);
    const definition = parseWorkflow(yaml, row.workflow_slug);
    const runId = await startWorkflowRun({
      project,
      projectId: row.project_id,
      slug: row.workflow_slug,
      definition,
      yaml,
      workflowPath: path,
      trigger,
    });
    await touchWorkflowScheduleRun(row.project_id, row.workflow_slug, {
      lastRunAt: new Date().toISOString(),
      lastRunId: runId,
    });
    return runId;
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes("sedang berjalan")) {
      log.info("workflow schedule skipped: already running", {
        projectId: row.project_id,
        slug: row.workflow_slug,
        trigger,
      });
      return null;
    }
    log.warn("workflow schedule run failed", {
      projectId: row.project_id,
      slug: row.workflow_slug,
      trigger,
      error: message,
    });
    return null;
  }
}

async function tickCron(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const due = await listDueWorkflowSchedules(new Date().toISOString());
    for (const row of due) {
      await advanceCron(row);
      await launchScheduled(row, "cron");
    }
  } catch (error) {
    log.warn("workflow scheduler tick failed", { error: String(error) });
  } finally {
    ticking = false;
  }
}

async function handleBusEvent(event: BusEvent): Promise<void> {
  if (SKIP_EVENTS.has(event.type)) return;
  if (event.type.startsWith("workflow.")) return;

  const rows = await listEventWorkflowSchedules(event.type);
  if (rows.length === 0) return;

  const status = payloadStatus(event.payload);
  const projectId = payloadProjectId(event.payload);

  for (const row of rows) {
    if (projectId && row.project_id !== projectId) continue;
    const events = parseEvents(row.events);
    const match = events.find((item) => {
      if (item.event !== event.type) return false;
      if (item.status && status && item.status.toLowerCase() !== status.toLowerCase()) {
        return false;
      }
      if (item.status && !status) return false;
      return true;
    });
    if (!match) continue;
    await launchScheduled(row, `event:${event.type}`);
  }
}

/** Recompute next_run_at for all enabled cron schedules (e.g. after restart). */
export async function refreshWorkflowScheduleTimers(): Promise<void> {
  const projects = await listProjects();
  for (const project of projects) {
    const rows = await listWorkflowSchedules(project.id);
    for (const row of rows) {
      if (!row.cron || row.enabled !== 1) continue;
      const from = row.next_run_at && new Date(row.next_run_at) < new Date()
        ? new Date(Date.now() - 60_000)
        : new Date();
      await advanceCron(row, from);
    }
  }
}

export function startWorkflowScheduler(): void {
  if (timer != null) return;
  void refreshWorkflowScheduleTimers().catch((error) => {
    log.warn("workflow schedule refresh failed", { error: String(error) });
  });
  void tickCron();
  timer = setInterval(() => {
    void tickCron();
  }, TICK_MS);
  unsubBus = onBus((event) => {
    void handleBusEvent(event).catch((error) => {
      log.warn("workflow event trigger failed", {
        type: event.type,
        error: String(error),
      });
    });
  });
  log.info("workflow scheduler started", { tickMs: TICK_MS });
}

export function stopWorkflowScheduler(): void {
  if (timer != null) {
    clearInterval(timer);
    timer = null;
  }
  unsubBus?.();
  unsubBus = null;
}
