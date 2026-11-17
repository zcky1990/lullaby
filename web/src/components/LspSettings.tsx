import { useEffect, useMemo, useState } from "react";
import { Code2, Plus, Save, ServerCog, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useI18n, type Translator } from "@/lib/i18n";
import { dispatchLspSettingsChanged } from "@/lib/lsp-events";
import {
  api,
  type LspPreset,
  type LspPresetVariant,
  type LspProbeResult,
  type LspServer,
  type LspSettings,
} from "@/lib/api";

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return env;
}

function envText(env: Record<string, string>): string {
  return Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n");
}

function initOptionsText(value: Record<string, unknown> | undefined): string {
  if (!value || Object.keys(value).length === 0) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function parseInitOptions(
  text: string,
  t: Translator,
): { ok: true; value?: Record<string, unknown> } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: undefined };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: t("settings.lsp.initOptionsError") };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      ok: false,
      error: t("settings.lsp.jsonInvalid", { message: (error as Error).message }),
    };
  }
}

function serverFromPreset(
  preset: LspPreset,
  variant: LspPresetVariant,
): LspServer {
  return {
    name: preset.name,
    languages: preset.languages,
    command: variant.command,
    args: variant.args,
    env: {},
    enabled: true,
    mode: variant.mode,
  };
}

export function LspSettingsPanel() {
  const [settings, setSettings] = useState<LspSettings>({ enabled: false, servers: [] });
  const [presets, setPresets] = useState<LspPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [initErrors, setInitErrors] = useState<Record<number, string | undefined>>({});
  const [initDrafts, setInitDrafts] = useState<Record<number, string>>({});
  const [probes, setProbes] = useState<Record<string, LspProbeResult | "loading">>({});
  const { t } = useI18n();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    api
      .getLspSettings()
      .then((res) => {
        if (cancelled) return;
        setSettings(res.settings);
        setPresets(res.presets);
        const drafts: Record<number, string> = {};
        res.settings.servers.forEach((server, index) => {
          drafts[index] = initOptionsText(server.initializationOptions);
        });
        setInitDrafts(drafts);
        setInitErrors({});
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

  const update = (next: LspSettings) => {
    setSettings(next);
    setDirty(true);
  };

  const patchServer = (index: number, patch: Partial<LspServer>) => {
    update({
      ...settings,
      servers: settings.servers.map((server, i) => (i === index ? { ...server, ...patch } : server)),
    });
  };

  const addServer = (preset: LspPreset, variant: LspPresetVariant) => {
    const nextIndex = settings.servers.length;
    update({ ...settings, servers: [...settings.servers, serverFromPreset(preset, variant)] });
    setInitDrafts((current) => ({ ...current, [nextIndex]: "" }));
  };

  const removeServer = (index: number) => {
    update({
      ...settings,
      servers: settings.servers.filter((_, i) => i !== index),
    });
    setInitDrafts((current) => {
      const next: Record<number, string> = {};
      Object.entries(current).forEach(([key, value]) => {
        const i = Number(key);
        if (i < index) next[i] = value;
        else if (i > index) next[i - 1] = value;
      });
      return next;
    });
    setInitErrors((current) => {
      const next: Record<number, string | undefined> = {};
      Object.entries(current).forEach(([key, value]) => {
        const i = Number(key);
        if (i < index) next[i] = value;
        else if (i > index) next[i - 1] = value;
      });
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const nextServers: LspServer[] = [];
      const nextErrors: Record<number, string | undefined> = {};
      for (let index = 0; index < settings.servers.length; index++) {
        const server = settings.servers[index]!;
        const parsed = parseInitOptions(initDrafts[index] ?? "", t);
        if (!parsed.ok) {
          nextErrors[index] = parsed.error;
          setInitErrors(nextErrors);
          setError(t("settings.lsp.fixInitOptions"));
          return;
        }
        nextErrors[index] = undefined;
        nextServers.push({
          ...server,
          initializationOptions: parsed.value,
        });
      }
      setInitErrors(nextErrors);
      const res = await api.saveLspSettings({ ...settings, servers: nextServers });
      setSettings(res.settings);
      const drafts: Record<number, string> = {};
      res.settings.servers.forEach((server, index) => {
        drafts[index] = initOptionsText(server.initializationOptions);
      });
      setInitDrafts(drafts);
      setDirty(false);
      dispatchLspSettingsChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const probe = async (index: number) => {
    const server = settings.servers[index];
    if (!server) return;
    const key = `${index}:${server.command}`;
    setProbes((current) => ({ ...current, [key]: "loading" }));
    try {
      const result = await api.probeLspServer(server.command);
      setProbes((current) => ({ ...current, [key]: result }));
    } catch (e) {
      setProbes((current) => ({
        ...current,
        [key]: { found: false, command: server.command, path: (e as Error).message },
      }));
    }
  };

  const enabledCount = useMemo(
    () => settings.servers.filter((server) => server.enabled).length,
    [settings.servers],
  );

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
          <ServerCog className="size-4" />
          {t("settings.lsp.title")}
        </h2>
        <p className="max-w-3xl text-xs text-muted-foreground">
          {t("settings.lsp.description")}{" "}
          <span className="font-medium text-foreground">{t("settings.lsp.notBundled")}</span>{" "}
          {t("settings.lsp.beforeNpx")} <span className="font-mono">npx</span>.
        </p>
        <Separator />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner />
          {t("settings.lsp.loading")}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-xs font-medium">{t("settings.lsp.enable")}</span>
              <span className="text-xs text-muted-foreground">
                {t("settings.lsp.enableDescription", { count: enabledCount })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {dirty ? <Badge variant="outline">{t("settings.lsp.unsaved")}</Badge> : null}
              <Switch
                checked={settings.enabled}
                onCheckedChange={(next) => update({ ...settings, enabled: next })}
                disabled={busy}
                aria-label={t("settings.lsp.enable")}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {t("settings.lsp.configuredCount", { count: settings.servers.length })}
            </span>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" data-icon="inline-start">
                    <Plus />
                    {t("settings.lsp.addPreset")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  {presets.map((preset, presetIndex) => (
                    <div key={preset.id}>
                      {presetIndex > 0 ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuLabel className="text-[11px] uppercase">
                        {preset.name}
                      </DropdownMenuLabel>
                      <DropdownMenuGroup>
                        {preset.variants.map((variant) => (
                          <DropdownMenuItem
                            key={`${preset.id}:${variant.mode}`}
                            onSelect={() => addServer(preset, variant)}
                          >
                            <Code2 className="size-3.5" />
                            {variant.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                onClick={() => void save()}
                disabled={busy || !dirty}
                data-icon="inline-start"
              >
                {busy ? <Spinner /> : <Save />}
                {t("common.save")}
              </Button>
            </div>
          </div>

          {settings.servers.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
              {t("settings.lsp.empty")}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {settings.servers.map((server, index) => {
                const probeKey = `${index}:${server.command}`;
                const probeResult = probes[probeKey];
                const probePath = probeResult && probeResult !== "loading"
                  ? (probeResult.path ?? "")
                  : "";
                return (
                  <div key={server.id ?? index} className="flex flex-col gap-3 rounded-md border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={server.name}
                        onChange={(event) => patchServer(index, { name: event.target.value })}
                        className="h-8 max-w-64"
                        aria-label={t("settings.lsp.serverName")}
                      />
                      <Badge variant={server.mode === "npx" ? "secondary" : "outline"}>
                        {server.mode}
                      </Badge>
                      {server.languages.map((language) => (
                        <Badge key={language} variant="outline">
                          {language}
                        </Badge>
                      ))}
                      <div className="ml-auto flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() => void probe(index)}
                          disabled={probeResult === "loading"}
                          data-icon="inline-start"
                        >
                          {probeResult === "loading" ? <Spinner /> : <ServerCog />}
                          {t("settings.lsp.probe")}
                        </Button>
                        <Switch
                          checked={server.enabled}
                          onCheckedChange={(next) => patchServer(index, { enabled: next })}
                          aria-label={t("settings.lsp.enableServer", { name: server.name })}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("settings.lsp.deleteServer", { name: server.name })}
                          className="size-7 text-destructive"
                          onClick={() => removeServer(index)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        {t("settings.lsp.command")}
                        <Input
                          value={server.command}
                          onChange={(event) => patchServer(index, { command: event.target.value })}
                          className="font-mono text-xs"
                          placeholder="typescript-language-server"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        {t("settings.lsp.languages")}
                        <Input
                          value={server.languages.join(", ")}
                          onChange={(event) =>
                            patchServer(index, {
                              languages: event.target.value
                                .split(",")
                                .map((item) => item.trim())
                                .filter(Boolean),
                            })}
                          className="font-mono text-xs"
                          placeholder="typescript, javascript"
                        />
                      </label>
                    </div>

                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      {t("settings.lsp.args")}
                      <textarea
                        value={server.args.join("\n")}
                        onChange={(event) =>
                          patchServer(index, {
                            args: event.target.value.split(/\r?\n/).filter((item) => item.length > 0),
                          })}
                        rows={3}
                        className="border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border px-2 py-1.5 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
                        placeholder={"--stdio"}
                      />
                    </label>

                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer select-none">
                        {t("settings.lsp.environment")}
                      </summary>
                      <textarea
                        value={envText(server.env)}
                        onChange={(event) => patchServer(index, { env: parseEnv(event.target.value) })}
                        rows={3}
                        className="border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 mt-2 w-full rounded-md border px-2 py-1.5 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
                        placeholder={"NODE_OPTIONS=--max-old-space-size=4096"}
                      />
                    </details>

                    <details className="text-xs text-muted-foreground" open={Boolean(initDrafts[index])}>
                      <summary className="cursor-pointer select-none">
                        {t("settings.lsp.initOptions")}
                      </summary>
                      <textarea
                        value={initDrafts[index] ?? ""}
                        onChange={(event) => {
                          const text = event.target.value;
                          setInitDrafts((current) => ({ ...current, [index]: text }));
                          const parsed = parseInitOptions(text, t);
                          setInitErrors((current) => ({
                            ...current,
                            [index]: parsed.ok ? undefined : parsed.error,
                          }));
                          setDirty(true);
                        }}
                        rows={4}
                        className="border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 mt-2 w-full rounded-md border px-2 py-1.5 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
                        placeholder={'{\n  "typescript": { "tsserver": { "useSyntaxServer": "never" } }\n}'}
                      />
                      {initErrors[index] ? (
                        <p className="mt-1 text-destructive">{initErrors[index]}</p>
                      ) : (
                        <p className="mt-1">
                          {t("settings.lsp.initOptionsHint")}{" "}
                          <span className="font-mono">initializationOptions</span>.
                        </p>
                      )}
                    </details>

                    {probeResult ? (
                      <p className={probeResult === "loading"
                        ? "text-xs text-muted-foreground"
                        : probeResult.found
                        ? "text-xs text-emerald-600 dark:text-emerald-400"
                        : "text-xs text-destructive"}>
                        {probeResult === "loading"
                          ? t("settings.lsp.probing")
                          : probeResult.found
                          ? `${t("settings.lsp.probeFound", { path: probePath })}${
                            server.mode === "npx"
                              ? ` ${t("settings.lsp.probeNpxNote")}`
                              : ""
                          }`
                          : `${t("settings.lsp.probeNotFound", { command: probeResult.command })}${
                            probePath ? ` ${t("settings.lsp.probePathNote", { path: probePath })}` : ""
                          }`}
                      </p>
                    ) : server.mode === "npx" ? (
                      <p className="text-xs text-muted-foreground">
                        {t("settings.lsp.npxModeHint")}{" "}
                        <span className="font-mono">npx</span>.
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <p className="text-xs text-muted-foreground">
            {t("settings.lsp.securityPrefix")} <span className="font-mono">npx</span>{" "}
            {t("settings.lsp.securitySuffix")}
          </p>
        </>
      )}
    </section>
  );
}
