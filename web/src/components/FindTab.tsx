import { useEffect, useMemo, useState } from "react";
import { CaseSensitive, File, Regex } from "lucide-react";
import { PanelHeader } from "@/components/PanelHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api, type WorkspaceFindMatch, type WorkspaceFindResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string | null;
  onOpenFile: (path: string, line: number) => void;
}

function groupMatches(matches: WorkspaceFindMatch[]): Array<{
  path: string;
  matches: WorkspaceFindMatch[];
}> {
  const groups = new Map<string, WorkspaceFindMatch[]>();
  for (const match of matches) {
    const list = groups.get(match.path);
    if (list) list.push(match);
    else groups.set(match.path, [match]);
  }
  return [...groups.entries()].map(([path, items]) => ({ path, matches: items }));
}

export function FindTab({ projectId, onOpenFile }: Props) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [result, setResult] = useState<WorkspaceFindResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const raw = query.trim();
    if (!projectId || raw.length === 0) {
      setResult(null);
      setLoading(false);
      setError(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    const timer = setTimeout(() => {
      api
        .findInFiles(projectId, raw, { caseSensitive, regex })
        .then((res) => {
          if (cancelled) return;
          setResult(res);
          setError(res.error);
        })
        .catch((e) => {
          if (!cancelled) {
            setResult(null);
            setError((e as Error).message);
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, query, caseSensitive, regex]);

  const groups = useMemo(() => groupMatches(result?.matches ?? []), [result]);
  const total = result?.matches.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Find" count={result?.matches.length} />
      <div className="flex flex-col gap-2 border-b px-3 py-2">
        <div className="relative">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari di file workspace…"
            className="h-8 pr-16"
            aria-label="Cari di file"
            autoFocus
          />
          <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
            <Button
              size="icon"
              variant={caseSensitive ? "secondary" : "ghost"}
              className="size-6 rounded-sm"
              onClick={() => setCaseSensitive((value) => !value)}
              aria-label="Match case"
              title="Match case"
            >
              <CaseSensitive className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant={regex ? "secondary" : "ghost"}
              className="size-6 rounded-sm"
              onClick={() => setRegex((value) => !value)}
              aria-label="Regex"
              title="Regex"
            >
              <Regex className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {loading
              ? "Mencari…"
              : result
              ? `${total} hasil di ${groups.length} file · ${result.scanned} file dipindai`
              : "Ketik untuk mencari isi file"}
            {result?.truncated ? " · hasil dipotong" : ""}
          </span>
          {loading ? <Spinner className="size-3.5" /> : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {!projectId ? (
          <p className="p-3 text-sm text-muted-foreground">Pilih project dengan workspace dulu.</p>
        ) : error ? (
          <p className="p-3 text-sm text-destructive">{error}</p>
        ) : !result ? (
          <p className="p-3 text-sm text-muted-foreground">
            Cari teks di seluruh file workspace. Klik hasil untuk membuka file pada baris tersebut.
          </p>
        ) : total === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">Tidak ada hasil.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <div key={group.path} className="flex flex-col">
                <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium">
                  <File className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{group.path}</span>
                  <span className="text-muted-foreground">({group.matches.length})</span>
                </div>
                {group.matches.map((match) => (
                  <button
                    key={`${match.path}:${match.line}:${match.column}`}
                    type="button"
                    onClick={() => onOpenFile(match.path, match.line)}
                    className={cn(
                      "flex items-start gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent",
                    )}
                  >
                    <span className="mt-0.5 w-10 shrink-0 text-right font-mono text-muted-foreground">
                      {match.line}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono">{match.preview}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
