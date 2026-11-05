import type { Run } from "./types.ts";

export const RUN_TTL_MS = 10 * 60 * 1000;

export const runs = new Map<string, Run>();

export function pruneRuns(): void {
  const now = Date.now();
  for (const [id, run] of runs) {
    if (now - run.createdAt > RUN_TTL_MS) runs.delete(id);
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
