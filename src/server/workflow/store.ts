import { join, resolve } from "node:path";
import { appDataDir } from "../../core/paths.ts";
import { resolveWithin } from "../../fs/workspace.ts";
import { projectSlug } from "../skills.ts";
import { parseWorkflow, slugName, workflowTemplate } from "./parse.ts";
import { WorkflowError, type WorkflowSummary } from "./types.ts";

export interface WorkflowProject {
  id: string;
  name: string;
  workspace_path: string | null;
}

const SLUG_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export function workflowRoot(project: WorkflowProject): {
  root: string;
  source: "workspace" | "app";
} {
  const workspace = project.workspace_path?.trim();
  if (workspace) {
    return { root: join(workspace, ".workflows"), source: "workspace" };
  }
  return {
    root: join(appDataDir(), projectSlug(project.name, project.id), "workflows"),
    source: "app",
  };
}

function safeSlug(slug: string): string {
  const value = slug.trim();
  if (!value || !SLUG_PATTERN.test(value) || value.startsWith(".")) {
    throw new WorkflowError("Nama workflow tidak valid.");
  }
  return value;
}

function fileFor(root: string, slug: string): string {
  const clean = safeSlug(slug);
  const file = resolve(root, `${clean}.yaml`);
  if (!file.startsWith(`${resolve(root)}/`)) {
    throw new WorkflowError("Path workflow tidak valid.");
  }
  return file;
}

async function ensureRoot(root: string): Promise<void> {
  await Deno.mkdir(root, { recursive: true });
}

export async function listWorkflows(project: WorkflowProject): Promise<WorkflowSummary[]> {
  const { root, source } = workflowRoot(project);
  const summaries: WorkflowSummary[] = [];
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const entry of Deno.readDir(root)) entries.push(entry);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isFile) continue;
    if (!/\.(ya?ml)$/i.test(entry.name)) continue;
    const slug = entry.name.replace(/\.(ya?ml)$/i, "");
    if (!SLUG_PATTERN.test(slug) || slug.startsWith(".")) continue;
    const file = join(root, entry.name);
    let yaml = "";
    let updatedAt: string | undefined;
    try {
      yaml = await Deno.readTextFile(file);
      const stat = await Deno.stat(file);
      updatedAt = stat.mtime?.toISOString();
    } catch {
      continue;
    }
    try {
      const definition = parseWorkflow(yaml, slug);
      summaries.push({
        slug,
        name: definition.name,
        description: definition.description,
        path: file,
        source,
        updatedAt,
        stepCount: definition.steps.length,
      });
    } catch (error) {
      summaries.push({
        slug,
        name: slug,
        path: file,
        source,
        updatedAt,
        stepCount: 0,
        error: (error as Error).message,
      });
    }
  }

  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readWorkflow(
  project: WorkflowProject,
  slug: string,
): Promise<{ yaml: string; path: string }> {
  const { root } = workflowRoot(project);
  const file = fileFor(root, slug);
  try {
    return { yaml: await Deno.readTextFile(file), path: file };
  } catch {
    throw new WorkflowError("Workflow tidak ditemukan.");
  }
}

export async function createWorkflow(
  project: WorkflowProject,
  slug: string,
  yaml?: string,
): Promise<WorkflowSummary> {
  const clean = safeSlug(slug);
  const { root, source } = workflowRoot(project);
  await ensureRoot(root);
  const file = fileFor(root, clean);
  const content = yaml?.trim() ? yaml : workflowTemplate(clean);
  parseWorkflow(content, clean);
  try {
    await Deno.writeTextFile(file, content, { createNew: true });
  } catch {
    throw new WorkflowError(`Workflow "${clean}" sudah ada.`);
  }
  const definition = parseWorkflow(content, clean);
  return {
    slug: clean,
    name: definition.name,
    description: definition.description,
    path: file,
    source,
    stepCount: definition.steps.length,
  };
}

export async function saveWorkflow(
  project: WorkflowProject,
  slug: string,
  yaml: string,
): Promise<WorkflowSummary> {
  const clean = safeSlug(slug);
  const { root, source } = workflowRoot(project);
  const file = fileFor(root, clean);
  const stat = await Deno.stat(file).catch(() => null);
  if (!stat?.isFile) throw new WorkflowError("Workflow tidak ditemukan.");
  const definition = parseWorkflow(yaml, clean);
  await Deno.writeTextFile(file, yaml);
  return {
    slug: clean,
    name: definition.name,
    description: definition.description,
    path: file,
    source,
    stepCount: definition.steps.length,
  };
}

export async function deleteWorkflow(project: WorkflowProject, slug: string): Promise<void> {
  const { root } = workflowRoot(project);
  const file = fileFor(root, slug);
  const stat = await Deno.stat(file).catch(() => null);
  if (!stat?.isFile) throw new WorkflowError("Workflow tidak ditemukan.");
  await Deno.remove(file);
}

export function workflowSlug(name: string): string {
  return slugName(name);
}

export function resolveWorkflowDir(workspace: string | null, rel?: string): string {
  if (!workspace) return resolve(Deno.cwd(), rel ?? ".");
  const target = resolveWithin(workspace, rel ?? "");
  if (!target) {
    throw new WorkflowError("working_dir harus berada di dalam workspace.");
  }
  return target;
}
