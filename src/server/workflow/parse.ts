import { parse as parseYaml } from "@std/yaml";
import { z } from "zod";
import { type WorkflowDefinition, WorkflowError, type WorkflowStep } from "./types.ts";

const envSchema = z
  .record(
    z.string().min(1).max(120),
    z.union([z.string(), z.number(), z.boolean()]),
  )
  .optional();

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

const llmWithSchema = z
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
    with: llmWithSchema,
    output: z
      .string()
      .trim()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Nama output tidak valid.")
      .max(60)
      .optional(),
  })
  .strict()
  .superRefine((step, ctx) => {
    const isAi = step.action === "chat.completion" || step.action === "agent";
    if (!step.run && !isAi) {
      ctx.addIssue({ code: "custom", message: "Step shell wajib punya `run`." });
    }
    if (step.action && !isAi) {
      ctx.addIssue({
        code: "custom",
        message: `Action "${step.action}" belum didukung (hanya chat.completion / agent).`,
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
  });

const docSchema = z
  .object({
    name: z.string().trim().regex(/^[a-zA-Z0-9_.-]+$/, "Nama workflow tidak valid.").max(60)
      .optional(),
    description: z.string().max(500).optional(),
    env: envSchema,
    working_dir: z.string().max(500).optional(),
    defaults: defaultsSchema,
    llm: llmBlockSchema,
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
      : "shell";
    return {
      id,
      kind,
      run: step.run,
      action: step.action,
      with: step.with
        ? {
          prompt: step.with.prompt,
          messages: step.with.messages,
          system: step.with.system,
          provider: step.with.provider,
          role: step.with.role,
          session: step.with.session,
          model: step.with.model,
          temperature: step.with.temperature,
          maxTokens: step.with.max_tokens,
          mode: step.with.mode,
          skill: step.with.skill ?? step.with.skill_name,
          variant: step.with.variant,
          maxSteps: step.with.max_steps,
        }
        : undefined,
      output: step.output,
      depends: [...new Set(dependsList(step.depends))],
      env: { ...stringEnv(doc.env), ...stringEnv(doc.defaults?.env), ...stringEnv(step.env) },
      workingDir: step.working_dir ?? doc.defaults?.working_dir ?? doc.working_dir,
      retry: {
        limit: retry?.limit ?? 0,
        intervalSec: retry?.interval_sec ?? 0,
      },
      timeoutSec: step.timeout_sec ?? doc.defaults?.timeout_sec,
      continueOn: continueOnValue(step.continue_on),
    };
  });

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
  }

  return {
    name: doc.name ?? slugName(fallbackName),
    description: doc.description,
    env: { ...stringEnv(doc.env), ...stringEnv(doc.defaults?.env) },
    workingDir: doc.working_dir,
    llm: doc.llm,
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
