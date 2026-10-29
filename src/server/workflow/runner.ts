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
}): Promise<string> {
  const existing = await findActiveWorkflowRun(input.projectId, input.slug);
  if (existing) throw new Error("Workflow sedang berjalan. Tunggu atau batalkan run aktif.");

  const run = await createWorkflowRun({
    projectId: input.projectId,
    slug: input.slug,
    name: input.definition.name,
    path: input.workflowPath,
    yaml: input.yaml,
  });

  const stepIds = new Map<string, string>();
  for (const step of input.definition.steps) {
    const prompt = step.with?.prompt ?? step.with?.messages?.[0]?.content ?? step.action ?? "";
    const command = step.run ??
      (step.kind === "agent" ? `[agent] ${prompt}` : `[llm] ${prompt || "chat.completion"}`);
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
  });
  void execute(run.id, active, input.project, input.definition).catch(async (error) => {
    activeRuns.delete(run.id);
    await updateWorkflowRun(run.id, "failed", (error as Error).message);
    await record("workflow.run.failed", {
      projectId: input.projectId,
      slug: input.slug,
      runId: run.id,
      error: (error as Error).message,
    });
  });
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
  const shell = Deno.env.get("SHELL") || "/bin/sh";
  return { command: shell, args: ["-lc", command] };
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

async function execute(
  runId: string,
  active: ActiveRun,
  project: WorkflowProject,
  definition: WorkflowDefinition,
): Promise<void> {
  const statuses = new Map<string, string>();
  const logs = new Map<string, string>();
  const outputs = new Map<string, string>();
  let failedWithoutContinue = false;

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

  for (const layer of definition.layers) {
    if (active.canceled) break;
    const tasks = layer.map(async (stepId) => {
      const step = definition.steps.find((item) => item.id === stepId)!;
      const dependencyStatuses = step.depends.map((dependency) =>
        statuses.get(dependency) ?? "pending"
      );
      const blocked = step.depends.some((dependency, index) => {
        const depStep = definition.steps.find((item) => item.id === dependency)!;
        return !stepSatisfied(depStep, dependencyStatuses[index]);
      });
      const log = logs.get(step.id) ?? "";
      if (blocked) {
        await setStatus(step, "skipped", null, `${log}[skipped: dependency tidak sukses]\n`);
        return;
      }
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

      let result: { code: number; log: string; output?: string } = { code: -1, log };
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
          definition,
          step,
          result.log,
          rowId,
          outputs,
        );
        if (result.code === 0 || active.canceled) break;
      }

      logs.set(step.id, result.log);
      if (active.canceled) {
        await setStatus(step, "canceled", result.code, result.log);
      } else if (result.code === 0) {
        const value = result.output ?? result.log;
        outputs.set(step.id, value);
        if (step.output) outputs.set(step.output, value);
        await setStatus(step, "success", 0, result.log);
      } else {
        await setStatus(step, "failed", result.code, result.log);
      }
    });

    for (let index = 0; index < tasks.length; index += MAX_PARALLEL) {
      await Promise.all(tasks.slice(index, index + MAX_PARALLEL));
      if (active.canceled) break;
    }
  }

  if (active.canceled) {
    for (const step of definition.steps) {
      if (!statuses.has(step.id)) {
        await setStatus(step, "canceled", null, logs.get(step.id) ?? "");
      }
    }
  }

  activeRuns.delete(runId);
  const status = active.canceled ? "canceled" : failedWithoutContinue ? "failed" : "success";
  const error = status === "failed" ? "Satu atau lebih step gagal." : undefined;
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
): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, rawKey: string) => {
    const key = rawKey.trim();
    const stepMatch = /^steps\.([^.]+)\.(?:output|outputs)(?:\.(.+))?$/.exec(key);
    if (stepMatch) {
      const value = outputs.get(stepMatch[1]);
      return value === undefined ? match : value;
    }
    if (key.startsWith("env.")) {
      const name = key.slice(4);
      return env[name] ?? match;
    }
    return outputs.get(key) ?? match;
  });
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
): Promise<{ code: number; log: string; output?: string }> {
  if (step.kind === "llm") {
    return await runLlmStep(runId, project, definition, step, logPrefix, stepRowId, outputs);
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
  );
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
): Promise<{ code: number; log: string; output?: string }> {
  const writer = createLogWriter(runId, step.id, logPrefix, stepRowId);
  const append = writer.append;
  const command = interpolate(step.run ?? "", outputs, definition.env);
  const workflowEnv = Object.fromEntries(
    Object.entries(definition.env).map(([key, value]) => [
      key,
      interpolate(value, outputs, definition.env),
    ]),
  );
  const stepEnv = Object.fromEntries(
    Object.entries(step.env).map(([key, value]) => [
      key,
      interpolate(value, outputs, definition.env),
    ]),
  );
  const cwd = resolveWorkflowDir(project.workspace_path, step.workingDir ?? definition.workingDir);
  const shell = shellFor(command);
  const env = {
    ...Deno.env.toObject(),
    ...workflowEnv,
    ...stepEnv,
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
  return {
    code: timedOut ? 124 : status.code ?? -1,
    log: writer.get(),
    output: outputText,
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
): Promise<{ code: number; log: string; output?: string }> {
  const writer = createLogWriter(runId, step.id, logPrefix, stepRowId);
  const config = step.with ?? {};
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

    const providerKey = config.provider ?? definition.llm?.provider;
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

    const model = config.model ?? definition.llm?.model;
    const effective = model ? { ...provider, model } : provider;
    const system = config.system ?? definition.llm?.system ?? role?.persona?.trim() ?? "";
    const turns: ChatTurn[] = [];
    const hasSystem = config.messages?.some((message) => message.role === "system") ?? false;
    if (system && !hasSystem) {
      turns.push({ role: "system", content: interpolate(system, outputs, definition.env) });
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
          content: interpolate(message.content, outputs, definition.env),
        });
      }
    } else {
      turns.push({
        role: "user",
        content: interpolate(config.prompt ?? "", outputs, definition.env),
      });
    }

    const temperature = config.temperature ?? definition.llm?.temperature;
    const userContent = config.prompt
      ? interpolate(config.prompt, outputs, definition.env)
      : (config.messages ?? [])
        .filter((message) => message.role === "user")
        .map((message) => interpolate(message.content, outputs, definition.env))
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
): Promise<{ code: number; log: string; output?: string }> {
  const writer = createLogWriter(runId, step.id, logPrefix, stepRowId);
  const config = step.with ?? {};
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

    const providerKey = config.provider ?? definition.llm?.provider;
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

    const model = config.model ?? definition.llm?.model;
    const effective = model ? { ...provider, model } : provider;

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
          content: interpolate(message.content, outputs, definition.env),
        });
      }
    } else {
      turns.push({
        role: "user",
        content: interpolate(config.prompt ?? "", outputs, definition.env),
      });
    }

    const userContent = config.prompt
      ? interpolate(config.prompt, outputs, definition.env)
      : (config.messages ?? [])
        .filter((message) => message.role === "user")
        .map((message) => interpolate(message.content, outputs, definition.env))
        .join("\n\n");

    const mode = config.mode ?? "build";
    const systemRaw = config.system ?? definition.llm?.system;
    const system = systemRaw ? interpolate(systemRaw, outputs, definition.env) : undefined;
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
