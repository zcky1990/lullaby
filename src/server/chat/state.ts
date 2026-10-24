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

export function setRun(run: Run): void {
  runs.set(run.id, run);
}

export function deleteRun(id: string): void {
  runs.delete(id);
}
