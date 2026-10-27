import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Background,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  FileCode2,
  GitBranch,
  Network,
  Play,
  RefreshCw,
  Save,
  Square,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useTheme } from "@/components/ThemeProvider";
import {
  api,
  type WorkflowDefinition,
  type WorkflowDefinitionStep,
  type WorkflowRunStep,
  type WorkflowRunSummary,
  type WorkflowSummary,
} from "@/lib/api";
import {
  runBadgeVariant,
  stepBadgeVariant,
  stepBorderClass,
} from "@/lib/workflow-status";
import { cn } from "@/lib/utils";

const MonacoViewer = lazy(() => import("@/components/MonacoViewer"));

function stepCommand(step: WorkflowDefinitionStep): string {
  if (step.run) return step.run;
  const prompt = step.with?.prompt ?? step.with?.messages?.[0]?.content ?? "chat.completion";
  return `[llm] ${prompt}`;
}

const STATUS_BORDER: Record<string, string> = {
  success: "#10b981",
  failed: "#ef4444",
  running: "#f59e0b",
  skipped: "#6b7280",
  canceled: "#6b7280",
  pending: "var(--border)",
};

interface Props {
  projectId: string | null;
  slug: string | null;
  onSaved: () => void;
  onDeleted: () => void;
}

export function WorkflowTab({ projectId, slug, onSaved, onDeleted }: Props) {
  const { resolvedEditorTheme } = useTheme();
  const [yaml, setYaml] = useState("");
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [summary, setSummary] = useState<WorkflowSummary | null>(null);
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [steps, setSteps] = useState<WorkflowRunStep[]>([]);
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [view, setView] = useState<"editor" | "graph">("editor");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const refreshRuns = useCallback(async () => {
    if (!projectId || !slug) return;
    const result = await api.listWorkflowRuns(projectId, {
      workflow: slug,
      limit: 30,
    });
    setRuns(result.runs);
    return result.runs;
  }, [projectId, slug]);

  const loadRun = useCallback(
    async (runId: string) => {
      if (!projectId) return;
      const result = await api.getWorkflowRun(projectId, runId);
      setSelectedRunId(runId);
      setSteps(result.steps);
      setRuns((current) =>
        current.map((run) => (run.id === result.run.id ? result.run : run))
      );
      setSelectedStep((current) => {
        if (current && result.steps.some((step) => step.stepId === current)) {
          return current;
        }
        const active = result.steps.find((step) => step.status === "running") ??
          result.steps.find((step) => step.status === "failed") ??
          result.steps[0];
        return active?.stepId ?? null;
      });
    },
    [projectId],
  );

  const load = useCallback(async () => {
    if (!projectId || !slug) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const [workflow, runList] = await Promise.all([
        api.getWorkflow(projectId, slug),
        api.listWorkflowRuns(projectId, { workflow: slug, limit: 30 }),
      ]);
      setYaml(workflow.yaml);
      setDefinition(workflow.definition);
      setSummary(workflow.workflow);
      setDirty(false);
      setRuns(runList.runs);
      const latest = runList.runs[0];
      if (latest) {
        await loadRun(latest.id);
      } else {
        setSelectedRunId(null);
        setSteps([]);
        setSelectedStep(workflow.definition.steps[0]?.id ?? null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId, slug, loadRun]);

  useEffect(() => {
    void load();
  }, [projectId, slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  useEffect(() => {
    if (!selectedRun || selectedRun.status !== "running" || !projectId) return;
    const timer = setInterval(() => {
      if (!selectedRunId) return;
      void loadRun(selectedRunId).then(async () => {
        const refreshed = await refreshRuns();
        const latest = refreshed?.find((run) => run.id === selectedRunId);
        if (latest && latest.status !== "running") onSaved();
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [
    selectedRun?.status,
    selectedRunId,
    projectId,
    loadRun,
    refreshRuns,
    onSaved,
  ]);

  const runNow = async () => {
    if (!projectId || !slug || running || selectedRun?.status === "running") {
      return;
    }
    setRunning(true);
    setError(undefined);
    try {
      const { runId } = await api.runWorkflow(projectId, slug);
      setSelectedStep(null);
      await refreshRuns();
      await loadRun(runId);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const cancelRun = async () => {
    if (!projectId || !selectedRunId) return;
    setError(undefined);
    try {
      await api.cancelWorkflowRun(projectId, selectedRunId);
      await loadRun(selectedRunId);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = async () => {
    if (!projectId || !slug) return;
    setSaving(true);
    setError(undefined);
    try {
      await api.saveWorkflow(projectId, slug, yaml);
      await load();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!projectId || !slug) return;
    if (!confirm(`Hapus workflow "${summary?.name ?? slug}"?`)) return;
    try {
      await api.deleteWorkflow(projectId, slug);
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const statusByStep = useMemo(() => {
    const map = new Map<string, WorkflowRunStep["status"]>();
    for (const step of steps) map.set(step.stepId, step.status);
    return map;
  }, [steps]);

  const { nodes, edges } = useMemo(() => {
    if (!definition) return { nodes: [] as Node[], edges: [] as Edge[] };
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    definition.layers.forEach((layer, layerIndex) => {
      layer.forEach((stepId, index) => {
        const status = statusByStep.get(stepId) ?? "pending";
        nodes.push({
          id: stepId,
          position: { x: layerIndex * 240, y: index * 110 },
          data: { label: stepId },
          style: {
            width: 180,
            padding: 10,
            borderRadius: 6,
            background: "var(--card)",
            color: "var(--card-foreground)",
            border: `2px solid ${STATUS_BORDER[status] ?? "var(--border)"}`,
            fontFamily: "monospace",
            fontSize: 12,
          },
        });
      });
    });
    for (const step of definition.steps) {
      for (const dependency of step.depends) {
        const targetStatus = statusByStep.get(step.id);
        edges.push({
          id: `${dependency}->${step.id}`,
          source: dependency,
          target: step.id,
          animated: targetStatus === "running",
          style: { stroke: "var(--border)" },
        });
      }
    }
    return { nodes, edges };
  }, [definition, statusByStep]);

  const selectedStepData = steps.find((step) => step.stepId === selectedStep) ??
    (selectedStep && definition?.steps.find((step) => step.id === selectedStep)
      ? {
        id: selectedStep,
        stepId: selectedStep,
        status: "pending" as const,
        command: stepCommand(definition.steps.find((step) => step.id === selectedStep)!),
        log: "",
      }
      : null);

  if (!slug) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        Pilih workflow di panel kiri atau buat workflow baru.
      </div>
    );
  }

  if (loading) return <Skeleton className="h-full w-full rounded-none" />;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[35px] shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">
            {summary?.name ?? slug}
          </span>
          <span className="truncate font-mono text-[10px] text-muted-foreground">
            {summary?.path ?? slug}
          </span>
          {dirty ? <span className="size-1.5 rounded-full bg-primary" /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {selectedRun?.status === "running"
            ? (
              <Button
                size="sm"
                variant="outline"
                onClick={cancelRun}
                data-icon="inline-start"
              >
                <Square />
                Cancel
              </Button>
            )
            : null}
          <Button
            size="sm"
            variant="outline"
            onClick={runNow}
            disabled={running || selectedRun?.status === "running" ||
              !!summary?.error}
            data-icon="inline-start"
          >
            {running ? <Spinner /> : <Play />}
            Run
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={save}
            disabled={saving || !dirty}
            data-icon="inline-start"
          >
            {saving ? <Spinner /> : <Save />}
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={remove}
            aria-label="Hapus workflow"
            className="text-destructive"
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {error
        ? <p className="border-b px-3 py-2 text-xs text-destructive">{error}</p>
        : null}
      {summary?.error
        ? (
          <p className="border-b px-3 py-2 text-xs text-destructive">
            YAML error: {summary.error}
          </p>
        )
        : null}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[32px] shrink-0 items-center gap-1 border-b px-2">
            <Button
              size="sm"
              variant={view === "editor" ? "secondary" : "ghost"}
              className="h-6 px-2 text-[11px]"
              onClick={() => setView("editor")}
              data-icon="inline-start"
            >
              <FileCode2 />
              Editor
            </Button>
            <Button
              size="sm"
              variant={view === "graph" ? "secondary" : "ghost"}
              className="h-6 px-2 text-[11px]"
              onClick={() => setView("graph")}
              data-icon="inline-start"
            >
              <Network />
              Graph
            </Button>
          </div>

          <div className="min-h-0 flex-1">
            {view === "editor"
              ? (
                <Suspense
                  fallback={<Skeleton className="h-full w-full rounded-none" />}
                >
                  <MonacoViewer
                    path={`${slug}.yaml`}
                    language="yaml"
                    content={yaml}
                    theme={resolvedEditorTheme}
                    readOnly={false}
                    onChange={(value) => {
                      setYaml(value);
                      setDirty(true);
                    }}
                  />
                </Suspense>
              )
              : (
                <div className="h-full w-full">
                  <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    fitView
                    nodesDraggable={false}
                    nodesConnectable={false}
                    elementsSelectable
                    onNodeClick={(_event, node) => setSelectedStep(node.id)}
                  >
                    <Background />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                </div>
              )}
          </div>

          <div className="h-[220px] shrink-0 overflow-auto border-t bg-background">
            <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
              <span className="truncate font-mono text-[11px]">
                {selectedStepData?.stepId ?? "Log"}
              </span>
              {selectedStepData
                ? (
                  <div className="flex items-center gap-2">
                    <Badge variant={stepBadgeVariant(selectedStepData.status)}>
                      {selectedStepData.status}
                    </Badge>
                    {selectedStepData.exitCode !== undefined
                      ? (
                        <span className="text-[10px] text-muted-foreground">
                          exit {selectedStepData.exitCode}
                        </span>
                      )
                      : null}
                  </div>
                )
                : null}
            </div>
            <div className="px-3 py-2">
              <p className="mb-1 font-mono text-[11px] text-muted-foreground">
                $ {selectedStepData?.command ?? ""}
              </p>
              <pre className="font-mono text-[11px] whitespace-pre-wrap">
                {selectedStepData?.log || "(belum ada log)"}
              </pre>
            </div>
          </div>
        </div>

        <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l">
          <div className="flex items-center justify-between border-b px-3 py-1.5">
            <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Runs
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              onClick={() => void load()}
              aria-label="Refresh workflow"
            >
              <RefreshCw className="size-3" />
            </Button>
          </div>
          {runs.length === 0
            ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Belum ada run.
              </p>
            )
            : (
              runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => void loadRun(run.id)}
                  className={cn(
                    "flex items-center gap-2 border-b px-3 py-1.5 text-left text-[11px] hover:bg-accent",
                    run.id === selectedRunId && "bg-accent",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {run.id.slice(0, 8)}
                  </span>
                  <Badge
                    variant={runBadgeVariant(run.status)}
                    className="h-5 px-1.5 text-[10px]"
                  >
                    {run.status}
                  </Badge>
                </button>
              ))
            )}

          <div className="border-b px-3 py-1.5">
            <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Steps
            </span>
          </div>
          {(steps.length > 0 ? steps : definition?.steps.map((step) => ({
            id: step.id,
            stepId: step.id,
            status: "pending" as const,
            command: stepCommand(step),
            log: "",
          })) ?? []).map((step) => (
            <button
              key={step.stepId}
              type="button"
              onClick={() => setSelectedStep(step.stepId)}
              className={cn(
                "flex items-center gap-2 border-b px-3 py-1.5 text-left text-[11px] hover:bg-accent",
                step.stepId === selectedStep && "bg-accent",
                stepBorderClass(step.status).replace(
                  "border-",
                  "border-l-2 border-l-",
                ),
              )}
            >
              <span className="min-w-0 flex-1 truncate font-mono">
                {step.stepId}
              </span>
              <Badge
                variant={stepBadgeVariant(step.status)}
                className="h-5 px-1.5 text-[10px]"
              >
                {step.status}
              </Badge>
            </button>
          ))}
        </aside>
      </div>
    </div>
  );
}
