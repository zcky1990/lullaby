import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n";
import { api, type PromptsSettings as PromptsData } from "@/lib/api";

/**
 * `GET /api/settings/prompts` juga mengembalikan prompt generate-ticket
 * (tab Document → Generate ticket). Tipe bersama di `lib/api` sengaja tidak
 * diperluas agar perubahan tetap kecil; field ekstra dibaca lewat cast ini.
 */
type PromptSettingsResponse = PromptsData & {
  ticketPrompt?: string;
  defaultTicketPrompt?: string;
  customized: PromptsData["customized"] & { ticketPrompt?: boolean };
};

export function PromptsSettings() {
  const { t } = useI18n();
  const [data, setData] = useState<PromptSettingsResponse | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [planPrompt, setPlanPrompt] = useState("");
  const [ticketPrompt, setTicketPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    api
      .getPrompts()
      .then((result) => {
        const prompts = result as PromptSettingsResponse;
        setData(prompts);
        setSystemPrompt(prompts.systemPrompt);
        setPlanPrompt(prompts.planPrompt);
        setTicketPrompt(prompts.ticketPrompt ?? "");
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(undefined);
    try {
      // Objek disimpan di variabel agar field tambahan ikut terkirim tanpa
      // mengubah tipe `api.savePrompts`.
      const payload = { systemPrompt, planPrompt, ticketPrompt };
      await api.savePrompts(payload);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {t("settings.prompts.title")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("settings.prompts.description")}</p>
        <Separator />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner />
          {t("settings.prompts.loading")}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {t("settings.prompts.systemLabel")}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                onClick={() => {
                  setSystemPrompt(data?.defaultSystemPrompt ?? "");
                  setSaved(false);
                }}
                disabled={!data}
              >
                {t("settings.prompts.resetDefault")}
              </Button>
            </div>
            <textarea
              value={systemPrompt}
              onChange={(event) => {
                setSystemPrompt(event.target.value);
                setSaved(false);
              }}
              rows={8}
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-y rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
            />
            {data?.customized.systemPrompt ? (
              <span className="text-[11px] text-muted-foreground">
                {t("settings.prompts.custom")}
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                {t("settings.prompts.default")}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {t("settings.prompts.planLabel")}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                onClick={() => {
                  setPlanPrompt(data?.defaultPlanPrompt ?? "");
                  setSaved(false);
                }}
                disabled={!data}
              >
                {t("settings.prompts.resetDefault")}
              </Button>
            </div>
            <textarea
              value={planPrompt}
              onChange={(event) => {
                setPlanPrompt(event.target.value);
                setSaved(false);
              }}
              rows={7}
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-y rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
            />
            {data?.customized.planPrompt ? (
              <span className="text-[11px] text-muted-foreground">
                {t("settings.prompts.custom")}
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                {t("settings.prompts.default")}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {t("settings.prompts.ticketLabel")}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                onClick={() => {
                  setTicketPrompt(data?.defaultTicketPrompt ?? "");
                  setSaved(false);
                }}
                disabled={!data}
              >
                {t("settings.prompts.resetDefault")}
              </Button>
            </div>
            <textarea
              value={ticketPrompt}
              onChange={(event) => {
                setTicketPrompt(event.target.value);
                setSaved(false);
              }}
              rows={7}
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-y rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
            />
            <span className="text-[11px] text-muted-foreground">
              {t("settings.prompts.ticketHint")}
            </span>
            {data?.customized.ticketPrompt ? (
              <span className="text-[11px] text-muted-foreground">
                {t("settings.prompts.custom")}
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                {t("settings.prompts.default")}
              </span>
            )}
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Spinner /> : null}
              {t("common.save")}
            </Button>
            {saved ? (
              <span className="text-xs text-muted-foreground">{t("settings.prompts.saved")}</span>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
