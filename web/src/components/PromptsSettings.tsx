import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { api, type PromptsSettings as PromptsData } from "@/lib/api";

export function PromptsSettings() {
  const [data, setData] = useState<PromptsData | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [planPrompt, setPlanPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    api
      .getPrompts()
      .then((result) => {
        setData(result);
        setSystemPrompt(result.systemPrompt);
        setPlanPrompt(result.planPrompt);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(undefined);
    try {
      await api.savePrompts({ systemPrompt, planPrompt });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium tracking-wider text-muted-foreground uppercase">
          Prompts
        </h2>
        <p className="text-sm text-muted-foreground">
          Override system prompt global untuk mode Build dan Plan. Persona role (jika aktif) tetap
          ditambahkan di atas prompt ini.
        </p>
        <Separator />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Memuat prompts…
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                SYSTEM PROMPT (Build)
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
                Reset ke default
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
              <span className="text-[11px] text-muted-foreground">Menggunakan prompt kustom.</span>
            ) : (
              <span className="text-[11px] text-muted-foreground">Menggunakan default.</span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">PLAN PROMPT</span>
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
                Reset ke default
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
              <span className="text-[11px] text-muted-foreground">Menggunakan prompt kustom.</span>
            ) : (
              <span className="text-[11px] text-muted-foreground">Menggunakan default.</span>
            )}
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Spinner /> : null}
              Simpan
            </Button>
            {saved ? <span className="text-xs text-muted-foreground">Tersimpan.</span> : null}
          </div>
        </>
      )}
    </section>
  );
}
