import { WorkflowCreateInput, WorkflowSaveInput } from "../../config/schema.ts";
import {
  getProject,
  getWorkflowRun,
  listWorkflowRuns,
  listWorkflowRunSteps,
  type WorkflowRunRow,
  type WorkflowRunStepRow,
} from "../../db/db.ts";
import { json, readJson, record } from "../http.ts";
import { parseWorkflow } from "../workflow/parse.ts";
import { cancelWorkflowRun, startWorkflowRun } from "../workflow/runner.ts";
import {
  createWorkflow,
  deleteWorkflow,
  listWorkflows,
  readWorkflow,
  saveWorkflow,
  type WorkflowProject,
  workflowRoot,
  workflowSlug,
} from "../workflow/store.ts";
import { WorkflowError } from "../workflow/types.ts";

function serializeRun(row: WorkflowRunRow) {
  return {
    id: row.id,
    workflowSlug: row.workflow_slug,
    workflowName: row.workflow_name,
    status: row.status,
    trigger: row.trigger,
    error: row.error ?? undefined,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    createdAt: row.created_at,
  };
}

function serializeStep(row: WorkflowRunStepRow) {
  return {
    id: row.id,
    stepId: row.step_id,
    status: row.status,
    command: row.command,
    exitCode: row.exit_code ?? undefined,
    log: row.log,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
  };
}

async function projectFor(projectId: string): Promise<WorkflowProject | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  return {
    id: project.id,
    name: project.name,
    workspace_path: project.workspace_path,
  };
}

function workflowError(error: unknown): Response {
  if (error instanceof WorkflowError) {
    return json({ error: "invalid_workflow", message: error.message, issues: error.issues }, 400);
  }
  return json({ error: "workflow_failed", message: (error as Error).message }, 400);
}

export async function listWorkflowsHandler(projectId: string): Promise<Response> {
  const project = await projectFor(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const [workflows, runs] = await Promise.all([
    listWorkflows(project),
    listWorkflowRuns(projectId, undefined, 200),
  ]);
  const lastRun = new Map<string, WorkflowRunRow>();
  for (const run of runs) {
    if (!lastRun.has(run.workflow_slug)) lastRun.set(run.workflow_slug, run);
  }
  return json({
    root: workflowRoot(project).root,
    source: workflowRoot(project).source,
    workflows: workflows.map((workflow) => ({
      ...workflow,
      lastRun: lastRun.has(workflow.slug) ? serializeRun(lastRun.get(workflow.slug)!) : undefined,
    })),
  });
}

export async function getWorkflowHandler(
  projectId: string,
  slug: string,
): Promise<Response> {
  const project = await projectFor(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  try {
    const { yaml, path } = await readWorkflow(project, slug);
    const definition = parseWorkflow(yaml, slug);
    return json({
      workflow: {
        slug,
        name: definition.name,
        description: definition.description,
        path,
        source: workflowRoot(project).source,
        stepCount: definition.steps.length,
      },
      yaml,
      definition,
    });
  } catch (error) {
    return workflowError(error);
  }
}

export async function createWorkflowHandler(projectId: string, req: Request): Promise<Response> {
  const project = await projectFor(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const parsed = WorkflowCreateInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  try {
    const slug = workflowSlug(parsed.data.name);
    const workflow = await createWorkflow(project, slug, parsed.data.yaml);
    await record("workflow.created", { projectId, slug });
    return json({ workflow }, 201);
  } catch (error) {
    return workflowError(error);
  }
}

export async function saveWorkflowHandler(
  projectId: string,
  slug: string,
  req: Request,
): Promise<Response> {
  const project = await projectFor(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const parsed = WorkflowSaveInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  try {
    const workflow = await saveWorkflow(project, slug, parsed.data.yaml);
    await record("workflow.saved", { projectId, slug });
    return json({ workflow });
  } catch (error) {
    return workflowError(error);
  }
}

export async function deleteWorkflowHandler(
  projectId: string,
  slug: string,
): Promise<Response> {
  const project = await projectFor(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  try {
    await deleteWorkflow(project, slug);
    await record("workflow.deleted", { projectId, slug });
    return json({ ok: true });
  } catch (error) {
    return workflowError(error);
  }
}

export async function runWorkflowHandler(projectId: string, slug: string): Promise<Response> {
  const project = await projectFor(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  if (!project.workspace_path) {
    return json({ error: "workspace_required", message: "Workspace project belum diatur." }, 400);
  }
  try {
    const { yaml, path } = await readWorkflow(project, slug);
    const definition = parseWorkflow(yaml, slug);
    const runId = await startWorkflowRun({
      project,
      projectId,
      slug,
      definition,
      yaml,
      workflowPath: path,
    });
    return json({ runId }, 202);
  } catch (error) {
    if (error instanceof Error && error.message.includes("sedang berjalan")) {
      return json({ error: "run_in_progress", message: error.message }, 409);
    }
    return workflowError(error);
  }
}

export async function listWorkflowRunsHandler(
  projectId: string,
  slug: string | null,
  limit: number,
): Promise<Response> {
  const project = await projectFor(projectId);
  if (!project) return json({ error: "project_not_found" }, 404);
  const safeLimit = Number.isFinite(limit) ? limit : 50;
  const runs = await listWorkflowRuns(projectId, slug ?? undefined, safeLimit);
  return json({ runs: runs.map(serializeRun) });
}

export async function getWorkflowRunHandler(
  projectId: string,
  runId: string,
): Promise<Response> {
  const run = await getWorkflowRun(runId);
  if (!run || run.project_id !== projectId) {
    return json({ error: "run_not_found" }, 404);
  }
  const steps = await listWorkflowRunSteps(run.id);
  return json({ run: serializeRun(run), steps: steps.map(serializeStep) });
}

export async function cancelWorkflowRunHandler(
  projectId: string,
  runId: string,
): Promise<Response> {
  const run = await getWorkflowRun(runId);
  if (!run || run.project_id !== projectId) {
    return json({ error: "run_not_found" }, 404);
  }
  const canceled = await cancelWorkflowRun(runId);
  if (!canceled) return json({ error: "run_not_active" }, 400);
  await record("workflow.run.cancel_requested", { projectId, runId });
  return json({ ok: true });
}
