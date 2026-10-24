import { useEffect, useState } from "react";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";

export function AutomationSettings() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    api
      .getAutomationSettings()
      .then((res) => {
        if (!cancelled) setEnabled(res.autoBuildOnInProgress);
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

  const save = async (next: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.saveAutomationSettings({ autoBuildOnInProgress: next });
      setEnabled(res.autoBuildOnInProgress);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium tracking-wider text-muted-foreground uppercase">
          Automation
        </h2>
        <p className="text-sm text-muted-foreground">
          Saat aktif, menggeser tiket dari <span className="font-medium">To Do</span> ke{" "}
          <span className="font-medium">In Progress</span> membuka Chat Build baru dan meminta
          agent mengerjakan tiket tersebut. Perubahan file tetap lewat Review tab.
        </p>
        <Separator />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Memuat…
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-medium">Auto-build on In Progress</span>
            <span className="text-xs text-muted-foreground">
              Trigger hanya To Do → In Progress. Default nonaktif.
            </span>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(next) => void save(next)}
            disabled={busy}
            aria-label="Auto-build on In Progress"
          />
        </div>
      )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
