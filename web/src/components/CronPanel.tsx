import { BookOpen, Clock, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/PanelHeader";
import { Spinner } from "@/components/ui/spinner";
import type { WorkflowSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  workflows: WorkflowSummary[];
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onOpenDocs: () => void;
  onSelect: (slug: string, title: string) => void;
}

function formatNext(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function CronPanel({
  workflows,
  loading,
  error,
  onRefresh,
  onOpenDocs,
  onSelect,
}: Props) {
  const scheduled = workflows.filter((workflow) =>
    Boolean(
      workflow.schedule?.cron ||
        (workflow.schedule?.events && workflow.schedule.events.length > 0),
    )
  );

  return (
    <>
      <PanelHeader title="Cron" count={scheduled.length} />
      <div className="flex flex-col gap-2 px-3 pb-3">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onOpenDocs}
            data-icon="inline-start"
            className="flex-1"
            title="Dokumentasi cron & event"
          >
            <BookOpen />
            Dokumentasi
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh jadwal"
            title="Refresh"
          >
            {loading ? <Spinner /> : <RefreshCw />}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Workflow dengan `schedule` atau `on` di YAML.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
        {error ? <p className="px-2 text-xs text-destructive">{error}</p> : null}

        {scheduled.length === 0 && !loading
          ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              Belum ada jadwal. Tambahkan `schedule` / `on` di YAML workflow, lalu Save.
            </p>
          )
          : null}

        {scheduled.map((workflow) => {
          const schedule = workflow.schedule!;
          return (
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
                <Clock className="size-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs">
                  {workflow.name}
                </span>
                <Badge
                  variant={schedule.enabled ? "secondary" : "outline"}
                  className="h-5 px-1.5 text-[10px]"
                >
                  {schedule.enabled ? "on" : "off"}
                </Badge>
              </div>
              <span className="pl-5 font-mono text-[10px] text-muted-foreground">
                {schedule.cron
                  ? schedule.cron
                  : `${schedule.events.length} event`}
              </span>
              {schedule.cron && schedule.enabled
                ? (
                  <span className="pl-5 text-[10px] text-muted-foreground">
                    next {formatNext(schedule.nextRunAt)}
                  </span>
                )
                : null}
            </button>
          );
        })}
      </div>
    </>
  );
}
