import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n";
import { api, type TerminalShell } from "@/lib/api";

const OPTIONS: { id: TerminalShell; label: string; hintKey: string }[] = [
  { id: "zsh", label: "zsh", hintKey: "settings.terminal.zshHint" },
  { id: "bash", label: "bash", hintKey: "settings.terminal.bashHint" },
];

export function TerminalSettings() {
  const [shell, setShell] = useState<TerminalShell>("zsh");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { t } = useI18n();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    api
      .getTerminalSettings()
      .then((res) => {
        if (!cancelled) setShell(res.shell);
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

  const save = async (next: TerminalShell) => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.saveTerminalSettings({ shell: next });
      setShell(res.shell);
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
          {t("settings.terminal.title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("settings.terminal.description")}
        </p>
        <Separator />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner />
          {t("settings.terminal.loading")}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-medium">{t("settings.terminal.defaultShell")}</span>
            <span className="text-xs text-muted-foreground">
              {t("settings.terminal.defaultShellDescription")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={shell}
              onValueChange={(value) => void save(value as TerminalShell)}
              disabled={busy}
            >
              <SelectTrigger className="w-32" aria-label={t("settings.terminal.defaultShell")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {OPTIONS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {busy ? <Spinner className="size-4" /> : null}
          </div>
        </div>
      )}

      {!loading ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {OPTIONS.map((option) => (
            <li key={option.id}>
              <span className="font-mono text-foreground">{option.label}</span> —{" "}
              {t(option.hintKey)}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="text-xs text-destructive">
          {error}{" "}
          <Button size="sm" variant="ghost" className="h-auto px-1 py-0" onClick={() => void save(shell)}>
            {t("common.retry")}
          </Button>
        </p>
      ) : null}
    </section>
  );
}
