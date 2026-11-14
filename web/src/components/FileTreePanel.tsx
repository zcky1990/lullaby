import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  ClipboardPaste,
  Copy,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Scissors,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { PanelHeader } from "@/components/PanelHeader";
import { Spinner } from "@/components/ui/spinner";
import { api, type FileEntry, type GitStatus } from "@/lib/api";
import { buildExplorerMarks, markForPath } from "@/lib/explorer-marks";
import { useDirtyPaths } from "@/hooks/useDirtyPaths";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string | null;
  selectedPath: string | null;
  dirtyPaths?: ReadonlySet<string>;
  gitStatus?: GitStatus | null;
  onOpenFile: (path: string) => void;
  onWorkspaceChange?: () => void;
}

type CreateKind = "file" | "dir";

interface ClipboardEntry {
  mode: "cut" | "copy";
  path: string;
  type: "file" | "dir";
}

function parentOf(path: string | null | undefined): string {
  if (!path) return "";
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "" : normalized.slice(0, index);
}

function basenameOf(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index < 0 ? normalized : normalized.slice(index + 1);
}

export function FileTreePanel({
  projectId,
  selectedPath,
  dirtyPaths,
  gitStatus = null,
  onOpenFile,
  onWorkspaceChange,
}: Props) {
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
  const [clipboard, setClipboard] = useState<ClipboardEntry | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const createInputRef = useRef<HTMLInputElement>(null);

  const storedDirtyPaths = useDirtyPaths();
  const activeDirtyPaths = dirtyPaths ?? storedDirtyPaths;
  const marks = useMemo(
    () => buildExplorerMarks(activeDirtyPaths, gitStatus),
    [activeDirtyPaths, gitStatus],
  );

  const createParent = useMemo(() => {
    if (focusType === "dir" && focusPath) return focusPath;
    if (focusType === "file" && focusPath) return parentOf(focusPath);
    if (selectedPath) return parentOf(selectedPath);
    return "";
  }, [focusPath, focusType, selectedPath]);

  const notifyChange = useCallback(() => {
    onWorkspaceChange?.();
  }, [onWorkspaceChange]);

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

  const startCreate = async (kind: CreateKind, parent = createParent) => {
    if (!projectId || !configured || createBusy || actionBusy) return;
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
      notifyChange();
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

  const refreshAfterTransfer = async (from: string, to: string) => {
    const parents = new Set([parentOf(from), parentOf(to), ""]);
    for (const parent of parents) {
      try {
        await refreshDir(parent);
      } catch {
        // ignore refresh of vanished parents
      }
    }
  };

  const pasteInto = async (parent: string) => {
    if (!projectId || !clipboard || actionBusy) return;
    setActionBusy(true);
    setError(undefined);
    try {
      if (parent) await ensureExpanded(parent);
      const result = clipboard.mode === "cut"
        ? await api.movePath(projectId, { from: clipboard.path, parent })
        : await api.copyPath(projectId, { from: clipboard.path, parent });
      await refreshAfterTransfer(clipboard.path, result.path);
      if (clipboard.mode === "cut") setClipboard(null);
      setFocusPath(result.path);
      setFocusType(clipboard.type);
      notifyChange();
      if (clipboard.type === "file" && clipboard.mode === "copy") onOpenFile(result.path);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  };

  const deleteEntry = async (entry: FileEntry) => {
    if (!projectId || actionBusy) return;
    const label = entry.type === "dir" ? `folder ${entry.name}` : entry.name;
    if (!globalThis.confirm(`Hapus ${label}?`)) return;
    setActionBusy(true);
    setError(undefined);
    try {
      await api.deletePath(projectId, entry.path);
      if (clipboard?.path === entry.path) setClipboard(null);
      if (focusPath === entry.path) {
        setFocusPath(null);
        setFocusType(null);
      }
      await refreshDir(parentOf(entry.path));
      notifyChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(false);
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
            className="h-7 text-xs"
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

  const entryTone = (entry: FileEntry) => {
    const mark = markForPath(marks, activeDirtyPaths, entry.path, entry.type === "dir");
    const isDir = entry.type === "dir";
    const git = isDir ? mark.childGit : mark.git;
    const dirty = isDir ? mark.childDirty : mark.dirty;
    const cutPending = clipboard?.mode === "cut" && clipboard.path === entry.path;
    return { mark, git, dirty, cutPending };
  };

  const renderEntryButton = (entry: FileEntry, depth: number) => {
    const isDir = entry.type === "dir";
    const isOpen = expanded.has(entry.path);
    const focused = focusPath === entry.path;
    const { git, dirty, cutPending } = entryTone(entry);
    const titleBits = [entry.name];
    if (dirty && !isDir) titleBits.push("belum disimpan");
    if (git === "added") titleBits.push(isDir ? "berisi file baru" : "file baru");
    if (git === "modified") titleBits.push(isDir ? "berisi perubahan" : "diubah");
    return (
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
          "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs transition-colors hover:bg-accent",
          (entry.path === selectedPath || focused) && "bg-accent",
          cutPending && "opacity-50",
        )}
        title={titleBits.join(" — ")}
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
            <FolderOpen
              className={cn(
                "size-4 shrink-0",
                git === "added" && "text-amber-600 dark:text-amber-400",
                git === "modified" && "text-sky-600 dark:text-sky-400",
                !git && dirty && "text-foreground",
                !git && !dirty && "text-info",
              )}
            />
          ) : (
            <Folder
              className={cn(
                "size-4 shrink-0",
                git === "added" && "text-amber-600 dark:text-amber-400",
                git === "modified" && "text-sky-600 dark:text-sky-400",
                !git && dirty && "text-foreground",
                !git && !dirty && "text-info",
              )}
            />
          )
        ) : (
          <File
            className={cn(
              "size-4 shrink-0",
              dirty && "text-foreground",
              !dirty && git === "added" && "text-amber-600 dark:text-amber-400",
              !dirty && git === "modified" && "text-sky-600 dark:text-sky-400",
              !dirty && !git && "text-muted-foreground",
            )}
          />
        )}
        <span
          className={cn(
            "truncate",
            (dirty || git) && "font-semibold",
            dirty && "text-foreground",
            !dirty && git === "added" && "text-amber-700 dark:text-amber-300",
            !dirty && git === "modified" && "text-sky-700 dark:text-sky-300",
          )}
        >
          {entry.name}
        </span>
        {dirty && !isDir ? (
          <>
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="sr-only">(belum disimpan)</span>
          </>
        ) : null}
        {!dirty && git === "added" ? (
          <span className="shrink-0 text-[10px] font-medium text-amber-600 dark:text-amber-400">
            U
          </span>
        ) : null}
        {!dirty && git === "modified" ? (
          <span className="shrink-0 text-[10px] font-medium text-sky-600 dark:text-sky-400">
            M
          </span>
        ) : null}
      </button>
    );
  };

  const renderEntryMenu = (entry: FileEntry, depth: number): ReactNode => {
    const isDir = entry.type === "dir";
    const pasteParent = isDir ? entry.path : parentOf(entry.path);
    return (
      <ContextMenu key={entry.path}>
        <ContextMenuTrigger asChild>{renderEntryButton(entry, depth)}</ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem
            disabled={actionBusy || createBusy}
            onSelect={() => {
              setFocusPath(entry.path);
              setFocusType(entry.type);
              void startCreate("file", isDir ? entry.path : parentOf(entry.path));
            }}
          >
            <FilePlus />
            File baru
          </ContextMenuItem>
          <ContextMenuItem
            disabled={actionBusy || createBusy}
            onSelect={() => {
              setFocusPath(entry.path);
              setFocusType(entry.type);
              void startCreate("dir", isDir ? entry.path : parentOf(entry.path));
            }}
          >
            <FolderPlus />
            Folder baru
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={actionBusy}
            onSelect={() => {
              setClipboard({ mode: "cut", path: entry.path, type: entry.type });
              setFocusPath(entry.path);
              setFocusType(entry.type);
            }}
          >
            <Scissors />
            Cut
          </ContextMenuItem>
          <ContextMenuItem
            disabled={actionBusy}
            onSelect={() => {
              setClipboard({ mode: "copy", path: entry.path, type: entry.type });
              setFocusPath(entry.path);
              setFocusType(entry.type);
            }}
          >
            <Copy />
            Copy
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!clipboard || actionBusy}
            onSelect={() => void pasteInto(pasteParent)}
          >
            <ClipboardPaste />
            Paste{clipboard ? ` (${basenameOf(clipboard.path)})` : ""}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            disabled={actionBusy}
            onSelect={() => void deleteEntry(entry)}
          >
            <Trash2 />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const renderNodes = (entries: FileEntry[], depth: number, parent: string): ReactNode => (
    <>
      {renderCreateRow(parent, depth)}
      {entries.map((entry) => {
        const isDir = entry.type === "dir";
        const isOpen = expanded.has(entry.path);
        return (
          <div key={entry.path}>
            {renderEntryMenu(entry, depth)}
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
            disabled={!projectId || !configured || loading || createBusy || actionBusy}
            aria-label="Buat file baru"
            title="Buat file baru"
          >
            <FilePlus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void startCreate("dir")}
            disabled={!projectId || !configured || loading || createBusy || actionBusy}
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
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2 text-xs">
        {!configured && (
          <p className="px-2 py-4 text-xs text-muted-foreground">Workspace belum diset.</p>
        )}
        {configured && error && <p className="px-2 py-2 text-xs text-destructive">{error}</p>}
        {configured && loading && (
          <div className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground">
            <Spinner />
            Memuat file…
          </div>
        )}
        {renderNodes(rootEntries, 0, "")}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="min-h-16 flex-1 px-2 py-3 text-xs text-muted-foreground">
              {configured && !loading && rootEntries.length === 0 && !creating
                ? "Folder kosong. Klik kanan untuk menambah file/folder."
                : null}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-48">
            <ContextMenuItem
              disabled={!configured || actionBusy || createBusy}
              onSelect={() => void startCreate("file", "")}
            >
              <FilePlus />
              File baru
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!configured || actionBusy || createBusy}
              onSelect={() => void startCreate("dir", "")}
            >
              <FolderPlus />
              Folder baru
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!clipboard || !configured || actionBusy}
              onSelect={() => void pasteInto("")}
            >
              <ClipboardPaste />
              Paste di root
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {clipboard ? (
          <p className="px-2 pt-1 text-[10px] text-muted-foreground">
            Clipboard: {clipboard.mode} {basenameOf(clipboard.path)}
          </p>
        ) : null}
      </div>
    </>
  );
}
