import { useEffect, useMemo, useRef, useState } from "react";
import { File, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const indexCache = new Map<string, string[]>();

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function fuzzyScore(path: string, query: string): number {
  if (!query) return 0;
  const name = basename(path).toLowerCase();
  const full = path.toLowerCase();
  const q = query.toLowerCase();

  const nameIndex = name.indexOf(q);
  if (nameIndex >= 0) return 2000 - nameIndex * 2 - name.length;
  const fullIndex = full.indexOf(q);
  if (fullIndex >= 0) return 1000 - fullIndex;

  let position = 0;
  let score = 0;
  let streak = 0;
  for (const char of q) {
    const found = full.indexOf(char, position);
    if (found < 0) return -1;
    if (found === position) streak += 1;
    else streak = 0;
    score += 10 + streak * 3 - Math.min(found - position, 20);
    position = found + 1;
  }
  return score - path.length;
}

interface Props {
  open: boolean;
  projectId: string | null;
  onOpenChange: (open: boolean) => void;
  onOpenFile: (path: string) => void;
}

export function QuickOpen({ open, projectId, onOpenChange, onOpenFile }: Props) {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    setError(undefined);
    if (!projectId) {
      setFiles([]);
      return;
    }
    const cached = indexCache.get(projectId);
    if (cached) {
      setFiles(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    let cancelled = false;
    api
      .listFileIndex(projectId)
      .then((res) => {
        if (cancelled) return;
        indexCache.set(projectId, res.files);
        setFiles(res.files);
        setTruncated(res.truncated);
        setError(res.error);
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
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return files.slice(0, 80);
    return files
      .map((path) => ({ path, score: fuzzyScore(path, q) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
      .slice(0, 80)
      .map((item) => item.path);
  }, [files, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const item = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const choose = (path: string) => {
    onOpenChange(false);
    onOpenFile(path);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[12%] translate-y-0 gap-0 p-0 sm:max-w-xl"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">Quick Open</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const path = results[activeIndex];
                if (path) choose(path);
              }
            }}
            placeholder="Cari file berdasarkan nama…"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Cari file"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
              <Spinner />
              Memuat file…
            </div>
          ) : error ? (
            <p className="px-3 py-3 text-xs text-destructive">{error}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              {files.length === 0 ? "Tidak ada file di workspace." : "Tidak ada file yang cocok."}
            </p>
          ) : (
            results.map((path, index) => (
              <button
                key={path}
                type="button"
                data-index={index}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(path)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                  index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                )}
              >
                <File className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{basename(path)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t px-3 py-1.5 text-[10px] text-muted-foreground">
          <span>
            {results.length} file{query ? ` cocok untuk “${query}”` : ""}
            {truncated ? " · indeks dipotong" : ""}
          </span>
          <span>↑↓ pilih · enter buka</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
