import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROVIDER_FIELDS } from "@/lib/integrations";
import type { LlmProvider, LlmProviderPayload, TestResult } from "@/lib/api";

interface Props {
  provider?: LlmProvider | null;
  onSave: (payload: LlmProviderPayload) => Promise<void>;
  onTest: (payload: LlmProviderPayload, providerId?: string) => Promise<TestResult>;
  onDelete: () => Promise<void>;
  onCancel?: () => void;
}

export function LlmProviderForm({ provider, onSave, onTest, onDelete, onCancel }: Props) {
  const [mode, setMode] = useState(provider?.mode ?? "api");
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const field of PROVIDER_FIELDS) {
      if (field.secret) continue;
      const raw = provider?.[field.key as keyof LlmProvider];
      if (raw != null) out[field.key] = String(raw);
    }
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const payload = (): LlmProviderPayload => ({
    name: config.name ?? "",
    provider: config.provider ?? "openai",
    model: config.model || undefined,
    baseUrl: config.baseUrl || undefined,
    apiKey: config.apiKey || undefined,
    mode,
  });

  const save = async () => {
    setBusy(true);
    setSaved(false);
    try {
      await onSave(payload());
      setSaved(true);
    } catch (error) {
      setResult({ ok: false, message: (error as Error).message, latencyMs: 0 });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await onTest(payload(), provider?.id));
    } catch (error) {
      setResult({ ok: false, message: (error as Error).message, latencyMs: 0 });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Hapus provider ini?")) return;
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
    }
  };

  const suffix = provider?.id ?? "new";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {PROVIDER_FIELDS.map((field) => (
          <div key={field.key} className="grid gap-1.5">
            <Label htmlFor={`llm-${suffix}-${field.key}`}>{field.label}</Label>
            <Input
              id={`llm-${suffix}-${field.key}`}
              type={field.type === "password" || field.secret ? "password" : "text"}
              autoComplete="off"
              value={config[field.key] ?? ""}
              placeholder={
                field.secret && (provider?.hasApiKey || provider?.apiKey)
                  ? "Tersimpan — isi untuk mengganti"
                  : field.placeholder
              }
              onChange={(e) => setConfig((c) => ({ ...c, [field.key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="grid gap-1.5">
          <Label htmlFor={`llm-${suffix}-mode`}>Mode</Label>
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger id={`llm-${suffix}-mode`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="api">api</SelectItem>
                <SelectItem value="mcp">mcp</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          Simpan
        </Button>
        <Button size="sm" variant="outline" onClick={test} disabled={busy}>
          Test Connection
        </Button>
        {provider && (
          <Button size="sm" variant="ghost" onClick={remove} disabled={busy} data-icon="inline-start">
            <Trash2 />
            Hapus
          </Button>
        )}
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Batal
          </Button>
        )}
        {saved ? <Badge variant="success">Tersimpan</Badge> : null}
        {result ? (
          <span className={`text-xs ${result.ok ? "text-success" : "text-destructive"}`}>
            {result.message} ({result.latencyMs}ms)
          </span>
        ) : null}
      </div>

      {result?.detail != null && (
        <pre className="max-h-32 overflow-auto rounded-md border bg-muted/40 p-2 text-[10px] whitespace-pre-wrap text-muted-foreground">
          {typeof result.detail === "string"
            ? result.detail
            : JSON.stringify(result.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}
