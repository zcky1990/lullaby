import { useState } from "react";
import { Clock, ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { api, type WorkflowSummary } from "@/lib/api";
import { formatApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string | null;
  workflows: WorkflowSummary[];
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onOpenWorkflow: (slug: string, title: string) => void;
  onScheduleChanged: () => void;
}

function formatWhen(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function CronTab({
  projectId,
  workflows,
  loading,
  error,
  onRefresh,
  onOpenWorkflow,
  onScheduleChanged,
}: Props) {
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | undefined>();

  const scheduled = workflows.filter((workflow) =>
    Boolean(
      workflow.schedule?.cron ||
        (workflow.schedule?.events && workflow.schedule.events.length > 0),
    )
  );

  const toggle = async (slug: string, enabled: boolean) => {
    if (!projectId) return;
    setBusySlug(slug);
    setActionError(undefined);
    try {
      await api.patchWorkflowSchedule(projectId, slug, enabled);
      onScheduleChanged();
    } catch (e) {
      setActionError(formatApiError(e));
    } finally {
      setBusySlug(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[35px] shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Clock className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium">Cron & Event</span>
          <span className="text-[10px] text-muted-foreground">
            {scheduled.length} jadwal
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onRefresh}
          disabled={loading}
          data-icon="inline-start"
        >
          {loading ? <Spinner /> : <RefreshCw />}
          Refresh
        </Button>
      </div>

      {(error || actionError)
        ? (
          <p className="border-b px-3 py-2 text-xs text-destructive">
            {actionError ?? error}
          </p>
        )
        : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {scheduled.length === 0 && !loading
          ? (
            <div className="mx-auto flex max-w-lg flex-col gap-2 py-10 text-center text-xs text-muted-foreground">
              <p>Belum ada workflow berjadwal.</p>
              <p>
                Tambahkan <code className="font-mono">schedule</code> atau{" "}
                <code className="font-mono">on</code> di YAML (menu Workflows), Save,
                lalu refresh di sini.
              </p>
            </div>
          )
          : null}

        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {scheduled.map((workflow) => {
            const schedule = workflow.schedule!;
            const busy = busySlug === workflow.slug;
            return (
              <div
                key={workflow.slug}
                className={cn(
                  "flex flex-col gap-2 rounded-md border px-3 py-2.5",
                  !schedule.enabled && "opacity-70",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="truncate text-sm font-medium hover:underline"
                        onClick={() => onOpenWorkflow(workflow.slug, workflow.name)}
                      >
                        {workflow.name}
                      </button>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {workflow.slug}
                      </span>
                      {schedule.cron
                        ? <Badge variant="secondary" className="h-5 text-[10px]">cron</Badge>
                        : null}
                      {(schedule.events?.length ?? 0) > 0
                        ? <Badge variant="outline" className="h-5 text-[10px]">event</Badge>
                        : null}
                    </div>
                    {schedule.cron
                      ? (
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                          {schedule.cron}
                          {schedule.timezone ? ` (${schedule.timezone})` : ""}
                        </p>
                      )
                      : null}
                    {(schedule.events?.length ?? 0) > 0
                      ? (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          on: {schedule.events.map((item) =>
                            item.status
                              ? `${item.event}[${item.status}]`
                              : item.event
                          ).join(", ")}
                        </p>
                      )
                      : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor={`cron-enabled-${workflow.slug}`}
                      className="text-[11px]"
                    >
                      Schedule
                    </Label>
                    <Switch
                      id={`cron-enabled-${workflow.slug}`}
                      checked={schedule.enabled}
                      disabled={busy || !projectId}
                      onCheckedChange={(checked) =>
                        void toggle(workflow.slug, checked)
                      }
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={() => onOpenWorkflow(workflow.slug, workflow.name)}
                      aria-label={`Buka workflow ${workflow.name}`}
                      title="Buka workflow"
                    >
                      <ExternalLink className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                  <span>next: {schedule.enabled ? formatWhen(schedule.nextRunAt) : "—"}</span>
                  <span>last: {formatWhen(schedule.lastRunAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
