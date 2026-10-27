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
import { api, type SkillInfo, type SkillsResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

const SOURCE_ORDER: SkillInfo["source"][] = ["workspace", "project", "global", "builtin"];

const SOURCE_META: Record<
  SkillInfo["source"],
  { label: string; description: string; icon: LucideIcon; badge: "default" | "secondary" | "outline" | "success" }
> = {
  workspace: {
    label: "Workspace",
    description: "Dibaca dari .agents/skills, prioritas tertinggi",
    icon: FolderTree,
    badge: "default",
  },
  project: {
    label: "Project",
    description: "Dibuat otomatis dari chat Build",
    icon: Briefcase,
    badge: "secondary",
  },
  global: {
    label: "Global",
    description: "Tersedia untuk semua project",
    icon: Globe,
    badge: "outline",
  },
  builtin: {
    label: "Builtin",
    description: "Bundled bersama aplikasi",
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
            <h2 className="flex items-center gap-2 text-sm font-medium tracking-wider text-muted-foreground uppercase">
              <Sparkles className="size-4" />
              Skills
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Skill adalah folder <span className="font-mono">SKILL.md</span> berisi frontmatter{" "}
              <span className="font-mono">name</span>/<span className="font-mono">description</span>.
              AI memilih skill lewat tool <span className="font-mono">use_skill</span> saat
              deskripsinya cocok dengan tugas.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-md border px-3 py-2">
            <span className="text-xs text-muted-foreground">
              {data?.enabled ? "Skills aktif" : "Skills nonaktif"}
            </span>
            <Switch
              checked={!!data?.enabled}
              onCheckedChange={(next) => data && void save(next, data.disabled)}
              disabled={!data || busy}
              aria-label="Aktifkan skills"
            />
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-3">
          <PlugZap className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            {integrationCount > 0
              ? `${integrationCount} skill integrasi API (Docmost, Jira, Confluence, ClickUp) terpasang di Global. `
              : "Skill integrasi API (Docmost, Jira, Confluence, ClickUp) otomatis dipasang ke Global saat aplikasi pertama dibuka. "}
            Token integrasi diatur per project di{" "}
            <span className="font-medium text-foreground">Project Settings → Integrations</span>{" "}
            dan disimpan di <span className="font-mono">project_integrations.config</span>.
          </p>
        </div>
        <Separator />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Total skill" value={data?.skills.length ?? 0} />
        <StatCard label="Aktif" value={activeCount} icon={CheckCircle2} />
        <StatCard
          label="Nonaktif"
          value={(data?.skills.length ?? 0) - activeCount}
          icon={Ban}
        />
        <StatCard label="Sumber" value={sourcesCount} icon={Globe} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari nama, deskripsi, atau path skill…"
            className="pl-8"
            aria-label="Cari skill"
          />
        </div>
        <Select
          value={sourceFilter}
          onValueChange={(value) => setSourceFilter(value as typeof sourceFilter)}
        >
          <SelectTrigger className="w-full sm:w-[190px]" aria-label="Filter sumber skill">
            <SelectValue placeholder="Semua sumber" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua sumber</SelectItem>
            {SOURCE_ORDER.map((source) => (
              <SelectItem key={source} value={source}>
                {SOURCE_META[source].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Memuat skills…
        </div>
      ) : (
        <>
          <div className="grid gap-2 rounded-md border bg-muted/20 p-3 sm:grid-cols-2">
            <LocationRow
              label="Workspace"
              path={data?.workspacePath}
              placeholder="(pilih project untuk skill workspace)"
            />
            <LocationRow
              label="Project"
              path={data?.projectPath}
              placeholder="(pilih project untuk skill project)"
            />
            <LocationRow label="Global" path={data?.globalPath} />
            <LocationRow label="Builtin" path={data?.builtinPath} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Menampilkan {filteredCount} dari {data?.skills.length ?? 0} skill
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
                Reset filter
              </button>
            ) : null}
          </div>

          {!data || data.skills.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Belum ada skill. Jalankan chat Build, atau buat folder (mis.{" "}
              <span className="font-mono">my-skill/SKILL.md</span>) di salah satu folder di atas.
            </p>
          ) : filteredCount === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Tidak ada skill yang cocok dengan filter.
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
                      <span className="text-sm font-medium">{meta.label}</span>
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        {group.skills.length}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{meta.description}</span>
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
                                Integrasi API
                              </Badge>
                            ) : null}
                            {!skill.enabled ? (
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                nonaktif
                              </Badge>
                            ) : null}
                            <div className="ml-auto flex items-center gap-2">
                              <Switch
                                checked={skill.enabled}
                                onCheckedChange={(next) => toggleSkill(skill.id, next)}
                                disabled={busy || !data.enabled}
                                aria-label={`${skill.enabled ? "Nonaktifkan" : "Aktifkan"} ${skill.name}`}
                              />
                            </div>
                          </div>
                          <p className="line-clamp-2 text-sm text-muted-foreground">
                            {skill.description || "(tanpa deskripsi)"}
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
