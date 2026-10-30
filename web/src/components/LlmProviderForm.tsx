import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
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
import {
  api,
  type CursorModel,
  type LlmProvider,
  type LlmProviderPayload,
  type TestResult,
} from "@/lib/api";

interface Props {
  provider?: LlmProvider | null;
  onSave: (payload: LlmProviderPayload) => Promise<void>;
  onTest: (payload: LlmProviderPayload, providerId?: string) => Promise<TestResult>;
  onDelete: () => Promise<void>;
  onCancel?: () => void;
}

type ProviderKind = "custom" | "cursor";

export function LlmProviderForm({ provider, onSave, onTest, onDelete, onCancel }: Props) {
  const [kind, setKind] = useState<ProviderKind>(
    provider?.provider === "cursor" ? "cursor" : "custom",
  );
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
  const [models, setModels] = useState<CursorModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | undefined>();

  const suffix = provider?.id ?? "new";
  const hasStoredKey = Boolean(provider?.hasApiKey);
  const cursorKeyMissing = kind === "cursor" && !hasStoredKey && !config.apiKey?.trim();

  const loadModels = useCallback(async () => {
    if (!hasStoredKey && !config.apiKey?.trim()) {
      setModels([]);
      setModelsError(undefined);
      return;
    }
    setModelsLoading(true);
    setModelsError(undefined);
    try {
      const res = await api.listCursorModels({
        apiKey: config.apiKey?.trim() || undefined,
        providerId: provider?.id,
      });
      setModels(res.models);
    } catch (error) {
      setModels([]);
      setModelsError((error as Error).message);
    } finally {
      setModelsLoading(false);
    }
  }, [config.apiKey, hasStoredKey, provider?.id]);

  useEffect(() => {
    if (kind !== "cursor") return;
    const timer = setTimeout(() => {
      void loadModels();
    }, 400);
    return () => clearTimeout(timer);
  }, [kind, loadModels]);

  useEffect(() => {
    if (kind !== "cursor" || models.length === 0) return;
    setConfig((current) => {
      if (current.model && models.some((model) => model.id === current.model)) return current;
      return { ...current, model: models[0].id };
    });
  }, [kind, models]);

  const changeKind = (next: ProviderKind) => {
    setKind(next);
    setSaved(false);
    setResult(null);
    setModelsError(undefined);
    setConfig((current) => {
      if (next === "cursor") {
        return {
          ...current,
          name: current.name?.trim() || "Cursor",
          provider: "cursor",
          baseUrl: "",
        };
      }
      return {
        ...current,
        provider: current.provider && current.provider !== "cursor" ? current.provider : "openai",
      };
    });
  };

  const payload = (): LlmProviderPayload => {
    if (kind === "cursor") {
      return {
        name: config.name?.trim() || "Cursor",
        provider: "cursor",
        model: config.model || undefined,
        apiKey: config.apiKey || undefined,
        mode: "api",
      };
    }
    return {
      name: config.name ?? "",
      provider: config.provider ?? "openai",
      model: config.model || undefined,
      baseUrl: config.baseUrl || undefined,
      apiKey: config.apiKey || undefined,
      mode,
    };
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

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`llm-${suffix}-kind`}>Jenis provider</Label>
          <Select value={kind} onValueChange={(value) => changeKind(value as ProviderKind)}>
            <SelectTrigger id={`llm-${suffix}-kind`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="custom">Custom (OpenAI-compatible)</SelectItem>
                <SelectItem value="cursor">Cursor SDK</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {kind === "custom"
          ? (
            <>
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
            </>
          )
          : (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor={`llm-${suffix}-cursor-name`}>Nama</Label>
                <Input
                  id={`llm-${suffix}-cursor-name`}
                  value={config.name ?? ""}
                  placeholder="Cursor"
                  onChange={(e) => setConfig((c) => ({ ...c, name: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`llm-${suffix}-cursor-key`}>API Key</Label>
                <Input
                  id={`llm-${suffix}-cursor-key`}
                  type="password"
                  autoComplete="off"
                  value={config.apiKey ?? ""}
                  placeholder={hasStoredKey ? "Tersimpan — isi untuk mengganti" : "Cursor API key"}
                  onChange={(e) => setConfig((c) => ({ ...c, apiKey: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`llm-${suffix}-cursor-model`}>Model (dari Cursor SDK)</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => void loadModels()}
                    disabled={modelsLoading || cursorKeyMissing}
                    data-icon="inline-start"
                  >
                    {modelsLoading ? <RefreshCw className="animate-spin" /> : <RefreshCw />}
                    Muat ulang
                  </Button>
                </div>
                <Select
                  value={config.model ?? ""}
                  onValueChange={(value) => setConfig((c) => ({ ...c, model: value }))}
                  disabled={modelsLoading || models.length === 0}
                >
                  <SelectTrigger id={`llm-${suffix}-cursor-model`}>
                    <SelectValue
                      placeholder={modelsLoading
                        ? "Memuat model…"
                        : cursorKeyMissing
                        ? "Isi API key dulu"
                        : "Pilih model"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {models.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.name === model.id ? model.id : `${model.name} (${model.id})`}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {modelsError ? (
                  <p className="text-xs text-destructive">
                    Gagal memuat model: {modelsError}{" "}
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={() => void loadModels()}
                    >
                      Coba lagi
                    </button>
                  </p>
                ) : null}
                {!modelsError && models.length > 0 ? (
                  <p className="text-xs text-muted-foreground">{models.length} model tersedia.</p>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Cursor SDK memakai API key Cursor. Agent boleh membaca dan mengedit workspace; edit
                dijalankan pada salinan sementara lalu masuk ke Review aplikasi. Shell/delete
                dinonaktifkan.
              </p>
            </>
          )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy || cursorKeyMissing}>
          Simpan
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={test}
          disabled={busy || cursorKeyMissing}
        >
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
