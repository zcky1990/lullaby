import {
  appendWorkflowSessionMessage,
  createWorkflowRun,
  createWorkflowRunStep,
  findActiveWorkflowRun,
  getOrCreateWorkflowSession,
  listLlmProviders,
  listRoles,
  listWorkflowSessionMessages,
  updateWorkflowRun,
  updateWorkflowRunStep,
  type WorkflowRunStepRow,
} from "../../db/db.ts";
import { publish } from "../bus.ts";
import { runHeadlessAgent } from "../chat/headless.ts";
import { complete } from "../chat/llm.ts";
import type { ChatTurn } from "../chat/types.ts";
import { record } from "../http.ts";
import { sendNotificationByChannelRef } from "../notifications/send.ts";
import {
  collectAgentParamAttachments,
  isAllowedParamOverrideKey,
  resolveWorkflowLlmSelection,
} from "./params.ts";
import { resolveWorkflowDir, type WorkflowProject } from "./store.ts";
import type { WorkflowDefinition, WorkflowStep } from "./types.ts";

const MAX_LOG = 200_000;
const MAX_PARALLEL = 8;
const KILL_GRACE_MS = 2_000;

interface ActiveRun {
  id: string;
  projectId: string;
  slug: string;
  canceled: boolean;
  processes: Set<Deno.ChildProcess>;
  stepIds: Map<string, string>;
}

const activeRuns = new Map<string, ActiveRun>();

export function isWorkflowRunActive(runId: string): boolean {
  return activeRuns.has(runId);
}

export async function startWorkflowRun(input: {
  project: WorkflowProject;
  projectId: string;
  slug: string;
  definition: WorkflowDefinition;
  yaml: string;
  workflowPath: string;
  params?: Record<string, string>;
  trigger?: string;
}): Promise<string> {
  const existing = await findActiveWorkflowRun(input.projectId, input.slug);
  if (existing) throw new Error("Workflow sedang berjalan. Tunggu atau batalkan run aktif.");

  const run = await createWorkflowRun({
    projectId: input.projectId,
    slug: input.slug,
    name: input.definition.name,
    path: input.workflowPath,
    yaml: input.yaml,
    trigger: input.trigger ?? "manual",
  });

  const stepIds = new Map<string, string>();
  for (const step of input.definition.steps) {
    const prompt = step.with?.prompt ?? step.with?.messages?.[0]?.content ?? step.action ?? "";
    const command = step.run ??
      (step.kind === "router"
        ? `[router] ${step.router?.value ?? "route"}`
        : step.kind === "notify"
        ? `[notify] ${step.notify?.channel ?? "channel"}`
        : step.kind === "agent"
        ? `[agent] ${prompt}`
        : `[llm] ${prompt || "chat.completion"}`);
    const row = await createWorkflowRunStep(run.id, step.id, command);
    stepIds.set(step.id, row.id);
  }

  const active: ActiveRun = {
    id: run.id,
    projectId: input.projectId,
    slug: input.slug,
    canceled: false,
    processes: new Set(),
    stepIds,
  };
  activeRuns.set(run.id, active);
  await record("workflow.run.started", {
    projectId: input.projectId,
    slug: input.slug,
    runId: run.id,
    trigger: input.trigger ?? "manual",
  });
  void execute(run.id, active, input.project, input.definition, input.params).catch(
    async (error) => {
      activeRuns.delete(run.id);
      await updateWorkflowRun(run.id, "failed", (error as Error).message);
      await record("workflow.run.failed", {
        projectId: input.projectId,
        slug: input.slug,
        runId: run.id,
        error: (error as Error).message,
      });
    },
  );
  return run.id;
}

export function cancelWorkflowRun(runId: string): boolean {
  const active = activeRuns.get(runId);
  if (!active) return false;
  active.canceled = true;
  for (const child of active.processes) {
    try {
      child.kill("SIGTERM");
    } catch {
      // already exited
    }
  }
  setTimeout(() => {
    for (const child of active.processes) {
      try {
        child.kill("SIGKILL");
      } catch {
        // already exited
      }
    }
  }, KILL_GRACE_MS);
  return true;
}

function shellFor(command: string): { command: string; args: string[] } {
  if (Deno.build.os === "windows") {
    return { command: "cmd", args: ["/d", "/s", "/c", command] };
  }
  // Prefer POSIX sh so scripts stay portable (zsh treats `status` as read-only).
  return { command: "/bin/sh", args: ["-lc", command] };
}

function applyLogLimit(log: string): string {
  if (log.length <= MAX_LOG) return log;
  return `${log.slice(0, MAX_LOG)}\n… (log dipotong)`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stepSatisfied(step: WorkflowStep, status: string): boolean {
  if (status === "success") return true;
  if (status !== "failed") return false;
  return step.continueOn?.includes("failure") === true ||
    step.continueOn?.includes("exit_code") === true;
}

interface StepResult {
  code: number;
  log: string;
  output?: string;
  namedOutputs?: Record<string, string>;
  selectedRoutes?: string[];
}

function buildParams(
  definition: WorkflowDefinition,
  overrides?: Record<string, string>,
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const param of definition.params) {
    if (param.default !== undefined) params[param.name] = param.default;
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (isAllowedParamOverrideKey(definition.params, key)) {
        params[key] = value;
      }
    }
  }
  return params;
}

async function execute(
  runId: string,
  active: ActiveRun,
  project: WorkflowProject,
  definition: WorkflowDefinition,
  paramOverrides?: Record<string, string>,
): Promise<void> {
  const statuses = new Map<string, string>();
  const logs = new Map<string, string>();
  const outputs = new Map<string, string>();
  const namedByStep = new Map<string, Record<string, string>>();
  const routeSelections = new Map<string, string[]>();
  const runCounts = new Map<string, number>();
  const params = buildParams(definition, paramOverrides);
  const effectiveDefinition: WorkflowDefinition = {
    ...definition,
    env: { ...definition.env, ...params },
  };
  const stepById = new Map(definition.steps.map((step) => [step.id, step]));
  let failedWithoutContinue = false;
  let loopError: string | undefined;

  const setStatus = async (
    step: WorkflowStep,
    status: string,
    exitCode: number | null,
    log: string,
  ) => {
    statuses.set(step.id, status);
    if (status === "failed" && !stepSatisfied(step, status)) failedWithoutContinue = true;
    const rowId = active.stepIds.get(step.id);
    if (rowId) {
      await updateWorkflowRunStep(rowId, {
        status: status as WorkflowRunStepRow["status"],
        exitCode,
        log: applyLogLimit(log),
      });
    }
    publish({
      type: "workflow.step.status",
      payload: { runId, stepId: step.id, status, exitCode },
    });
  };

  const depsSatisfied = (step: WorkflowStep): boolean =>
    step.depends.every((dependency) => {
      const depStep = stepById.get(dependency);
      const status = statuses.get(dependency);
      if (!depStep || status === undefined) return false;
      return stepSatisfied(depStep, status);
    });

  const isRouteActive = (step: WorkflowStep): boolean => {
    if (!step.routeGate) return true;
    const selected = routeSelections.get(step.routeGate.routerId) ?? [];
    return selected.includes(step.id);
  };

  const isRunnable = (step: WorkflowStep): boolean => {
    if (active.canceled || loopError) return false;
    const status = statuses.get(step.id);
    if (
      status === "running" || status === "success" || status === "failed" ||
      status === "skipped" || status === "canceled"
    ) {
      return false;
    }
    if (!isRouteActive(step)) return false;
    return depsSatisfied(step);
  };

  const descendantsOf = (startId: string): Set<string> => {
    const found = new Set<string>();
    const queue = [startId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (found.has(id)) continue;
      found.add(id);
      for (const step of definition.steps) {
        if (step.depends.includes(id)) queue.push(step.id);
      }
    }
    return found;
  };

  const resetFrom = async (
    startId: string,
    reason: string,
    maxLoops: number,
  ): Promise<boolean> => {
    const runs = runCounts.get(startId) ?? 0;
    if (runs >= maxLoops) {
      loopError = `Loop pada "${startId}" melebihi max_loops=${maxLoops} (${reason}).`;
      return false;
    }
    const toReset = descendantsOf(startId);
    for (const id of toReset) {
      const step = stepById.get(id)!;
      const note = `\n[loop reset ← ${reason} · next attempt ${runs + 1}/${maxLoops}]\n`;
      logs.set(id, `${logs.get(id) ?? ""}${note}`);
      statuses.delete(id);
      outputs.delete(id);
      namedByStep.delete(id);
      if (step.kind === "router") routeSelections.delete(id);
      const rowId = active.stepIds.get(id);
      if (rowId) {
        await updateWorkflowRunStep(rowId, {
          status: "pending",
          exitCode: null,
          log: applyLogLimit(logs.get(id) ?? ""),
        });
      }
      publish({
        type: "workflow.step.status",
        payload: { runId, stepId: id, status: "pending" },
      });
    }
    return true;
  };

  const runOne = async (step: WorkflowStep): Promise<void> => {
    runCounts.set(step.id, (runCounts.get(step.id) ?? 0) + 1);
    const log = logs.get(step.id) ?? "";
    if (active.canceled) {
      await setStatus(step, "canceled", null, log);
      return;
    }
    const rowId = active.stepIds.get(step.id);
    if (rowId) {
      await updateWorkflowRunStep(rowId, {
        status: "running",
        startedAt: true,
        log: applyLogLimit(log),
      });
      publish({
        type: "workflow.step.status",
        payload: { runId, stepId: step.id, status: "running" },
      });
    }
    statuses.set(step.id, "running");

    let result: StepResult = { code: -1, log };
    for (let attempt = 0; attempt <= step.retry.limit; attempt++) {
      if (active.canceled) break;
      if (attempt > 0) {
        result.log += `\n[retry ${attempt}/${step.retry.limit}]\n`;
        await sleep(step.retry.intervalSec * 1000);
        if (active.canceled) break;
      }
      result = await runStep(
        runId,
        active,
        project,
        effectiveDefinition,
        step,
        result.log,
        rowId,
        outputs,
        namedByStep,
        params,
      );
      if (result.code === 0 || active.canceled) break;
    }

    logs.set(step.id, result.log);
    if (active.canceled) {
      await setStatus(step, "canceled", result.code, result.log);
      return;
    }
    if (result.code !== 0) {
      await setStatus(step, "failed", result.code, result.log);
      return;
    }

    const value = result.output ?? result.log;
    outputs.set(step.id, value);
    if (step.output) outputs.set(step.output, value);
    if (result.namedOutputs) {
      namedByStep.set(step.id, {
        ...(namedByStep.get(step.id) ?? {}),
        ...result.namedOutputs,
      });
      for (const [name, namedValue] of Object.entries(result.namedOutputs)) {
        outputs.set(name, namedValue);
      }
    }
    if (result.selectedRoutes) {
      routeSelections.set(step.id, result.selectedRoutes);
    }
    await setStatus(step, "success", 0, result.log);

    if (step.kind === "router" && step.router && result.selectedRoutes) {
      for (const targetId of result.selectedRoutes) {
        if (!step.router.loopBacks.includes(targetId)) continue;
        const ok = await resetFrom(
          targetId,
          `router ${step.id}`,
          step.router.maxLoops,
        );
        if (!ok) {
          await setStatus(
            step,
            "failed",
            1,
            `${result.log}\n[loop error] ${loopError}\n`,
          );
          return;
        }
      }
    }

    for (const nextId of step.next) {
      const gateRouter = step.routeGate ? stepById.get(step.routeGate.routerId) : undefined;
      const maxLoops = gateRouter?.router?.maxLoops ??
        (step.kind === "router" ? (step.router?.maxLoops ?? 10) : 10);
      const ok = await resetFrom(
        nextId,
        `next dari ${step.id}`,
        maxLoops,
      );
      if (!ok) {
        await setStatus(
          step,
          "failed",
          1,
          `${logs.get(step.id) ?? ""}\n[loop error] ${loopError}\n`,
        );
        return;
      }
    }
  };

  while (!active.canceled && !loopError) {
    const batch = definition.steps.filter((step) => isRunnable(step));
    if (batch.length === 0) break;
    for (let index = 0; index < batch.length; index += MAX_PARALLEL) {
      const chunk = batch.slice(index, index + MAX_PARALLEL);
      await Promise.all(chunk.map((step) => runOne(step)));
      if (active.canceled || loopError) break;
    }
  }

  for (const step of definition.steps) {
    if (statuses.has(step.id)) continue;
    const log = logs.get(step.id) ?? "";
    if (active.canceled) {
      await setStatus(step, "canceled", null, log);
    } else if (step.routeGate && !isRouteActive(step)) {
      await setStatus(step, "skipped", null, `${log}[skipped: router tidak memilih step ini]\n`);
    } else if (!depsSatisfied(step)) {
      await setStatus(step, "skipped", null, `${log}[skipped: dependency tidak sukses]\n`);
    } else {
      await setStatus(step, "skipped", null, `${log}[skipped]\n`);
    }
  }

  activeRuns.delete(runId);
  const status = active.canceled
    ? "canceled"
    : loopError || failedWithoutContinue
    ? "failed"
    : "success";
  const error = loopError
    ? loopError
    : status === "failed"
    ? "Satu atau lebih step gagal."
    : undefined;
  await updateWorkflowRun(runId, status, error);
  await record(`workflow.run.${status}`, {
    projectId: active.projectId,
    slug: active.slug,
    runId,
  });
}

function interpolate(
  value: string,
  outputs: Map<string, string>,
  env: Record<string, string>,
  namedByStep: Map<string, Record<string, string>> = new Map(),
  params: Record<string, string> = {},
): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, rawKey: string) => {
    const key = rawKey.trim();
    const stepMatch = /^steps\.([^.]+)\.(?:output|outputs)(?:\.(.+))?$/.exec(key);
    if (stepMatch) {
      const stepId = stepMatch[1];
      const named = stepMatch[2];
      if (named) {
        const fromNamed = namedByStep.get(stepId)?.[named];
        return fromNamed === undefined ? match : fromNamed;
      }
      const stepValue = outputs.get(stepId);
      return stepValue === undefined ? match : stepValue;
    }
    if (key.startsWith("params.")) {
      const name = key.slice(7);
      return params[name] ?? env[name] ?? match;
    }
    if (key.startsWith("env.")) {
      const name = key.slice(4);
      return env[name] ?? params[name] ?? match;
    }
    return outputs.get(key) ?? params[key] ?? match;
  });
}

function parseOutputFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    out[key] = trimmed.slice(eq + 1);
  }
  return out;
}

function createLogWriter(
  runId: string,
  stepId: string,
  prefix: string,
  stepRowId?: string,
) {
  let log = prefix;
  let writeChain = Promise.resolve();
  const append = (chunk: string) => {
    log += chunk;
    if (log.length > MAX_LOG * 2) log = log.slice(-MAX_LOG);
    publish({ type: "workflow.step.log", payload: { runId, stepId, chunk } });
    if (stepRowId) {
      const snapshot = applyLogLimit(log);
      writeChain = writeChain
        .then(() => updateWorkflowRunStep(stepRowId, { status: "running", log: snapshot }))
        .catch(() => {});
    }
  };
  return {
    append,
    flush: () => writeChain,
    get: () => log,
  };
}

async function runStep(
  runId: string,
  active: ActiveRun,
  project: WorkflowProject,
  definition: WorkflowDefinition,
  step: WorkflowStep,
  logPrefix: string,
  stepRowId: string | undefined,
  outputs: Map<string, string>,
  namedByStep: Map<string, Record<string, string>>,
  params: Record<string, string>,
): Promise<StepResult> {
  if (step.kind === "router") {
    return await runRouterStep(
      runId,
      definition,
      step,
      logPrefix,
      stepRowId,
      outputs,
      namedByStep,
      params,
    );
  }
  if (step.kind === "llm") {
    return await runLlmStep(
      runId,
      project,
      definition,
      step,
      logPrefix,
      stepRowId,
      outputs,
      namedByStep,
      params,
    );
  }
  if (step.kind === "agent") {
    return await runAgentStep(
      runId,
      active,
      project,
      definition,
      step,
      logPrefix,
      stepRowId,
      outputs,
      namedByStep,
      params,
    );
  }
  if (step.kind === "notify") {
    return await runNotifyStep(
      runId,
      project,
      definition,
      step,
      logPrefix,
      stepRowId,
      outputs,
      namedByStep,
      params,
      active.slug,
    );
  }
  return await runShellStep(
    runId,
    active,
    project,
    definition,
    step,
    logPrefix,
    stepRowId,
    outputs,
    namedByStep,
    params,
  );
}

async function runNotifyStep(
  runId: string,
  project: WorkflowProject,
  definition: WorkflowDefinition,
  step: WorkflowStep,
  logPrefix: string,
  stepRowId: string | undefined,
  outputs: Map<string, string>,
  namedByStep: Map<string, Record<string, string>>,
  params: Record<string, string>,
  slug: string,
): Promise<StepResult> {
  const writer = createLogWriter(runId, step.id, logPrefix, stepRowId);
  try {
    const config = step.notify;
    if (!config) throw new Error("Konfigurasi notification tidak lengkap.");
    const channel = interpolate(config.channel, outputs, definition.env, namedByStep, params);
    const message = interpolate(config.message, outputs, definition.env, namedByStep, params);
    writer.append(`[notify] channel=${channel}\n`);
    const result = await sendNotificationByChannelRef(channel, {
      text: message,
      projectId: project.id,
      projectName: project.name,
      slug,
      workflowName: definition.name,
      runId,
      stepId: step.id,
    });
    if (!result.ok) {
      writer.append(`[notify error] ${result.error ?? "gagal mengirim"}\n`);
      await writer.flush();
      return { code: 1, log: writer.get(), output: message };
    }
    writer.append(`[notify] terkirim ke ${result.channelName}\n`);
    await writer.flush();
    return { code: 0, log: writer.get(), output: message };
  } catch (error) {
    writer.append(`[notify error] ${(error as Error).message}\n`);
    await writer.flush();
    return { code: -1, log: writer.get() };
  }
}

async function runRouterStep(
  runId: string,
  definition: WorkflowDefinition,
  step: WorkflowStep,
  logPrefix: string,
  stepRowId: string | undefined,
  outputs: Map<string, string>,
  namedByStep: Map<string, Record<string, string>>,
  params: Record<string, string>,
): Promise<StepResult> {
  const writer = createLogWriter(runId, step.id, logPrefix, stepRowId);
  try {
    const router = step.router;
    if (!router) throw new Error("Konfigurasi router tidak lengkap.");
    const value = interpolate(router.value, outputs, definition.env, namedByStep, params);
    const selected = router.routes[value];
    if (!selected || selected.length === 0) {
      writer.append(`[router] value="${value}" tidak cocok dengan routes\n`);
      await writer.flush();
      return { code: 1, log: writer.get(), output: value };
    }
    writer.append(`[router] value="${value}" → ${selected.join(", ")}\n`);
    await writer.flush();
    return {
      code: 0,
      log: writer.get(),
      output: value,
      namedOutputs: { value, routes: selected.join(",") },
      selectedRoutes: selected,
    };
  } catch (error) {
    writer.append(`[router error] ${(error as Error).message}\n`);
    await writer.flush();
    return { code: -1, log: writer.get() };
  }
}

async function runShellStep(
  runId: string,
  active: ActiveRun,
  project: WorkflowProject,
  definition: WorkflowDefinition,
  step: WorkflowStep,
  logPrefix: string,
  stepRowId: string | undefined,
  outputs: Map<string, string>,
  namedByStep: Map<string, Record<string, string>>,
  params: Record<string, string>,
): Promise<StepResult> {
  const writer = createLogWriter(runId, step.id, logPrefix, stepRowId);
  const append = writer.append;
  const command = interpolate(step.run ?? "", outputs, definition.env, namedByStep, params);
  const workflowEnv = Object.fromEntries(
    Object.entries(definition.env).map(([key, value]) => [
      key,
      interpolate(value, outputs, definition.env, namedByStep, params),
    ]),
  );
  const stepEnv = Object.fromEntries(
    Object.entries(step.env).map(([key, value]) => [
      key,
      interpolate(value, outputs, definition.env, namedByStep, params),
    ]),
  );
  const rawDir = step.workingDir ?? definition.workingDir;
  const resolvedDir = rawDir
    ? interpolate(rawDir, outputs, definition.env, namedByStep, params)
    : undefined;
  const cwd = resolveWorkflowDir(project.workspace_path, resolvedDir);
  const shell = shellFor(command);
  const outputFile = step.outputs.length > 0
    ? await Deno.makeTempFile({ prefix: `wf-${step.id}-`, suffix: ".out" })
    : null;
  const env = {
    ...Deno.env.toObject(),
    ...workflowEnv,
    ...stepEnv,
    ...params,
    ...(outputFile ? { DAGU_OUTPUT_FILE: outputFile } : {}),
  };

  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command(shell.command, {
      cwd,
      env,
      args: shell.args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
  } catch (error) {
    append(`[gagal menjalankan step: ${(error as Error).message}]\n`);
    await writer.flush();
    if (outputFile) await Deno.remove(outputFile).catch(() => {});
    return { code: -1, log: writer.get() };
  }

  active.processes.add(child);
  let timedOut = false;
  const timer = step.timeoutSec
    ? setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // already exited
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already exited
        }
      }, KILL_GRACE_MS);
    }, step.timeoutSec * 1000)
    : null;

  let outputText = "";
  const pump = async (stream: ReadableStream<Uint8Array>, capture: boolean) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          const text = decoder.decode(value, { stream: true });
          if (capture) outputText += text;
          append(text);
        }
      }
    } catch {
      // stream closed
    } finally {
      reader.releaseLock();
    }
  };

  const pumps = Promise.all([pump(child.stdout, true), pump(child.stderr, false)]);
  const status = await child.status;
  await pumps;
  await writer.flush();
  if (timer) clearTimeout(timer);
  active.processes.delete(child);
  if (timedOut) append(`\n[timeout setelah ${step.timeoutSec}s]\n`);

  let namedOutputs: Record<string, string> | undefined;
  if (outputFile) {
    try {
      const content = await Deno.readTextFile(outputFile);
      namedOutputs = parseOutputFile(content);
      if (Object.keys(namedOutputs).length > 0) {
        append(
          `\n[outputs] ${
            Object.entries(namedOutputs).map(([key, value]) => `${key}=${value}`).join(" ")
          }\n`,
        );
      }
    } catch {
      // no output file written
    } finally {
      await Deno.remove(outputFile).catch(() => {});
    }
  }

  return {
    code: timedOut ? 124 : status.code ?? -1,
    log: writer.get(),
    output: outputText,
    namedOutputs,
  };
}

function withTimeout<T>(promise: Promise<T>, seconds?: number): Promise<T> {
  if (!seconds) return promise;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`timeout setelah ${seconds}s`)), seconds * 1000);
    }),
  ]);
}

async function runLlmStep(
  runId: string,
  project: WorkflowProject,
  definition: WorkflowDefinition,
  step: WorkflowStep,
  logPrefix: string,
  stepRowId: string | undefined,
  outputs: Map<string, string>,
  namedByStep: Map<string, Record<string, string>>,
  params: Record<string, string>,
): Promise<StepResult> {
  const writer = createLogWriter(runId, step.id, logPrefix, stepRowId);
  const config = step.with ?? {};
  const ix = (value: string) => interpolate(value, outputs, definition.env, namedByStep, params);
  try {
    const sessionName = config.session ?? definition.llm?.session;
    const session = sessionName ? await getOrCreateWorkflowSession(project.id, sessionName) : null;
    const history = session ? (await listWorkflowSessionMessages(session.id)).slice(-50) : [];

    const providers = await listLlmProviders();
    const roles = await listRoles();
    const roleKey = config.role ?? definition.llm?.role;
    const role = roleKey
      ? roles.find(
        (item) => item.id === roleKey || item.name.toLowerCase() === roleKey.toLowerCase(),
      )
      : undefined;
    if (roleKey && !role) throw new Error(`Role "${roleKey}" tidak ditemukan.`);

    const selection = resolveWorkflowLlmSelection(definition, config, params, ix);
    const providerKey = selection.providerKey;
    const matchProvider = (key: string) =>
      providers.find(
        (provider) => provider.id === key || provider.name.toLowerCase() === key.toLowerCase(),
      );
    let provider = providerKey ? matchProvider(providerKey) : undefined;
    if (providerKey && !provider) {
      throw new Error(`Provider LLM "${providerKey}" tidak ditemukan.`);
    }
    if (!provider && role?.provider_id) {
      provider = providers.find((item) => item.id === role.provider_id);
    }
    provider ??= providers[0];
    if (!provider) throw new Error("Belum ada provider LLM global.");

    const model = selection.model;
    const effective = model ? { ...provider, model } : provider;
    const system = config.system ?? definition.llm?.system ?? role?.persona?.trim() ?? "";
    const attachments = collectAgentParamAttachments(definition, config, params);
    const turns: ChatTurn[] = [];
    const hasSystem = config.messages?.some((message) => message.role === "system") ?? false;
    if (system && !hasSystem) {
      turns.push({ role: "system", content: ix(system) });
    }
    for (const message of history) {
      if (message.role === "user" || message.role === "assistant") {
        turns.push({ role: message.role, content: message.content });
      }
    }
    if (config.messages?.length) {
      for (const message of config.messages) {
        turns.push({
          role: message.role,
          content: ix(message.content),
          ...(message.role === "user" && attachments.length ? { attachments } : {}),
        });
      }
    } else {
      turns.push({
        role: "user",
        content: ix(config.prompt ?? ""),
        ...(attachments.length ? { attachments } : {}),
      });
    }

    const temperature = config.temperature ?? definition.llm?.temperature;
    const userContent = config.prompt ? ix(config.prompt) : (config.messages ?? [])
      .filter((message) => message.role === "user")
      .map((message) => ix(message.content))
      .join("\n\n");
    writer.append(
      `[llm] ${effective.name} · ${effective.model ?? "-"}` +
        `${sessionName ? ` · session=${sessionName}` : ""}\n`,
    );
    const response = await withTimeout(
      complete(effective, turns, [], temperature, config.maxTokens),
      step.timeoutSec,
    );
    const text = response.text ?? "";
    writer.append(text.endsWith("\n") || text.length === 0 ? text : `${text}\n`);
    if (session) {
      if (userContent) await appendWorkflowSessionMessage(session.id, "user", userContent);
      if (text) await appendWorkflowSessionMessage(session.id, "assistant", text);
    }
    await writer.flush();
    return { code: 0, log: writer.get(), output: text };
  } catch (error) {
    writer.append(`[llm error] ${(error as Error).message}\n`);
    await writer.flush();
    return { code: -1, log: writer.get() };
  }
}

async function runAgentStep(
  runId: string,
  active: ActiveRun,
  project: WorkflowProject,
  definition: WorkflowDefinition,
  step: WorkflowStep,
  logPrefix: string,
  stepRowId: string | undefined,
  outputs: Map<string, string>,
  namedByStep: Map<string, Record<string, string>>,
  params: Record<string, string>,
): Promise<StepResult> {
  const writer = createLogWriter(runId, step.id, logPrefix, stepRowId);
  const config = step.with ?? {};
  const ix = (value: string) => interpolate(value, outputs, definition.env, namedByStep, params);
  try {
    const sessionName = config.session ?? definition.llm?.session;
    const session = sessionName ? await getOrCreateWorkflowSession(project.id, sessionName) : null;
    const history = session ? (await listWorkflowSessionMessages(session.id)).slice(-50) : [];

    const providers = await listLlmProviders();
    const roles = await listRoles();
    const roleKey = config.role ?? definition.llm?.role;
    const role = roleKey
      ? roles.find(
        (item) => item.id === roleKey || item.name.toLowerCase() === roleKey.toLowerCase(),
      )
      : undefined;
    if (roleKey && !role) throw new Error(`Role "${roleKey}" tidak ditemukan.`);

    const selection = resolveWorkflowLlmSelection(definition, config, params, ix);
    const providerKey = selection.providerKey;
    const matchProvider = (key: string) =>
      providers.find(
        (provider) => provider.id === key || provider.name.toLowerCase() === key.toLowerCase(),
      );
    let provider = providerKey ? matchProvider(providerKey) : undefined;
    if (providerKey && !provider) {
      throw new Error(`Provider LLM "${providerKey}" tidak ditemukan.`);
    }
    if (!provider && role?.provider_id) {
      provider = providers.find((item) => item.id === role.provider_id);
    }
    provider ??= providers[0];
    if (!provider) throw new Error("Belum ada provider LLM global.");

    const model = selection.model;
    const effective = model ? { ...provider, model } : provider;
    const attachments = collectAgentParamAttachments(definition, config, params);

    const turns: ChatTurn[] = [];
    for (const message of history) {
      if (message.role === "user" || message.role === "assistant") {
        turns.push({ role: message.role, content: message.content });
      }
    }
    if (config.messages?.length) {
      for (const message of config.messages) {
        if (message.role === "system") continue;
        turns.push({
          role: message.role,
          content: ix(message.content),
          ...(message.role === "user" && attachments.length ? { attachments } : {}),
        });
      }
    } else {
      turns.push({
        role: "user",
        content: ix(config.prompt ?? ""),
        ...(attachments.length ? { attachments } : {}),
      });
    }

    const userContent = config.prompt ? ix(config.prompt) : (config.messages ?? [])
      .filter((message) => message.role === "user")
      .map((message) => ix(message.content))
      .join("\n\n");

    const mode = config.mode ?? "build";
    const systemRaw = config.system ?? definition.llm?.system;
    const system = systemRaw ? ix(systemRaw) : undefined;
    const temperature = config.temperature ?? definition.llm?.temperature;

    writer.append(
      `[agent] ${effective.name} · ${effective.model ?? "-"} · mode=${mode}` +
        `${sessionName ? ` · session=${sessionName}` : ""}` +
        `${config.skill ? ` · skill=${config.skill}` : ""}\n`,
    );

    const result = await withTimeout(
      runHeadlessAgent({
        provider: effective,
        projectId: project.id,
        projectName: project.name,
        workspace: project.workspace_path,
        mode,
        skillName: config.skill,
        variant: config.variant,
        temperature,
        maxTokens: config.maxTokens,
        maxSteps: config.maxSteps,
        system,
        persona: role?.persona?.trim() || undefined,
        turns,
        isCanceled: () => active.canceled,
      }),
      step.timeoutSec,
    );

    for (const entry of result.toolLog) {
      writer.append(`[tool] ${entry.summary}\n`);
    }
    if (result.filesTouched.length) {
      writer.append(`[files] ${result.filesTouched.join(", ")}\n`);
    }
    if (result.createdTickets.length) {
      writer.append(
        `[tickets] ${
          result.createdTickets.map((ticket) => `${ticket.key}: ${ticket.title}`).join("; ")
        }\n`,
      );
    }

    const text = result.message ?? "";
    writer.append(text.endsWith("\n") || text.length === 0 ? text : `${text}\n`);
    if (result.canceled) {
      writer.append("[agent dibatalkan]\n");
      await writer.flush();
      return { code: -1, log: writer.get(), output: text };
    }
    if (session) {
      if (userContent) await appendWorkflowSessionMessage(session.id, "user", userContent);
      if (text) await appendWorkflowSessionMessage(session.id, "assistant", text);
    }
    await writer.flush();
    return { code: 0, log: writer.get(), output: text };
  } catch (error) {
    writer.append(`[agent error] ${(error as Error).message}\n`);
    await writer.flush();
    return { code: -1, log: writer.get() };
  }
}
