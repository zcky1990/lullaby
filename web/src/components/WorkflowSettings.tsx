import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";

const DEFAULT_CACHE_KEEP_HOURS = 72;

export function WorkflowSettings() {
  const [cacheKeepHours, setCacheKeepHours] = useState(DEFAULT_CACHE_KEEP_HOURS);
  const [draft, setDraft] = useState(String(DEFAULT_CACHE_KEEP_HOURS));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { t } = useI18n();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    api
      .getWorkflowSettings()
      .then((res) => {
        if (cancelled) return;
        setCacheKeepHours(res.cacheKeepHours);
        setDraft(String(res.cacheKeepHours));
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (hours: number) => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.saveWorkflowSettings({ cacheKeepHours: hours });
      setCacheKeepHours(res.cacheKeepHours);
      setDraft(String(res.cacheKeepHours));
    } catch (e) {
      setError((e as Error).message);
      setDraft(String(cacheKeepHours));
    } finally {
      setBusy(false);
    }
  };

  const commitDraft = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(cacheKeepHours));
      return;
    }
    const next = Math.min(168, Math.max(1, Math.round(parsed)));
    if (next === cacheKeepHours) {
      setDraft(String(cacheKeepHours));
      return;
    }
    void save(next);
  };

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {t("settings.workflow.title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("settings.workflow.description")}
        </p>
        <Separator />
      </div>

      {loading
        ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner />
            {t("settings.workflow.loading")}
          </div>
        )
        : (
          <div className="flex flex-col gap-2 rounded-md border p-4">
            <Label htmlFor="wf-cache-keep-hours" className="text-xs font-medium">
              {t("settings.workflow.cacheKeepHours")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.workflow.cacheKeepHoursDescription")}
            </p>
            <Input
              id="wf-cache-keep-hours"
              type="number"
              min={1}
              max={168}
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitDraft();
                }
              }}
              className="max-w-32"
            />
          </div>
        )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
