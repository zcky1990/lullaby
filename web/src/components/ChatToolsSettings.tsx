import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  api,
  type ChatToolCatalogEntry,
  type ChatToolsSettingsResponse,
} from "@/lib/api";

export function ChatToolsSettings() {
  const [autoApproveWrites, setAutoApproveWrites] = useState(false);
  const [disabledTools, setDisabledTools] = useState<string[]>([]);
  const [maxSteps, setMaxSteps] = useState<number | null>(null);
  const [maxStepsDraft, setMaxStepsDraft] = useState("");
  const [tools, setTools] = useState<ChatToolCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    api
      .getChatToolsSettings()
      .then((res) => {
        if (cancelled) return;
        applyResponse(res);
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

  const applyResponse = (res: ChatToolsSettingsResponse) => {
    setAutoApproveWrites(res.autoApproveWrites);
    setDisabledTools(res.disabledTools);
    setMaxSteps(res.maxSteps);
    setMaxStepsDraft(res.maxSteps == null ? "" : String(res.maxSteps));
    setTools(res.tools);
  };

  const save = async (
    nextAuto: boolean,
    nextDisabled: string[],
    nextMaxSteps: number | null,
  ) => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.saveChatToolsSettings({
        autoApproveWrites: nextAuto,
        disabledTools: nextDisabled,
        maxSteps: nextMaxSteps,
      });
      applyResponse(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleTool = (name: string, enabled: boolean) => {
    const next = enabled
      ? disabledTools.filter((item) => item !== name)
      : [...new Set([...disabledTools, name])];
    void save(autoApproveWrites, next, maxSteps);
  };

  const commitMaxSteps = () => {
    const trimmed = maxStepsDraft.trim();
    if (!trimmed) {
      void save(autoApproveWrites, disabledTools, null);
      return;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 200) {
      setError("Max steps harus kosong (unlimited) atau angka 1–200.");
      setMaxStepsDraft(maxSteps == null ? "" : String(maxSteps));
      return;
    }
    void save(autoApproveWrites, disabledTools, parsed);
  };

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Tools
        </h2>
        <p className="text-xs text-muted-foreground">
          Atur auto-approve untuk write file di chat Build, batas langkah agent, dan
          enable/disable tool. Perubahan hanya berlaku untuk chat interaktif (bukan workflow
          agent).
        </p>
        <Separator />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner />
          Memuat…
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-xs font-medium">Auto-approve file writes</span>
              <span className="text-xs text-muted-foreground">
                Jika aktif, <code className="text-xs">write_file</code> langsung ditulis ke
                disk tanpa Review tab. Default nonaktif.
              </span>
            </div>
            <Switch
              checked={autoApproveWrites}
              onCheckedChange={(next) => void save(next, disabledTools, maxSteps)}
              disabled={busy}
              aria-label="Auto-approve file writes"
            />
          </div>

          <div className="flex flex-col gap-2 rounded-md border p-4">
            <Label htmlFor="chat-max-steps" className="text-xs font-medium">
              Max agent steps
            </Label>
            <p className="text-xs text-muted-foreground">
              Kosong = unlimited (seperti OpenCode). Jika diisi, langkah terakhir memaksa
              jawaban teks saja (tanpa tool) + ringkasan progress.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="chat-max-steps"
                type="number"
                min={1}
                max={200}
                inputMode="numeric"
                placeholder="Unlimited"
                className="h-8 w-36 text-xs"
                value={maxStepsDraft}
                onChange={(event) => setMaxStepsDraft(event.target.value)}
                onBlur={() => commitMaxSteps()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
                disabled={busy}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || maxSteps == null}
                onClick={() => {
                  setMaxStepsDraft("");
                  void save(autoApproveWrites, disabledTools, null);
                }}
              >
                Unlimited
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium">Tool chat</span>
                <span className="text-xs text-muted-foreground">
                  Tool yang dimatikan tidak dikirim ke model dan ditolak jika dipanggil.
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || disabledTools.length === 0}
                onClick={() => void save(autoApproveWrites, [], maxSteps)}
              >
                Enable all
              </Button>
            </div>

            <ul className="flex flex-col gap-2">
              {tools.map((tool) => {
                const enabled = !disabledTools.includes(tool.name);
                return (
                  <li
                    key={tool.name}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs">{tool.name}</span>
                        {tool.requiresApproval && (
                          <Badge variant="secondary" className="text-[10px]">
                            {autoApproveWrites ? "Auto-approve on" : "Needs approval"}
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">{tool.description}</span>
                    </div>
                    <Switch
                      checked={enabled}
                      onCheckedChange={(next) => toggleTool(tool.name, next)}
                      disabled={busy}
                      aria-label={`Enable ${tool.name}`}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
