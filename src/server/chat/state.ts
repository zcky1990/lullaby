import type { Run } from "./types.ts";

/** Idle active runs (no pending review) are dropped after this. */
export const RUN_TTL_MS = 10 * 60 * 1000;
/**
 * Default for runs that still have Keep/Revert hunks. Overridden at runtime by
 * Global Settings → Tools → `reviewKeepHours` (`chat_review_keep_hours`).
 */
export const PENDING_REVIEW_TTL_MS = 24 * 60 * 60 * 1000;

let pendingReviewTtlMs = PENDING_REVIEW_TTL_MS;

export function setPendingReviewTtlMs(ms: number): void {
  const next = Math.floor(ms);
  pendingReviewTtlMs = Number.isFinite(next) && next > 0
    ? Math.max(RUN_TTL_MS, next)
    : PENDING_REVIEW_TTL_MS;
}

export function getPendingReviewTtlMs(): number {
  return pendingReviewTtlMs;
}

export const runs = new Map<string, Run>();

export function runTtlMs(run: Run): number {
  return run.pendingChanges.size > 0 ? pendingReviewTtlMs : RUN_TTL_MS;
}

export function pruneRuns(now = Date.now()): void {
  for (const [id, run] of runs) {
    if (now - (run.finishedAt ?? run.createdAt) > runTtlMs(run)) runs.delete(id);
  }
}

export function getRun(id: string): Run | undefined {
  return runs.get(id);
}

export function findRunBySession(sessionId: string): Run | undefined {
  let latest: Run | undefined;
  for (const run of runs.values()) {
    if (run.sessionId !== sessionId) continue;
    if (!latest || run.createdAt > latest.createdAt) latest = run;
  }
  return latest;
}

export function findRunByProject(projectId: string): Run | undefined {
  let latest: Run | undefined;
  for (const run of runs.values()) {
    if (run.projectId !== projectId) continue;
    if (!latest || run.createdAt > latest.createdAt) latest = run;
  }
  return latest;
}

export function setRun(run: Run): void {
  runs.set(run.id, run);
}

export function deleteRun(id: string): void {
  runs.delete(id);
}
