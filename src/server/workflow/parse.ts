import { parse as parseYaml } from "@std/yaml";
import { z } from "zod";
import { CronError, isValidTimezone, parseCron } from "./cron.ts";
import {
  type WorkflowDefinition,
  type WorkflowEventTrigger,
  WorkflowError,
  type WorkflowParam,
  type WorkflowSchedule,
  type WorkflowStep,
} from "./types.ts";

const envValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const envSchema = z.preprocess((value) => {
  if (!Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const item of value) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      Object.assign(out, item);
    }
  }
  return out;
}, z.record(z.string().min(1).max(120), envValueSchema).optional());

const retrySchema = z
  .object({
    limit: z.number().int().min(0).max(20).default(0),
    interval_sec: z.number().min(0).max(3600).default(0),
  })
  .optional();

const llmMessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string().min(1).max(100_000),
  })
  .strict();

const stepWithSchema = z
  .object({
    prompt: z.string().min(1).max(100_000).optional(),
    messages: z.array(llmMessageSchema).min(1).max(50).optional(),
    system: z.string().max(20_000).optional(),
    provider: z.string().trim().max(120).optional(),
    role: z.string().trim().max(120).optional(),
    session: z.string().trim().min(1).max(80).optional(),
    model: z.string().trim().max(200).optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().max(100_000).optional(),
    mode: z.enum(["plan", "build"]).optional(),
    skill: z.string().trim().min(1).max(80).optional(),
    skill_name: z.string().trim().min(1).max(80).optional(),
    variant: z.enum(["short", "medium", "long"]).optional(),
    max_steps: z.number().int().min(1).max(12).optional(),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    routes: z
      .record(
        z.string().min(1).max(60),
        z.union([z.string().max(60), z.array(z.string().max(60)).max(50)]),
      )
      .optional(),
    max_loops: z.number().int().min(1).max(100).optional(),
    channel: z.string().trim().min(1).max(120).optional(),
    message: z.string().min(1).max(20_000).optional(),
    text: z.string().min(1).max(20_000).optional(),
  })
  .strict()
  .optional();

const llmBlockSchema = z
  .object({
    provider: z.string().trim().max(120).optional(),
    model: z.string().trim().max(200).optional(),
    role: z.string().trim().max(120).optional(),
    session: z.string().trim().min(1).max(80).optional(),
    system: z.string().max(20_000).optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .strict()
  .optional();

const defaultsSchema = z
  .object({
    env: envSchema,
    working_dir: z.string().max(500).optional(),
    retry_policy: retrySchema,
    timeout_sec: z.number().positive().max(86_400).optional(),
  })
  .strict()
  .optional();

const outputNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Nama output tidak valid.")
  .max(60);

const outputsSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && "name" in item) {
      return (item as { name: unknown }).name;
    }
    return item;
  });
}, z.array(outputNameSchema).max(20).optional());

const paramSchema = z
  .object({
    name: z
      .string()
      .trim()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Nama param tidak valid.")
      .max(120),
    type: z.enum(["string", "integer", "number", "boolean", "agent"]).optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    description: z.string().max(500).optional(),
  })
  .strict();

const stepSchema = z
  .object({
    id: z.string().trim().max(60).optional(),
    run: z.string().min(1).max(100_000).optional(),
    depends: z.union([z.string().max(60), z.array(z.string().max(60)).max(50)]).optional(),
    env: envSchema,
    working_dir: z.string().max(500).optional(),
    retry_policy: retrySchema,
    timeout_sec: z.number().positive().max(86_400).optional(),
    continue_on: z.union([z.string().max(60), z.array(z.string().max(60)).max(10)]).optional(),
    action: z.string().trim().max(60).optional(),
    with: stepWithSchema,
    output: outputNameSchema.optional(),
    outputs: outputsSchema,
    next: z.union([z.string().max(60), z.array(z.string().max(60)).max(20)]).optional(),
  })
  .strict()
  .superRefine((step, ctx) => {
    const isAi = step.action === "chat.completion" || step.action === "agent";
    const isRouter = step.action === "router.route";
    const isNotify = step.action === "notification";
    if (!step.run && !isAi && !isRouter && !isNotify) {
      ctx.addIssue({ code: "custom", message: "Step shell wajib punya `run`." });
    }
    if (step.action && !isAi && !isRouter && !isNotify) {
      ctx.addIssue({
        code: "custom",
        message:
          `Action "${step.action}" belum didukung (hanya chat.completion / agent / router.route / notification).`,
      });
    }
    if (isAi) {
      if (step.run) {
        ctx.addIssue({ code: "custom", message: "Step AI tidak boleh memakai `run`." });
      }
      if (!step.with?.prompt && !step.with?.messages) {
        ctx.addIssue({
          code: "custom",
          message: "Step AI butuh `with.prompt` atau `with.messages`.",
        });
      }
    }
    if (isRouter) {
      if (step.run) {
        ctx.addIssue({ code: "custom", message: "Step router tidak boleh memakai `run`." });
      }
      if (step.with?.value === undefined || step.with?.value === null) {
        ctx.addIssue({ code: "custom", message: "Step router butuh `with.value`." });
      }
      if (!step.with?.routes || Object.keys(step.with.routes).length === 0) {
        ctx.addIssue({ code: "custom", message: "Step router butuh `with.routes`." });
      }
    }
    if (isNotify) {
      if (step.run) {
        ctx.addIssue({ code: "custom", message: "Step notification tidak boleh memakai `run`." });
      }
      if (!step.with?.channel?.trim()) {
        ctx.addIssue({
          code: "custom",
          message: "Step notification butuh `with.channel` (nama/id channel global).",
        });
      }
      if (!step.with?.message?.trim() && !step.with?.text?.trim() && !step.with?.prompt?.trim()) {
        ctx.addIssue({
          code: "custom",
          message: "Step notification butuh `with.message` (atau `text` / `prompt`).",
        });
      }
    }
  });

const scheduleSchema = z
  .object({
    cron: z.string().trim().min(1).max(120),
    enabled: z.boolean().optional(),
    timezone: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .optional();

const onEventObjectSchema = z
  .object({
    event: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_.-]*$/i, "Nama event tidak valid.")
      .max(80),
    status: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

const onSchema = z
  .preprocess((value) => {
    if (value === undefined || value === null) return undefined;
    const list = Array.isArray(value) ? value : [value];
    return list.map((item) => {
      if (typeof item === "string") return { event: item };
      return item;
    });
  }, z.array(onEventObjectSchema).max(20).optional());

const docSchema = z
  .object({
    name: z.string().trim().regex(/^[a-zA-Z0-9_.-]+$/, "Nama workflow tidak valid.").max(60)
      .optional(),
    description: z.string().max(500).optional(),
    type: z.string().trim().max(40).optional(),
    params: z.array(paramSchema).max(50).optional(),
    env: envSchema,
    working_dir: z.string().max(500).optional(),
    timeout_sec: z.number().positive().max(86_400).optional(),
    defaults: defaultsSchema,
    llm: llmBlockSchema,
    schedule: scheduleSchema,
    on: onSchema,
    steps: z.array(stepSchema).min(1).max(100),
  })
  .strict();

function stringEnv(
  value: Record<string, string | number | boolean> | undefined,
): Record<string, string> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
}

function dependsList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function continueOnValue(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value.join(",") : value;
}

function routeList(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

export function slugName(value: string): string {
  const clean = value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (!clean) throw new WorkflowError("Nama workflow tidak valid.");
  return clean;
}

function topoLayers(steps: WorkflowStep[]): string[][] {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const step of steps) {
    indegree.set(step.id, step.depends.length);
    for (const dependency of step.depends) {
      const list = dependents.get(dependency) ?? [];
      list.push(step.id);
      dependents.set(dependency, list);
    }
  }

  const layers: string[][] = [];
  let ready = steps.filter((step) => (indegree.get(step.id) ?? 0) === 0).map((step) => step.id);
  let processed = 0;
  while (ready.length > 0) {
    layers.push(ready);
    processed += ready.length;
    const next: string[] = [];
    for (const id of ready) {
      for (const dependent of dependents.get(id) ?? []) {
        const remaining = (indegree.get(dependent) ?? 0) - 1;
        indegree.set(dependent, remaining);
        if (remaining === 0) next.push(dependent);
      }
    }
    ready = next;
  }
  if (processed !== steps.length) {
    throw new WorkflowError("Workflow memiliki dependency melingkar (cycle).");
  }
  return layers;
}

/** True if `ancestorId` is reachable by walking `depends` backward from `fromId`. */
function isDependsAncestor(
  steps: WorkflowStep[],
  ancestorId: string,
  fromId: string,
): boolean {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const seen = new Set<string>();
  const stack = [...(byId.get(fromId)?.depends ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === ancestorId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dependency of byId.get(id)?.depends ?? []) stack.push(dependency);
  }
  return false;
}

function paramDefaults(params: WorkflowParam[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const param of params) {
    if (param.default !== undefined) out[param.name] = param.default;
  }
  return out;
}

export function parseWorkflow(yaml: string, fallbackName: string): WorkflowDefinition {
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch (error) {
    throw new WorkflowError(`YAML tidak valid: ${(error as Error).message}`);
  }

  const parsed = docSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WorkflowError(
      "Workflow tidak valid.",
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
    );
  }

  const doc = parsed.data;
  const params: WorkflowParam[] = (doc.params ?? []).map((param) => ({
    name: param.name,
    type: param.type,
    default: param.default === undefined ? undefined : String(param.default),
    description: param.description,
  }));
  const paramEnv = paramDefaults(params);
  const defaultTimeout = doc.defaults?.timeout_sec ?? doc.timeout_sec;

  const ids = new Set<string>();
  const steps: WorkflowStep[] = doc.steps.map((step, index) => {
    const id = slugName(step.id || `cmd_${index + 1}`);
    if (ids.has(id)) throw new WorkflowError(`Step id duplikat: ${id}`);
    ids.add(id);
    const retry = step.retry_policy ?? doc.defaults?.retry_policy;
    const kind = step.action === "agent"
      ? "agent"
      : step.action === "chat.completion"
      ? "llm"
      : step.action === "router.route"
      ? "router"
      : step.action === "notification"
      ? "notify"
      : "shell";
    const namedOutputs = [
      ...new Set([
        ...(step.output ? [step.output] : []),
        ...(step.outputs ?? []),
      ]),
    ];
    const routes = step.with?.routes
      ? Object.fromEntries(
        Object.entries(step.with.routes).map(([key, value]) => [key, routeList(value)]),
      )
      : undefined;
    const notifyMessage = step.with?.message ?? step.with?.text ?? step.with?.prompt;
    return {
      id,
      kind,
      run: step.run,
      action: step.action,
      with: kind === "llm" || kind === "agent"
        ? {
          prompt: step.with?.prompt,
          messages: step.with?.messages,
          system: step.with?.system,
          provider: step.with?.provider,
          role: step.with?.role,
          session: step.with?.session,
          model: step.with?.model,
          temperature: step.with?.temperature,
          maxTokens: step.with?.max_tokens,
          mode: step.with?.mode,
          skill: step.with?.skill ?? step.with?.skill_name,
          variant: step.with?.variant,
          maxSteps: step.with?.max_steps,
        }
        : undefined,
      router: kind === "router" && step.with?.value !== undefined && routes
        ? {
          value: String(step.with.value),
          routes,
          loopBacks: [],
          maxLoops: step.with?.max_loops ?? 10,
        }
        : undefined,
      notify: kind === "notify" && step.with?.channel && notifyMessage
        ? {
          channel: step.with.channel.trim(),
          message: notifyMessage,
        }
        : undefined,
      output: namedOutputs[0],
      outputs: namedOutputs,
      depends: [...new Set(dependsList(step.depends))],
      next: [...new Set(dependsList(step.next).map((item) => slugName(item)))],
      env: {
        ...paramEnv,
        ...stringEnv(doc.env),
        ...stringEnv(doc.defaults?.env),
        ...stringEnv(step.env),
      },
      workingDir: step.working_dir ?? doc.defaults?.working_dir ?? doc.working_dir,
      retry: {
        limit: retry?.limit ?? 0,
        intervalSec: retry?.interval_sec ?? 0,
      },
      timeoutSec: step.timeout_sec ?? defaultTimeout,
      continueOn: continueOnValue(step.continue_on),
    };
  });

  for (const step of steps) {
    if (step.kind !== "router" || !step.router) continue;
    const loopBacks: string[] = [];
    for (const targets of Object.values(step.router.routes)) {
      for (const targetId of targets) {
        const cleanTarget = slugName(targetId);
        const target = steps.find((item) => item.id === cleanTarget);
        if (!target) {
          throw new WorkflowError(
            `Router "${step.id}" merujuk step yang tidak ada: ${targetId}`,
          );
        }
        if (cleanTarget === step.id) {
          throw new WorkflowError(`Router "${step.id}" tidak boleh merujuk dirinya sendiri.`);
        }
        if (isDependsAncestor(steps, cleanTarget, step.id)) {
          loopBacks.push(cleanTarget);
          continue;
        }
        if (!target.depends.includes(step.id)) target.depends.push(step.id);
        target.routeGate = { routerId: step.id };
      }
    }
    step.router.loopBacks = [...new Set(loopBacks)];
  }

  for (const step of steps) {
    for (const dependency of step.depends) {
      if (!ids.has(dependency)) {
        throw new WorkflowError(
          `Step "${step.id}" bergantung pada step yang tidak ada: ${dependency}`,
        );
      }
      if (dependency === step.id) {
        throw new WorkflowError(`Step "${step.id}" tidak boleh bergantung pada dirinya sendiri.`);
      }
    }
    for (const nextId of step.next) {
      if (!ids.has(nextId)) {
        throw new WorkflowError(
          `Step "${step.id}" next merujuk step yang tidak ada: ${nextId}`,
        );
      }
      if (nextId === step.id) {
        throw new WorkflowError(`Step "${step.id}" next tidak boleh merujuk dirinya sendiri.`);
      }
    }
  }

  let schedule: WorkflowSchedule | undefined;
  if (doc.schedule) {
    try {
      parseCron(doc.schedule.cron);
    } catch (error) {
      throw new WorkflowError(
        error instanceof CronError ? error.message : `Cron tidak valid: ${doc.schedule.cron}`,
      );
    }
    if (doc.schedule.timezone && !isValidTimezone(doc.schedule.timezone)) {
      throw new WorkflowError(`Timezone tidak valid: ${doc.schedule.timezone}`);
    }
    schedule = {
      cron: doc.schedule.cron.trim(),
      enabled: doc.schedule.enabled ?? true,
      timezone: doc.schedule.timezone?.trim() || undefined,
    };
  }

  const on: WorkflowEventTrigger[] = (doc.on ?? []).map((item) => ({
    event: item.event.trim(),
    status: item.status?.trim() || undefined,
  }));

  return {
    name: doc.name ?? slugName(fallbackName),
    description: doc.description,
    type: doc.type,
    params,
    env: { ...paramEnv, ...stringEnv(doc.env), ...stringEnv(doc.defaults?.env) },
    workingDir: doc.working_dir,
    timeoutSec: doc.timeout_sec,
    llm: doc.llm,
    schedule,
    on,
    steps,
    layers: topoLayers(steps),
  };
}

export function workflowTemplate(name: string): string {
  return `name: ${slugName(name)}
description: ""
steps:
  - id: hello
    run: echo "Hello from ${name}"
`;
}
