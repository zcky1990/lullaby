import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { api, type SkillsResponse } from "@/lib/api";

export function SkillsSettings({ projectId }: { projectId: string | null }) {
  const [data, setData] = useState<SkillsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

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

  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium tracking-wider text-muted-foreground uppercase">
          Skills
        </h2>
        <p className="text-sm text-muted-foreground">
          Skill adalah folder berisi <span className="font-mono">SKILL.md</span> dengan frontmatter{" "}
          <span className="font-mono">name</span> dan <span className="font-mono">description</span>.
          AI memilih skill lewat tool <span className="font-mono">use_skill</span> (progressive
          disclosure) saat deskripsinya cocok dengan tugas. Skill <Badge variant="outline">project</Badge>{" "}
          di-generate otomatis setelah chat Build yang memakai tool.
        </p>
        <Separator />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {data ? `${data.skills.length} skill ditemukan` : "Memuat…"}
        </span>
        <Button
          size="sm"
          variant={data?.enabled ? "secondary" : "outline"}
          onClick={() => data && void save(!data.enabled, data.disabled)}
          disabled={!data || busy}
        >
          {data?.enabled ? "Skills aktif" : "Skills nonaktif"}
        </Button>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Memuat skills…
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1 rounded-md border bg-muted/20 p-3 text-xs">
            <span className="text-muted-foreground">Workspace (prioritas tertinggi)</span>
            <span className="truncate font-mono">
              {data?.workspacePath ?? "(pilih project untuk skill workspace)"}
            </span>
            <span className="mt-1 text-muted-foreground">Project (auto-generated)</span>
            <span className="truncate font-mono">
              {data?.projectPath ?? "(pilih project untuk skill project)"}
            </span>
            <span className="mt-1 text-muted-foreground">Global</span>
            <span className="truncate font-mono">{data?.globalPath}</span>
          </div>

          {!data || data.skills.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Belum ada skill. Jalankan chat Build, atau buat folder (mis.{" "}
              <span className="font-mono">my-skill/SKILL.md</span>) di salah satu folder di atas.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {data.skills.map((skill) => (
                <div key={skill.id} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Sparkles className="size-4 text-muted-foreground" />
                    <span className="font-medium">{skill.name}</span>
                    <Badge variant={skill.source === "project" ? "secondary" : "outline"}>
                      {skill.source}
                    </Badge>
                    <div className="ml-auto flex items-center gap-2">
                      <Badge variant={skill.enabled ? "secondary" : "outline"}>
                        {skill.enabled ? "Aktif" : "Nonaktif"}
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleSkill(skill.id, !skill.enabled)}
                        disabled={busy || !data.enabled}
                      >
                        {skill.enabled ? "Nonaktifkan" : "Aktifkan"}
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {skill.description || "(tanpa deskripsi)"}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground" title={skill.path}>
                    {skill.path}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
