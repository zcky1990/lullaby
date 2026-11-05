import {
  deleteWorkflowSchedule,
  getWorkflowSchedule,
  upsertWorkflowSchedule,
  type WorkflowScheduleRow,
} from "../../db/db.ts";
import { nextCronRun } from "./cron.ts";
import type { WorkflowDefinition, WorkflowEventTrigger, WorkflowScheduleInfo } from "./types.ts";

export function scheduleInfoFromRow(
  row: WorkflowScheduleRow | null | undefined,
): WorkflowScheduleInfo | undefined {
  if (!row) return undefined;
  let events: WorkflowEventTrigger[] = [];
  try {
    const parsed = JSON.parse(row.events) as unknown;
    if (Array.isArray(parsed)) {
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
      events = out;
    }
  } catch {
    events = [];
  }
  if (!row.cron && events.length === 0) return undefined;
  return {
    cron: row.cron ?? undefined,
    timezone: row.timezone ?? undefined,
    enabled: row.enabled === 1,
    events,
    nextRunAt: row.next_run_at ?? undefined,
    lastRunAt: row.last_run_at ?? undefined,
    lastRunId: row.last_run_id ?? undefined,
  };
}

export async function syncWorkflowSchedule(
  projectId: string,
  slug: string,
  definition: WorkflowDefinition,
): Promise<WorkflowScheduleInfo | undefined> {
  const hasCron = Boolean(definition.schedule?.cron);
  const events = definition.on ?? [];
  if (!hasCron && events.length === 0) {
    await deleteWorkflowSchedule(projectId, slug);
    return undefined;
  }

  const enabled = definition.schedule?.enabled ?? true;
  const timezone = definition.schedule?.timezone;
  const cron = definition.schedule?.cron ?? null;
  let nextRunAt: string | null = null;
  if (cron && enabled) {
    nextRunAt = nextCronRun(cron, new Date(), timezone);
  }

  const row = await upsertWorkflowSchedule({
    projectId,
    slug,
    cron,
    timezone: timezone ?? null,
    enabled,
    events,
    nextRunAt,
  });
  return scheduleInfoFromRow(row);
}

export async function removeWorkflowSchedule(
  projectId: string,
  slug: string,
): Promise<void> {
  await deleteWorkflowSchedule(projectId, slug);
}

export async function getScheduleInfo(
  projectId: string,
  slug: string,
): Promise<WorkflowScheduleInfo | undefined> {
  return scheduleInfoFromRow(await getWorkflowSchedule(projectId, slug));
}
