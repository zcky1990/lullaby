import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelHeader } from "@/components/PanelHeader";
import { Spinner } from "@/components/ui/spinner";
import { api, type FileEntry } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string | null;
  selectedPath: string | null;
  onOpenFile: (path: string) => void;
}

type CreateKind = "file" | "dir";

function parentOf(path: string | null | undefined): string {
  if (!path) return "";
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "" : normalized.slice(0, index);
}

export function FileTreePanel({ projectId, selectedPath, onOpenFile }: Props) {
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [configured, setConfigured] = useState(true);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [focusType, setFocusType] = useState<"file" | "dir" | null>(null);
  const [creating, setCreating] = useState<{ kind: CreateKind; parent: string } | null>(null);
  const [createName, setCreateName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();
  const createInputRef = useRef<HTMLInputElement>(null);

  const createParent = useMemo(() => {
    if (focusType === "dir" && focusPath) return focusPath;
    if (focusType === "file" && focusPath) return parentOf(focusPath);
    if (selectedPath) return parentOf(selectedPath);
    return "";
  }, [focusPath, focusType, selectedPath]);

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

  const refreshDir = useCallback(
    async (path: string) => {
      const entries = await fetchDir(path);
      if (!path) setRootEntries(entries);
      else setChildren((prev) => ({ ...prev, [path]: entries }));
      return entries;
    },
    [fetchDir],
  );

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(undefined);
    setExpanded(new Set());
    setChildren({});
    setCreating(null);
    setCreateName("");
    setCreateError(undefined);
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

  useEffect(() => {
    if (!creating) return;
    const timer = requestAnimationFrame(() => createInputRef.current?.focus());
    return () => cancelAnimationFrame(timer);
  }, [creating]);

  const ensureExpanded = async (path: string) => {
    if (!path || expanded.has(path)) {
      if (path && !children[path]) {
        try {
          await refreshDir(path);
        } catch (e) {
          setError((e as Error).message);
        }
      }
      return;
    }
    setExpanded((prev) => new Set(prev).add(path));
    try {
      await refreshDir(path);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const startCreate = async (kind: CreateKind) => {
    if (!projectId || !configured || createBusy) return;
    const parent = createParent;
    if (parent) await ensureExpanded(parent);
    setCreating({ kind, parent });
    setCreateName(kind === "file" ? "untitled.txt" : "new-folder");
    setCreateError(undefined);
  };

  const cancelCreate = () => {
    if (createBusy) return;
    setCreating(null);
    setCreateName("");
    setCreateError(undefined);
  };

  const submitCreate = async () => {
    if (!projectId || !creating || createBusy) return;
    const name = createName.trim();
    if (!name) {
      setCreateError("Nama wajib diisi.");
      return;
    }
    setCreateBusy(true);
    setCreateError(undefined);
    try {
      const result = await api.createPath(projectId, {
        type: creating.kind,
        parent: creating.parent,
        name,
      });
      await refreshDir(creating.parent);
      setCreating(null);
      setCreateName("");
      if (creating.kind === "file") {
        setFocusPath(result.path);
        setFocusType("file");
        onOpenFile(result.path);
      } else {
        setFocusPath(result.path);
        setFocusType("dir");
        await ensureExpanded(result.path);
      }
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setCreateBusy(false);
    }
  };

  const toggle = async (entry: FileEntry) => {
    setFocusPath(entry.path);
    setFocusType(entry.type);
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

  const renderCreateRow = (parent: string, depth: number): ReactNode => {
    if (!creating || creating.parent !== parent) return null;
    return (
      <div
        key={`create:${parent}:${creating.kind}`}
        style={{ paddingLeft: depth * 12 + 8 }}
        className="flex flex-col gap-1 py-1 pr-2"
      >
        <div className="flex items-center gap-1.5">
          <span className="size-3.5 shrink-0" />
          {creating.kind === "dir" ? (
            <Folder className="size-4 shrink-0 text-info" />
          ) : (
            <File className="size-4 shrink-0 text-muted-foreground" />
          )}
          <Input
            ref={createInputRef}
            value={createName}
            disabled={createBusy}
            className="h-7 text-sm"
            aria-label={creating.kind === "dir" ? "Nama folder baru" : "Nama file baru"}
            onChange={(event) => setCreateName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitCreate();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelCreate();
              }
            }}
            onBlur={() => {
              if (!createBusy && !createName.trim()) cancelCreate();
            }}
          />
        </div>
        {createError ? <p className="pl-9 text-xs text-destructive">{createError}</p> : null}
      </div>
    );
  };

  const renderNodes = (entries: FileEntry[], depth: number, parent: string): ReactNode => (
    <>
      {renderCreateRow(parent, depth)}
      {entries.map((entry) => {
        const isDir = entry.type === "dir";
        const isOpen = expanded.has(entry.path);
        const focused = focusPath === entry.path;
        return (
          <div key={entry.path}>
            <button
              type="button"
              onClick={() => {
                if (isDir) {
                  void toggle(entry);
                  return;
                }
                setFocusPath(entry.path);
                setFocusType("file");
                onOpenFile(entry.path);
              }}
              draggable={!isDir}
              onDragStart={(event) => {
                if (isDir) return;
                event.dataTransfer.setData("application/x-rnd-workspace-path", entry.path);
                event.dataTransfer.setData("text/plain", entry.path);
                event.dataTransfer.effectAllowed = "copy";
              }}
              style={{ paddingLeft: depth * 12 + 8 }}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm transition-colors hover:bg-accent",
                (entry.path === selectedPath || focused) && "bg-accent",
              )}
              title={entry.name}
              aria-expanded={isDir ? isOpen : undefined}
              aria-level={depth + 1}
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
            {isDir && isOpen && children[entry.path]
              ? renderNodes(children[entry.path], depth + 1, entry.path)
              : isDir && isOpen
              ? renderCreateRow(entry.path, depth + 1)
              : null}
          </div>
        );
      })}
    </>
  );

  return (
    <>
      <div className="flex items-center justify-between pr-2">
        <PanelHeader title="Explorer" count={rootEntries.length} />
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void startCreate("file")}
            disabled={!projectId || !configured || loading || createBusy}
            aria-label="Buat file baru"
            title="Buat file baru"
          >
            <FilePlus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void startCreate("dir")}
            disabled={!projectId || !configured || loading || createBusy}
            aria-label="Buat folder baru"
            title="Buat folder baru"
          >
            <FolderPlus />
          </Button>
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
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {!configured && <p className="px-2 py-4 text-sm text-muted-foreground">Workspace belum diset.</p>}
        {configured && error && <p className="px-2 py-2 text-sm text-destructive">{error}</p>}
        {configured && !error && rootEntries.length === 0 && !loading && !creating && (
          <p className="px-2 py-4 text-sm text-muted-foreground">Folder kosong.</p>
        )}
        {configured && loading && (
          <div className="flex items-center gap-2 px-2 py-4 text-sm text-muted-foreground">
            <Spinner />
            Memuat file…
          </div>
        )}
        {renderNodes(rootEntries, 0, "")}
      </div>
    </>
  );
}
