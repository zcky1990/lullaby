import { useEffect, useState } from "react";
import type { LlmProvider } from "@/lib/api";
import { api } from "@/lib/api";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
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
import { useI18n } from "@/lib/i18n";
import {
  docStudioApi,
  type DocStudioConfig,
  type DocStudioLanguage,
  type DocStudioSettingsResponse,
  type DocTemplate,
} from "@/lib/doc-studio-api";

const NONE = "__none";
const AUTO = "__auto";

interface CustomTypeDraft {
  id: string;
  label: string;
  outline: string;
  interviewTopics: string;
}

const EMPTY_CUSTOM: CustomTypeDraft = { id: "", label: "", outline: "", interviewTopics: "" };

function toLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function errorMessage(error: unknown): string {
  return (error as Error)?.message ?? String(error);
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {title}
        </h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        <Separator />
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function RoleSelect({
  value,
  roles,
  onChange,
  ariaLabel,
}: {
  value: string;
  roles: Array<{ id: string; name: string }>;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const { t } = useI18n();
  return (
    <Select value={value || NONE} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-56" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={NONE}>{t("docStudio.settings.defaultRoleNone")}</SelectItem>
          {roles.map((role) => (
            <SelectItem key={role.id} value={role.id}>
              {role.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/**
 * Global Settings → Doc Studio: role/provider default, bahasa output, override
 * prompt per tipe dokumen, dan tipe dokumen kustom.
 */
export function DocStudioSettings() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<DocStudioSettingsResponse | null>(null);
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [config, setConfig] = useState<DocStudioConfig | null>(null);
  const [custom, setCustom] = useState<CustomTypeDraft>(EMPTY_CUSTOM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [settingsRes, llmRes] = await Promise.all([
          docStudioApi.getSettings(),
          api.listLlm().catch(() => ({ providers: [] as LlmProvider[] })),
        ]);
        if (cancelled) return;
        setSettings(settingsRes);
        setProviders(llmRes.providers);
        setConfig(settingsRes.config);
      } catch (err) {
        if (!cancelled) setError(t("docStudio.settings.loadError", { message: errorMessage(err) }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const patch = (next: Partial<DocStudioConfig>) => {
    setConfig((current) => (current ? { ...current, ...next } : current));
    setSaved(false);
  };

  const typeConfig = (typeId: string) =>
    config?.types[typeId] ?? { roleId: null, prompt: "" };

  const setTypeRole = (typeId: string, roleId: string) => {
    if (!config) return;
    patch({
      types: {
        ...config.types,
        [typeId]: { ...typeConfig(typeId), roleId: roleId === NONE ? null : roleId },
      },
    });
  };

  const setTypePrompt = (typeId: string, prompt: string) => {
    if (!config) return;
    patch({
      types: { ...config.types, [typeId]: { ...typeConfig(typeId), prompt } },
    });
  };

  const addCustomType = () => {
    if (!config) return;
    const id = custom.id.trim().toLowerCase();
    const label = custom.label.trim();
    const outline = toLines(custom.outline);
    if (!id || !label || outline.length < 2) return;
    const template: DocTemplate = {
      id,
      label,
      description: "",
      outline,
      interviewTopics: toLines(custom.interviewTopics).length
        ? toLines(custom.interviewTopics)
        : outline,
    };
    patch({
      customTypes: [
        ...config.customTypes.filter((item) => item.id !== id),
        template,
      ].slice(0, 20),
    });
    setCustom(EMPTY_CUSTOM);
  };

  const save = async () => {
    if (!config) return;
    setBusy(true);
    setError(null);
    try {
      const res = await docStudioApi.saveSettings({
        defaultRoleId: config.defaultRoleId,
        defaultProviderId: config.defaultProviderId,
        language: config.language,
        types: config.types,
        customTypes: config.customTypes,
      });
      setSettings(res);
      setConfig(res.config);
      setSaved(true);
    } catch (err) {
      setError(t("docStudio.settings.saveError", { message: errorMessage(err) }));
    } finally {
      setBusy(false);
    }
  };

  if (error && !config) {
    return <p className="text-xs text-destructive">{error}</p>;
  }
  if (!config || !settings) {
    return <p className="text-xs text-muted-foreground">{t("common.loading")}</p>;
  }

  const roleOptions = settings.roles;

  return (
    <div className="flex flex-col gap-8">
      <Section
        title={t("docStudio.settings.title")}
        description={t("docStudio.settings.description")}
      >
        <div className="flex flex-wrap gap-4">
          <Field
            label={t("docStudio.settings.defaultRole")}
            hint={t("docStudio.settings.defaultRoleHint")}
          >
            <RoleSelect
              value={config.defaultRoleId ?? NONE}
              roles={roleOptions}
              ariaLabel={t("docStudio.settings.defaultRole")}
              onChange={(value) =>
                patch({ defaultRoleId: value === NONE ? null : value })
              }
            />
          </Field>
          <Field
            label={t("docStudio.settings.defaultProvider")}
            hint={t("docStudio.settings.defaultProviderHint")}
          >
            <Select
              value={config.defaultProviderId ?? AUTO}
              onValueChange={(value) =>
                patch({ defaultProviderId: value === AUTO ? null : value })
              }
            >
              <SelectTrigger
                size="sm"
                className="w-56"
                aria-label={t("docStudio.settings.defaultProvider")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={AUTO}>{t("docStudio.settings.providerAuto")}</SelectItem>
                  {providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("docStudio.settings.language")}>
            <Select
              value={config.language}
              onValueChange={(value) => patch({ language: value as DocStudioLanguage })}
            >
              <SelectTrigger
                size="sm"
                className="w-56"
                aria-label={t("docStudio.settings.language")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="auto">{t("docStudio.settings.languageAuto")}</SelectItem>
                  <SelectItem value="id">{t("docStudio.settings.languageId")}</SelectItem>
                  <SelectItem value="en">{t("docStudio.settings.languageEn")}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      <Section
        title={t("docStudio.settings.perType")}
        description={t("docStudio.settings.perTypeHint")}
      >
        <div className="flex flex-col gap-3">
          {settings.templates.map((template) => {
            const current = typeConfig(template.id);
            return (
              <div key={template.id} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium">{template.label}</span>
                  <span className="text-xs text-muted-foreground">{template.description}</span>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <Field label={t("docStudio.settings.typeRole")}>
                    <RoleSelect
                      value={current.roleId ?? NONE}
                      roles={roleOptions}
                      ariaLabel={`${t("docStudio.settings.typeRole")} ${template.label}`}
                      onChange={(value) => setTypeRole(template.id, value)}
                    />
                  </Field>
                  <Button
                    size="sm"
                    variant="ghost"
                    data-icon="inline-start"
                    disabled={!current.prompt}
                    onClick={() => setTypePrompt(template.id, "")}
                  >
                    {t("docStudio.settings.resetPrompt")}
                  </Button>
                </div>
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    {t("docStudio.settings.typePrompt")}
                    {current.prompt ? (
                      <span className="ml-1 text-[10px] text-primary">
                        ({t("docStudio.settings.typeCustom")})
                      </span>
                    ) : (
                      <span className="ml-1 text-[10px]">
                        ({t("docStudio.settings.typeDefault")})
                      </span>
                    )}
                  </summary>
                  <textarea
                    value={current.prompt}
                    onChange={(event) => setTypePrompt(template.id, event.target.value)}
                    rows={6}
                    placeholder={t("docStudio.settings.typePromptPlaceholder")}
                    aria-label={`${t("docStudio.settings.typePrompt")} ${template.label}`}
                    className="mt-2 w-full resize-y rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </details>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title={t("docStudio.settings.customTypes")}
        description={t("docStudio.settings.customTypesHint")}
      >
        <div className="flex flex-col gap-2">
          {config.customTypes.map((template) => (
            <div
              key={template.id}
              className="flex items-center gap-2 rounded-md border px-3 py-2"
            >
              <span className="text-xs font-medium">{template.label}</span>
              <span className="truncate text-xs text-muted-foreground">{template.id}</span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() =>
                  patch({
                    customTypes: config.customTypes.filter(
                      (item) => item.id !== template.id,
                    ),
                  })
                }
              >
                {t("docStudio.settings.remove")}
              </Button>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="docstudio-type-id">{t("docStudio.settings.newTypeId")}</Label>
              <Input
                id="docstudio-type-id"
                value={custom.id}
                onChange={(event) => setCustom({ ...custom, id: event.target.value })}
                className="w-40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="docstudio-type-label">{t("docStudio.settings.newTypeLabel")}</Label>
              <Input
                id="docstudio-type-label"
                value={custom.label}
                onChange={(event) => setCustom({ ...custom, label: event.target.value })}
                className="w-40"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="docstudio-type-outline">
              {t("docStudio.settings.newTypeOutline")}
            </Label>
            <textarea
              id="docstudio-type-outline"
              value={custom.outline}
              onChange={(event) => setCustom({ ...custom, outline: event.target.value })}
              rows={4}
              className="w-full resize-y rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="docstudio-type-topics">
              {t("docStudio.settings.newTypeTopics")}
            </Label>
            <textarea
              id="docstudio-type-topics"
              value={custom.interviewTopics}
              onChange={(event) => setCustom({ ...custom, interviewTopics: event.target.value })}
              rows={3}
              className="w-full resize-y rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div>
            <Button size="sm" onClick={addCustomType}>
              {t("docStudio.settings.addType")}
            </Button>
          </div>
        </div>
      </Section>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={busy} data-icon="inline-start">
          {busy ? <Spinner /> : null}
          {busy ? t("docStudio.settings.saving") : t("docStudio.settings.save")}
        </Button>
        {saved ? (
          <span className="text-xs text-muted-foreground">{t("docStudio.settings.saved")}</span>
        ) : null}
      </div>
    </div>
  );
}
