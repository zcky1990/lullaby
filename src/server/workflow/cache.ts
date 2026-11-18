import { join, resolve } from "node:path";
import { getAppSetting, setAppSetting } from "../../db/db.ts";
import { workflowRoot, type WorkflowProject } from "./store.ts";

export const WORKFLOW_CACHE_KEEP_HOURS_KEY = "workflow_cache_keep_hours";
export const DEFAULT_WORKFLOW_CACHE_KEEP_HOURS = 72;
export const MIN_WORKFLOW_CACHE_KEEP_HOURS = 1;
export const MAX_WORKFLOW_CACHE_KEEP_HOURS = 168;

const CACHE_VERSION = 1;
const MAX_VALUE_CHARS = 200_000;
const SLUG_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface WorkflowRunCache {
  version: number;
  runId: string;
  slug: string;
  savedAt: string;
  parentRunId?: string;
  params: Record<string, string>;
  outputs: Record<string, string>;
  namedByStep: Record<string, Record<string, string>>;
  successStepIds: string[];
  failedStepIds: string[];
}

export function normalizeWorkflowCacheKeepHours(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_WORKFLOW_CACHE_KEEP_HOURS;
  return Math.min(
    MAX_WORKFLOW_CACHE_KEEP_HOURS,
    Math.max(MIN_WORKFLOW_CACHE_KEEP_HOURS, Math.round(n)),
  );
}

export function workflowCacheKeepHoursToMs(hours: number): number {
  return normalizeWorkflowCacheKeepHours(hours) * 60 * 60 * 1000;
}

export async function readWorkflowCacheKeepHours(): Promise<number> {
  const raw = (await getAppSetting(WORKFLOW_CACHE_KEEP_HOURS_KEY))?.trim() ?? "";
  if (!raw) return DEFAULT_WORKFLOW_CACHE_KEEP_HOURS;
  return normalizeWorkflowCacheKeepHours(Number(raw));
}

export async function writeWorkflowCacheKeepHours(hours: number): Promise<number> {
  const normalized = normalizeWorkflowCacheKeepHours(hours);
  await setAppSetting(WORKFLOW_CACHE_KEEP_HOURS_KEY, String(normalized));
  return normalized;
}

function safeSlug(slug: string): string {
  const value = slug.trim();
  if (!value || !SLUG_PATTERN.test(value) || value.startsWith(".")) {
    throw new Error("Slug workflow tidak valid untuk cache.");
  }
  return value;
}

function safeRunId(runId: string): string {
  const value = runId.trim();
  if (!value || !RUN_ID_PATTERN.test(value)) {
    throw new Error("Run id tidak valid untuk cache.");
  }
  return value;
}

export function workflowCacheDir(project: WorkflowProject, slug: string): string {
  return join(workflowRoot(project).root, "cache", safeSlug(slug));
}

export function workflowCachePath(project: WorkflowProject, slug: string, runId: string): string {
  const dir = workflowCacheDir(project, slug);
  const file = resolve(dir, `${safeRunId(runId)}.json`);
  if (!file.startsWith(`${resolve(dir)}/`)) {
    throw new Error("Path cache workflow tidak valid.");
  }
  return file;
}

function capValue(value: string): string {
  if (value.length <= MAX_VALUE_CHARS) return value;
  return `${value.slice(0, MAX_VALUE_CHARS)}\n…[truncated]`;
}

function capStringMap(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key) continue;
    out[key] = capValue(String(value ?? ""));
  }
  return out;
}

function capNamedByStep(
  input: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [stepId, named] of Object.entries(input)) {
    if (!stepId || !named || typeof named !== "object") continue;
    out[stepId] = capStringMap(named);
  }
  return out;
}

export function buildRunCache(input: {
  runId: string;
  slug: string;
  params: Record<string, string>;
  outputs: Map<string, string> | Record<string, string>;
  namedByStep: Map<string, Record<string, string>> | Record<string, Record<string, string>>;
  successStepIds: Iterable<string>;
  failedStepIds: Iterable<string>;
  parentRunId?: string;
  savedAt?: string;
}): WorkflowRunCache {
  const outputs = input.outputs instanceof Map
    ? Object.fromEntries(input.outputs.entries())
    : input.outputs;
  const named = input.namedByStep instanceof Map
    ? Object.fromEntries(
      [...input.namedByStep.entries()].map(([key, value]) => [key, { ...value }]),
    )
    : input.namedByStep;
  return {
    version: CACHE_VERSION,
    runId: input.runId,
    slug: input.slug,
    savedAt: input.savedAt ?? new Date().toISOString(),
    parentRunId: input.parentRunId,
    params: capStringMap(input.params),
    outputs: capStringMap(outputs),
    namedByStep: capNamedByStep(named),
    successStepIds: [...new Set(input.successStepIds)].filter(Boolean),
    failedStepIds: [...new Set(input.failedStepIds)].filter(Boolean),
  };
}

function parseCache(raw: unknown): WorkflowRunCache | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== CACHE_VERSION) return null;
  if (typeof record.runId !== "string" || typeof record.slug !== "string") return null;
  if (typeof record.savedAt !== "string") return null;
  const params = record.params && typeof record.params === "object" && !Array.isArray(record.params)
    ? capStringMap(record.params as Record<string, string>)
    : {};
  const outputs =
    record.outputs && typeof record.outputs === "object" && !Array.isArray(record.outputs)
      ? capStringMap(record.outputs as Record<string, string>)
      : {};
  const namedRaw = record.namedByStep && typeof record.namedByStep === "object" &&
      !Array.isArray(record.namedByStep)
    ? record.namedByStep as Record<string, Record<string, string>>
    : {};
  const successStepIds = Array.isArray(record.successStepIds)
    ? record.successStepIds.map(String).filter(Boolean)
    : [];
  const failedStepIds = Array.isArray(record.failedStepIds)
    ? record.failedStepIds.map(String).filter(Boolean)
    : [];
  return {
    version: CACHE_VERSION,
    runId: record.runId,
    slug: record.slug,
    savedAt: record.savedAt,
    parentRunId: typeof record.parentRunId === "string" ? record.parentRunId : undefined,
    params,
    outputs,
    namedByStep: capNamedByStep(namedRaw),
    successStepIds,
    failedStepIds,
  };
}

export function isCacheExpired(cache: WorkflowRunCache, keepHours: number, now = Date.now()): boolean {
  const saved = Date.parse(cache.savedAt);
  if (!Number.isFinite(saved)) return true;
  return now - saved > workflowCacheKeepHoursToMs(keepHours);
}

export async function writeRunCache(
  project: WorkflowProject,
  cache: WorkflowRunCache,
): Promise<string> {
  const path = workflowCachePath(project, cache.slug, cache.runId);
  await Deno.mkdir(workflowCacheDir(project, cache.slug), { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(cache, null, 2));
  return path;
}

export async function readRunCache(
  project: WorkflowProject,
  slug: string,
  runId: string,
): Promise<WorkflowRunCache | null> {
  const path = workflowCachePath(project, slug, runId);
  const text = await Deno.readTextFile(path).catch(() => null);
  if (!text) return null;
  try {
    return parseCache(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function deleteRunCache(
  project: WorkflowProject,
  slug: string,
  runId: string,
): Promise<boolean> {
  const path = workflowCachePath(project, slug, runId);
  try {
    await Deno.remove(path);
    return true;
  } catch {
    return false;
  }
}

export async function hasContinuableCache(
  project: WorkflowProject,
  slug: string,
  runId: string,
  keepHours?: number,
): Promise<boolean> {
  const cache = await readRunCache(project, slug, runId);
  if (!cache) return false;
  const hours = keepHours ?? await readWorkflowCacheKeepHours();
  return !isCacheExpired(cache, hours);
}

/** Delete cache files older than keepHours under a project's `.workflows/cache`. */
export async function pruneProjectWorkflowCaches(
  project: WorkflowProject,
  keepHours?: number,
): Promise<number> {
  const hours = keepHours ?? await readWorkflowCacheKeepHours();
  const ttlMs = workflowCacheKeepHoursToMs(hours);
  const root = join(workflowRoot(project).root, "cache");
  let removed = 0;
  let slugEntries: Deno.DirEntry[];
  try {
    slugEntries = [];
    for await (const entry of Deno.readDir(root)) slugEntries.push(entry);
  } catch {
    return 0;
  }
  const now = Date.now();
  for (const slugEntry of slugEntries) {
    if (!slugEntry.isDirectory) continue;
    const slugDir = join(root, slugEntry.name);
    try {
      for await (const file of Deno.readDir(slugDir)) {
        if (!file.isFile || !file.name.endsWith(".json")) continue;
        const path = join(slugDir, file.name);
        let stale = false;
        try {
          const text = await Deno.readTextFile(path);
          const cache = parseCache(JSON.parse(text));
          if (!cache || isCacheExpired(cache, hours, now)) stale = true;
        } catch {
          const stat = await Deno.stat(path).catch(() => null);
          if (!stat?.mtime || now - stat.mtime.getTime() > ttlMs) stale = true;
        }
        if (stale) {
          await Deno.remove(path).catch(() => {});
          removed += 1;
        }
      }
    } catch {
      // ignore unreadable slug dirs
    }
  }
  return removed;
}
