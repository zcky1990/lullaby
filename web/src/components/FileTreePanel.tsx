import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, File, Folder, FolderOpen, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/PanelHeader";
import { Spinner } from "@/components/ui/spinner";
import { api, type FileEntry } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string | null;
  selectedPath: string | null;
  onOpenFile: (path: string) => void;
}

export function FileTreePanel({ projectId, selectedPath, onOpenFile }: Props) {
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [configured, setConfigured] = useState(true);

  const fetchDir = useCallback(
    async (path: string): Promise<FileEntry[]> => {
      if (!projectId) return [];
      const res = await api.listFiles(projectId, path);
      setConfigured(res.configured);
      setError(res.truncated ? "Sebagian entri dipotong (maks 1000)." : res.error);
      return res.entries;
    },
    [projectId],
  );

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(undefined);
    setExpanded(new Set());
    setChildren({});
    try {
      setRootEntries(await fetchDir(""));
    } catch (e) {
      setError((e as Error).message);
      setRootEntries([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, fetchDir]);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  const toggle = async (entry: FileEntry) => {
    if (expanded.has(entry.path)) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(entry.path);
        return next;
      });
      return;
    }
    setExpanded((prev) => new Set(prev).add(entry.path));
    if (!children[entry.path]) {
      try {
        const entries = await fetchDir(entry.path);
        setChildren((prev) => ({ ...prev, [entry.path]: entries }));
      } catch (e) {
        setError((e as Error).message);
      }
    }
  };

  const renderNodes = (entries: FileEntry[], depth: number): ReactNode =>
    entries.map((entry) => {
      const isDir = entry.type === "dir";
      const isOpen = expanded.has(entry.path);
      return (
        <div key={entry.path}>
          <button
            onClick={() => (isDir ? toggle(entry) : onOpenFile(entry.path))}
            style={{ paddingLeft: depth * 12 + 8 }}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm transition-colors hover:bg-accent",
              entry.path === selectedPath && "bg-accent",
            )}
            title={entry.name}
          >
            {isDir ? (
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform",
                  isOpen && "rotate-90",
                )}
              />
            ) : (
              <span className="size-3.5 shrink-0" />
            )}
            {isDir ? (
              isOpen ? (
                <FolderOpen className="size-4 shrink-0 text-info" />
              ) : (
                <Folder className="size-4 shrink-0 text-info" />
              )
            ) : (
              <File className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{entry.name}</span>
          </button>
          {isDir && isOpen && children[entry.path] && renderNodes(children[entry.path], depth + 1)}
        </div>
      );
    });

  return (
    <>
      <div className="flex items-center justify-between pr-2">
        <PanelHeader title="Explorer" count={rootEntries.length} />
        <Button
          variant="ghost"
          size="icon"
          onClick={refresh}
          disabled={!projectId || loading}
          aria-label="Refresh files"
        >
          <RefreshCw />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {!configured && <p className="px-2 py-4 text-sm text-muted-foreground">Workspace belum diset.</p>}
        {configured && error && <p className="px-2 py-2 text-sm text-destructive">{error}</p>}
        {configured && !error && rootEntries.length === 0 && !loading && (
          <p className="px-2 py-4 text-sm text-muted-foreground">Folder kosong.</p>
        )}
        {configured && loading && (
          <div className="flex items-center gap-2 px-2 py-4 text-sm text-muted-foreground">
            <Spinner />
            Memuat file…
          </div>
        )}
        {renderNodes(rootEntries, 0)}
      </div>
    </>
  );
}
