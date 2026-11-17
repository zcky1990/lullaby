import { useEffect, useState } from "react";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";

export function AutomationSettings() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { t } = useI18n();

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
        <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {t("settings.automation.title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("settings.automation.descriptionPrefix")}{" "}
          <span className="font-medium">To Do</span>{" "}
          {t("settings.automation.descriptionMid")}{" "}
          <span className="font-medium">In Progress</span>{" "}
          {t("settings.automation.descriptionOutro")}
        </p>
        <Separator />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner />
          {t("settings.automation.loading")}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-medium">{t("settings.automation.autoBuild")}</span>
            <span className="text-xs text-muted-foreground">
              {t("settings.automation.autoBuildDescription")}
            </span>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(next) => void save(next)}
            disabled={busy}
            aria-label={t("settings.automation.autoBuild")}
          />
        </div>
      )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
