import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  Briefcase,
  CheckCircle2,
  FolderTree,
  Globe,
  Package,
  PlugZap,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import { api, type SkillInfo, type SkillsResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

const SOURCE_ORDER: SkillInfo["source"][] = ["workspace", "project", "global", "builtin"];

const SOURCE_META: Record<
  SkillInfo["source"],
  {
    labelKey: string;
    descriptionKey: string;
    icon: LucideIcon;
    badge: "default" | "secondary" | "outline" | "success";
  }
> = {
  workspace: {
    labelKey: "settings.skills.source.workspace",
    descriptionKey: "settings.skills.source.workspaceDescription",
    icon: FolderTree,
    badge: "default",
  },
  project: {
    labelKey: "settings.skills.source.project",
    descriptionKey: "settings.skills.source.projectDescription",
    icon: Briefcase,
    badge: "secondary",
  },
  global: {
    labelKey: "settings.skills.source.global",
    descriptionKey: "settings.skills.source.globalDescription",
    icon: Globe,
    badge: "outline",
  },
  builtin: {
    labelKey: "settings.skills.source.builtin",
    descriptionKey: "settings.skills.source.builtinDescription",
    icon: Package,
    badge: "outline",
  },
};

const INTEGRATION_SKILLS = new Set([
  "docmost-api",
  "jira-api",
  "confluence-api",
  "clickup-api",
]);

export function SkillsSettings({ projectId }: { projectId: string | null }) {
  const [data, setData] = useState<SkillsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | SkillInfo["source"]>("all");
  const { t } = useI18n();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    api
      .getSkills(projectId ?? undefined)
      .then((res) => {
        if (!cancelled) setData(res);
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
  }, [projectId]);

  const save = async (enabled: boolean, disabled: string[]) => {
    setBusy(true);
    setError(undefined);
    try {
      await api.saveSkillsSettings({ enabled, disabled });
      setData((current) =>
        current
          ? {
            ...current,
            enabled,
            disabled,
            skills: current.skills.map((skill) => ({
              ...skill,
              enabled: !disabled.includes(skill.id),
            })),
          }
          : current
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleSkill = (id: string, enabled: boolean) => {
    if (!data) return;
    const disabled = enabled
      ? data.disabled.filter((item) => item !== id)
      : [...new Set([...data.disabled, id])];
    void save(data.enabled, disabled);
  };

  const activeCount = data?.skills.filter((skill) => skill.enabled).length ?? 0;
  const integrationCount =
    data?.skills.filter((skill) => INTEGRATION_SKILLS.has(skill.name)).length ?? 0;
  const sourcesCount = new Set(data?.skills.map((skill) => skill.source) ?? []).size;

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visible = (data?.skills ?? []).filter((skill) => {
      if (sourceFilter !== "all" && skill.source !== sourceFilter) return false;
      if (!needle) return true;
      return (
        skill.name.toLowerCase().includes(needle) ||
        skill.description.toLowerCase().includes(needle) ||
        skill.path.toLowerCase().includes(needle)
      );
    });
    return SOURCE_ORDER.map((source) => ({
      source,
      skills: visible.filter((skill) => skill.source === source),
    })).filter((group) => group.skills.length > 0);
  }, [data, query, sourceFilter]);

  const filteredCount = groups.reduce((total, group) => total + group.skills.length, 0);

  return (
    <section className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="flex items-center gap-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
              <Sparkles className="size-4" />
              Skills
            </h2>
            <p className="max-w-2xl text-xs text-muted-foreground">
              {t("settings.skills.intro")} <span className="font-mono">SKILL.md</span>{" "}
              {t("settings.skills.frontmatter")}{" "}
              <span className="font-mono">name</span>/<span className="font-mono">description</span>.
              {" "}
              {t("settings.skills.toolIntro")} <span className="font-mono">use_skill</span>{" "}
              {t("settings.skills.toolOutro")}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-md border px-3 py-2">
            <span className="text-xs text-muted-foreground">
              {data?.enabled ? t("settings.skills.active") : t("settings.skills.inactive")}
            </span>
            <Switch
              checked={!!data?.enabled}
              onCheckedChange={(next) => data && void save(next, data.disabled)}
              disabled={!data || busy}
              aria-label={t("settings.skills.toggleAria")}
            />
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-3">
          <PlugZap className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            {integrationCount > 0
              ? t("settings.skills.integrationCount", { count: integrationCount })
              : t("settings.skills.integrationAuto")}{" "}
            {t("settings.skills.integrationConfigIntro")}{" "}
            <span className="font-medium text-foreground">
              {t("settings.skills.integrationConfigLink")}
            </span>{" "}
            {t("settings.skills.integrationConfigOutro")}{" "}
            <span className="font-mono">project_integrations.config</span>.
          </p>
        </div>
        <Separator />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label={t("settings.skills.statTotal")} value={data?.skills.length ?? 0} />
        <StatCard label={t("settings.skills.statActive")} value={activeCount} icon={CheckCircle2} />
        <StatCard
          label={t("settings.skills.statDisabled")}
          value={(data?.skills.length ?? 0) - activeCount}
          icon={Ban}
        />
        <StatCard label={t("settings.skills.statSources")} value={sourcesCount} icon={Globe} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings.skills.searchPlaceholder")}
            className="pl-8"
            aria-label={t("settings.skills.searchAria")}
          />
        </div>
        <Select
          value={sourceFilter}
          onValueChange={(value) => setSourceFilter(value as typeof sourceFilter)}
        >
          <SelectTrigger className="w-full sm:w-[190px]" aria-label={t("settings.skills.filterAria")}>
            <SelectValue placeholder={t("settings.skills.allSources")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("settings.skills.allSources")}</SelectItem>
            {SOURCE_ORDER.map((source) => (
              <SelectItem key={source} value={source}>
                {t(SOURCE_META[source].labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner />
          {t("settings.skills.loading")}
        </div>
      ) : (
        <>
          <div className="grid gap-2 rounded-md border bg-muted/20 p-3 sm:grid-cols-2">
            <LocationRow
              label={t("settings.skills.source.workspace")}
              path={data?.workspacePath}
              placeholder={t("settings.skills.workspacePlaceholder")}
            />
            <LocationRow
              label={t("settings.skills.source.project")}
              path={data?.projectPath}
              placeholder={t("settings.skills.projectPlaceholder")}
            />
            <LocationRow label={t("settings.skills.source.global")} path={data?.globalPath} />
            <LocationRow label={t("settings.skills.source.builtin")} path={data?.builtinPath} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {t("settings.skills.showing", {
                filtered: filteredCount,
                total: data?.skills.length ?? 0,
              })}
            </span>
            {query || sourceFilter !== "all" ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setSourceFilter("all");
                }}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {t("settings.skills.resetFilter")}
              </button>
            ) : null}
          </div>

          {!data || data.skills.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
              {t("settings.skills.emptyBefore")}{" "}
              <span className="font-mono">my-skill/SKILL.md</span>
              {t("settings.skills.emptyAfter")}
            </p>
          ) : filteredCount === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
              {t("settings.skills.noMatch")}
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {groups.map((group) => {
                const meta = SOURCE_META[group.source];
                const Icon = meta.icon;
                return (
                  <div key={group.source} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Icon className="size-4 text-muted-foreground" />
                      <span className="text-xs font-medium">{t(meta.labelKey)}</span>
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        {group.skills.length}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {t(meta.descriptionKey)}
                      </span>
                    </div>
                    <div className="grid gap-2">
                      {group.skills.map((skill) => (
                        <div
                          key={skill.id}
                          className={cn(
                            "flex flex-col gap-2 rounded-md border p-3 transition-colors",
                            skill.enabled ? "bg-card" : "bg-muted/30 opacity-75",
                          )}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Sparkles
                              className={cn(
                                "size-4",
                                skill.enabled ? "text-primary" : "text-muted-foreground",
                              )}
                            />
                            <span className="font-medium">{skill.name}</span>
                            <Badge variant={meta.badge} className="h-5 px-1.5 text-[10px]">
                              {skill.source}
                            </Badge>
                            {INTEGRATION_SKILLS.has(skill.name) ? (
                              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                                {t("settings.skills.integrationBadge")}
                              </Badge>
                            ) : null}
                            {!skill.enabled ? (
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                {t("settings.skills.disabledBadge")}
                              </Badge>
                            ) : null}
                            <div className="ml-auto flex items-center gap-2">
                              <Switch
                                checked={skill.enabled}
                                onCheckedChange={(next) => toggleSkill(skill.id, next)}
                                disabled={busy || !data.enabled}
                                aria-label={t(
                                  skill.enabled
                                    ? "settings.skills.disableSkill"
                                    : "settings.skills.enableSkill",
                                  { name: skill.name },
                                )}
                              />
                            </div>
                          </div>
                          <p className="line-clamp-2 text-xs text-muted-foreground">
                            {skill.description || t("settings.skills.noDescription")}
                          </p>
                          <p
                            className="truncate font-mono text-[11px] text-muted-foreground"
                            title={skill.path}
                          >
                            {skill.path}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
      <div className="flex flex-col">
        <span className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</span>
        <span className="text-lg font-semibold leading-tight">{value}</span>
      </div>
      {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
    </div>
  );
}

function LocationRow({
  label,
  path,
  placeholder,
}: {
  label: string;
  path?: string | null;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className="truncate font-mono text-[11px]" title={path ?? placeholder}>
        {path ?? placeholder ?? "—"}
      </span>
    </div>
  );
}
