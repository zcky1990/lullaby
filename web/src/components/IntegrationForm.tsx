import { useState } from "react";
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
import type { FieldDef } from "@/lib/integrations";
import { SECRET_MASK, type Integration, type IntegrationPayload, type TestResult } from "@/lib/api";

interface Props {
  kind: string;
  fields: FieldDef[];
  value?: Integration;
  onSave: (payload: IntegrationPayload) => Promise<void>;
  onTest: (payload: IntegrationPayload) => Promise<TestResult>;
  onCancel?: () => void;
}

function initialConfig(fields: FieldDef[], value?: Integration): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    if (field.secret) continue;
    const raw = value?.config?.[field.key];
    if (raw != null && String(raw) !== SECRET_MASK) out[field.key] = String(raw);
  }
  return out;
}

export function IntegrationForm({ kind, fields, value, onSave, onTest, onCancel }: Props) {
  const [mode, setMode] = useState(value?.mode ?? "api");
  const [config, setConfig] = useState<Record<string, string>>(() => initialConfig(fields, value));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const payload = (): IntegrationPayload => {
    const clean: Record<string, string> = {};
    for (const field of fields) {
      const val = config[field.key];
      if (field.secret) {
        if (val) clean[field.key] = val;
        continue;
      }
      if (val) clean[field.key] = val;
    }
    return { kind, mode, config: clean };
  };

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
      setResult(await onTest(payload()));
    } catch (error) {
      setResult({ ok: false, message: (error as Error).message, latencyMs: 0 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.key} className="grid gap-1.5">
            <Label htmlFor={`${kind}-${field.key}`}>{field.label}</Label>
            {field.type === "select" ? (
              <Select
                value={config[field.key] ?? field.options?.[0] ?? ""}
                onValueChange={(v) => setConfig((c) => ({ ...c, [field.key]: v }))}
              >
                <SelectTrigger id={`${kind}-${field.key}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(field.options ?? []).map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={`${kind}-${field.key}`}
                type={field.type === "password" || field.secret ? "password" : "text"}
                autoComplete="off"
                value={config[field.key] ?? ""}
                placeholder={
                  field.secret && value?.hasSecrets
                    ? "Tersimpan — isi untuk mengganti"
                    : field.placeholder
                }
                onChange={(e) => setConfig((c) => ({ ...c, [field.key]: e.target.value }))}
              />
            )}
          </div>
        ))}
        <div className="grid gap-1.5">
          <Label htmlFor={`${kind}-mode`}>Mode</Label>
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger id={`${kind}-mode`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="api">api</SelectItem>
                <SelectItem value="mcp">mcp (belum dieksekusi)</SelectItem>
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
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Batal
          </Button>
        )}
        {saved ? <Badge variant="success">Tersimpan</Badge> : null}
        {result ? (
          <span className={cnText(result.ok)}>
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

function cnText(ok: boolean): string {
  return `text-xs ${ok ? "text-success" : "text-destructive"}`;
}
