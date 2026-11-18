import { equal, deepEqual } from "node:assert/strict";
import { join } from "node:path";
import {
  buildRunCache,
  DEFAULT_WORKFLOW_CACHE_KEEP_HOURS,
  deleteRunCache,
  hasContinuableCache,
  isCacheExpired,
  normalizeWorkflowCacheKeepHours,
  pruneProjectWorkflowCaches,
  readRunCache,
  workflowCacheKeepHoursToMs,
  writeRunCache,
} from "../src/server/workflow/cache.ts";
import {
  collectDescendantStepIds,
  continueSeedFromCache,
  trimContinueSeedForStep,
} from "../src/server/workflow/runner.ts";
import type { WorkflowProject } from "../src/server/workflow/store.ts";
import type { WorkflowDefinition, WorkflowStep } from "../src/server/workflow/types.ts";

function stubStep(id: string, depends: string[] = []): WorkflowStep {
  return {
    id,
    kind: "shell",
    run: "true",
    outputs: [],
    depends,
    env: {},
    retry: { limit: 0, intervalSec: 0 },
    next: [],
  };
}

function stubDefinition(steps: WorkflowStep[]): WorkflowDefinition {
  return {
    name: "demo",
    params: [],
    env: {},
    on: [],
    steps,
    layers: [steps.map((step) => step.id)],
  };
}

Deno.test("normalizeWorkflowCacheKeepHours clamps 1–168", () => {
  equal(normalizeWorkflowCacheKeepHours(0), 1);
  equal(normalizeWorkflowCacheKeepHours(200), 168);
  equal(normalizeWorkflowCacheKeepHours("72"), 72);
  equal(normalizeWorkflowCacheKeepHours("nope"), DEFAULT_WORKFLOW_CACHE_KEEP_HOURS);
});

Deno.test("isCacheExpired respects TTL", () => {
  const cache = buildRunCache({
    runId: "run1",
    slug: "demo",
    params: {},
    outputs: { a: "1" },
    namedByStep: {},
    successStepIds: ["a"],
    failedStepIds: ["b"],
    savedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  });
  equal(isCacheExpired(cache, 1), true);
  equal(isCacheExpired(cache, 24), false);
  equal(workflowCacheKeepHoursToMs(2), 2 * 60 * 60 * 1000);
});

Deno.test("write/read/delete run cache under .workflows/cache", async () => {
  const root = await Deno.makeTempDir();
  const project: WorkflowProject = {
    id: "p1",
    name: "demo",
    workspace_path: root,
  };
  const cache = buildRunCache({
    runId: "abc123",
    slug: "nightly",
    params: { TASK: "hi" },
    outputs: new Map([["collect", "out"]]),
    namedByStep: new Map([["collect", { status: "ok" }]]),
    successStepIds: ["collect"],
    failedStepIds: ["build"],
  });
  const path = await writeRunCache(project, cache);
  equal(path.includes(join(".workflows", "cache", "nightly", "abc123.json")), true);

  const loaded = await readRunCache(project, "nightly", "abc123");
  equal(loaded?.runId, "abc123");
  equal(loaded?.outputs.collect, "out");
  deepEqual(loaded?.namedByStep.collect, { status: "ok" });
  equal(await hasContinuableCache(project, "nightly", "abc123", 72), true);

  equal(await deleteRunCache(project, "nightly", "abc123"), true);
  equal(await readRunCache(project, "nightly", "abc123"), null);
});

Deno.test("pruneProjectWorkflowCaches removes expired files", async () => {
  const root = await Deno.makeTempDir();
  const project: WorkflowProject = {
    id: "p2",
    name: "demo",
    workspace_path: root,
  };
  const fresh = buildRunCache({
    runId: "fresh1",
    slug: "job",
    params: {},
    outputs: { x: "1" },
    namedByStep: {},
    successStepIds: ["x"],
    failedStepIds: [],
  });
  const stale = buildRunCache({
    runId: "stale1",
    slug: "job",
    params: {},
    outputs: { x: "1" },
    namedByStep: {},
    successStepIds: ["x"],
    failedStepIds: ["y"],
    savedAt: new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString(),
  });
  await writeRunCache(project, fresh);
  await writeRunCache(project, stale);
  const removed = await pruneProjectWorkflowCaches(project, 24);
  equal(removed >= 1, true);
  equal(Boolean(await readRunCache(project, "job", "fresh1")), true);
  equal(await readRunCache(project, "job", "stale1"), null);
});

Deno.test("continueSeedFromCache copies maps for runner", () => {
  const cache = buildRunCache({
    runId: "parent",
    slug: "wf",
    params: { A: "1" },
    outputs: { step1: "ok" },
    namedByStep: { step1: { k: "v" } },
    successStepIds: ["step1"],
    failedStepIds: ["step2"],
  });
  const seed = continueSeedFromCache(cache);
  equal(seed.parentRunId, "parent");
  equal(seed.params.A, "1");
  equal(seed.outputs.step1, "ok");
  deepEqual(seed.successStepIds, ["step1"]);
  // ensure independent copy
  seed.params.A = "mutated";
  equal(cache.params.A, "1");
});

Deno.test("collectDescendantStepIds includes root and transitive dependents", () => {
  const steps = [
    stubStep("a"),
    stubStep("b", ["a"]),
    stubStep("c", ["b"]),
    stubStep("d", ["a"]),
  ];
  deepEqual([...collectDescendantStepIds(steps, "b")].sort(), ["b", "c"]);
  deepEqual([...collectDescendantStepIds(steps, "a")].sort(), ["a", "b", "c", "d"]);
});

Deno.test("trimContinueSeedForStep drops fromStep and descendants", () => {
  const definition = stubDefinition([
    stubStep("install"),
    stubStep("build", ["install"]),
    stubStep("test", ["build"]),
    stubStep("lint", ["install"]),
  ]);
  const cache = buildRunCache({
    runId: "parent",
    slug: "wf",
    params: { X: "1" },
    outputs: {
      install: "ok",
      build: "built",
      ARTIFACT: "pkg",
      lint: "clean",
    },
    namedByStep: {
      build: { ARTIFACT: "pkg" },
      lint: { ok: "1" },
    },
    successStepIds: ["install", "build", "lint"],
    failedStepIds: ["test"],
  });
  // mark build.output alias via definition
  definition.steps[1] = { ...definition.steps[1], output: "ARTIFACT" };

  const seed = trimContinueSeedForStep(continueSeedFromCache(cache), definition, "build");
  deepEqual(seed.successStepIds.sort(), ["install", "lint"]);
  equal(seed.outputs.install, "ok");
  equal(seed.outputs.lint, "clean");
  equal(seed.outputs.build, undefined);
  equal(seed.outputs.ARTIFACT, undefined);
  equal(seed.namedByStep.build, undefined);
  deepEqual(seed.namedByStep.lint, { ok: "1" });
  equal(seed.params.X, "1");
});
