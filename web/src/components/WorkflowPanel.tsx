import { BookOpen, Play, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/PanelHeader";
import { Spinner } from "@/components/ui/spinner";
import type { WorkflowRunSummary, WorkflowSummary } from "@/lib/api";
import { runBadgeVariant } from "@/lib/workflow-status";
import { cn } from "@/lib/utils";

interface Props {
  workflows: WorkflowSummary[];
  runs: WorkflowRunSummary[];
  root?: string;
  source?: "workspace" | "app";
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onCreate: () => void;
  onOpenDocs: () => void;
  onSelect: (slug: string, title: string) => void;
  onOpenRun: (slug: string, title: string) => void;
}

export function WorkflowPanel({
  workflows,
  runs,
  root,
  source,
  loading,
  error,
  onRefresh,
  onCreate,
  onOpenDocs,
  onSelect,
  onOpenRun,
}: Props) {
  return (
    <>
      <PanelHeader title="Workflows" count={workflows.length} />
      <div className="flex flex-col gap-2 px-3 pb-3">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={onCreate}
            data-icon="inline-start"
            className="flex-1"
          >
            <Plus />
            Workflow baru
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            onClick={onOpenDocs}
            aria-label="Dokumentasi workflow"
            title="Dokumentasi workflow"
          >
            <BookOpen />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh workflows"
            title="Refresh"
          >
            {loading ? <Spinner /> : <RefreshCw />}
          </Button>
        </div>
        {root
          ? (
            <p
              className="truncate text-[10px] text-muted-foreground"
              title={root}
            >
              {source === "workspace" ? "workspace" : "app data"}: {root}
            </p>
          )
          : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-2">
        {error
          ? <p className="px-2 text-xs text-destructive">{error}</p>
          : null}

        <div className="flex flex-col gap-1">
          {workflows.length === 0 && !loading
            ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                Belum ada workflow. Klik “Workflow baru” atau buat file `.yaml`
                di folder di atas.
              </p>
            )
            : null}
          {workflows.map((workflow) => (
            <button
              key={workflow.slug}
              type="button"
              onClick={() => onSelect(workflow.slug, workflow.name)}
              className={cn(
                "flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent",
                workflow.error && "text-destructive",
              )}
              title={workflow.path}
            >
              <div className="flex w-full items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {workflow.name}
                </span>
                {workflow.lastRun
                  ? (
                    <Badge
                      variant={runBadgeVariant(workflow.lastRun.status)}
                      className="h-5 px-1.5 text-[10px]"
                    >
                      {workflow.lastRun.status}
                    </Badge>
                  )
                  : null}
              </div>
              <span className="text-[10px] text-muted-foreground">
                {workflow.slug} · {workflow.stepCount} step
                {workflow.error ? " · YAML error" : ""}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <span className="px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Recent runs
          </span>
          {runs.length === 0
            ? (
              <p className="px-2 text-xs text-muted-foreground">
                Belum ada run.
              </p>
            )
            : null}
          {runs.slice(0, 12).map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => onOpenRun(run.workflowSlug, run.workflowName)}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
              title={run.createdAt}
            >
              <Play className="size-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {run.workflowName}
              </span>
              <Badge
                variant={runBadgeVariant(run.status)}
                className="h-5 px-1.5 text-[10px]"
              >
                {run.status}
              </Badge>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
