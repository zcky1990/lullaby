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
  Pencil,
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
import { useI18n } from "@/lib/i18n";
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
  const { t } = useI18n();
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
  const [renaming, setRenaming] = useState<FileEntry | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | undefined>();
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipRenameBlurRef = useRef(false);

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
      setError(res.truncated ? t("explorer.tree.truncated") : res.error);
      return res.entries;
    },
    [projectId, t],
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
    setRenaming(null);
    setRenameName("");
    setRenameError(undefined);
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

  useEffect(() => {
    if (!renaming) return;
    const timer = requestAnimationFrame(() => {
      const input = renameInputRef.current;
      if (!input) return;
      input.focus();
      const value = input.value;
      const dot = renaming.type === "file" ? value.lastIndexOf(".") : -1;
      if (dot > 0) input.setSelectionRange(0, dot);
      else input.select();
    });
    return () => cancelAnimationFrame(timer);
  }, [renaming]);

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
    if (!projectId || !configured || createBusy || actionBusy || renameBusy) return;
    if (renaming) {
      setRenaming(null);
      setRenameName("");
      setRenameError(undefined);
    }
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
      setCreateError(t("explorer.tree.nameRequired"));
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
    if (!projectId || !clipboard || actionBusy || renameBusy) return;
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
    if (!projectId || actionBusy || renameBusy) return;
    const label = entry.type === "dir"
      ? t("explorer.tree.folderLabel", { name: entry.name })
      : entry.name;
    if (!globalThis.confirm(t("explorer.tree.deleteConfirm", { label }))) return;
    setActionBusy(true);
    setError(undefined);
    try {
      await api.deletePath(projectId, entry.path);
      if (clipboard?.path === entry.path) setClipboard(null);
      if (focusPath === entry.path) {
        setFocusPath(null);
        setFocusType(null);
      }
      if (renaming?.path === entry.path) {
        setRenaming(null);
        setRenameName("");
        setRenameError(undefined);
      }
      await refreshDir(parentOf(entry.path));
      notifyChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  };

  const remapPathPrefix = (from: string, to: string) => {
    const rewrite = (path: string) => {
      if (path === from) return to;
      if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`;
      return path;
    };
    const newName = basenameOf(to);
    setExpanded((prev) => {
      const next = new Set<string>();
      for (const path of prev) next.add(rewrite(path));
      return next;
    });
    setChildren((prev) => {
      const next: Record<string, FileEntry[]> = {};
      for (const [path, entries] of Object.entries(prev)) {
        next[rewrite(path)] = entries.map((entry) => ({
          ...entry,
          path: rewrite(entry.path),
          name: entry.path === from ? newName : entry.name,
        }));
      }
      return next;
    });
    setClipboard((prev) => (prev ? { ...prev, path: rewrite(prev.path) } : prev));
  };

  const startRename = (entry: FileEntry) => {
    if (!projectId || !configured || createBusy || actionBusy || renameBusy) return;
    setCreating(null);
    setCreateName("");
    setCreateError(undefined);
    setRenaming(entry);
    setRenameName(entry.name);
    setRenameError(undefined);
    setFocusPath(entry.path);
    setFocusType(entry.type);
  };

  const cancelRename = () => {
    if (renameBusy) return;
    skipRenameBlurRef.current = true;
    setRenaming(null);
    setRenameName("");
    setRenameError(undefined);
  };

  const submitRename = async () => {
    if (skipRenameBlurRef.current) {
      skipRenameBlurRef.current = false;
      return;
    }
    if (!projectId || !renaming || renameBusy) return;
    const name = renameName.trim();
    if (!name) {
      setRenameError(t("explorer.tree.nameRequired"));
      return;
    }
    if (name === renaming.name) {
      skipRenameBlurRef.current = true;
      setRenaming(null);
      setRenameName("");
      setRenameError(undefined);
      return;
    }
    setRenameBusy(true);
    setRenameError(undefined);
    setError(undefined);
    try {
      const from = renaming.path;
      const result = await api.movePath(projectId, { from, name });
      remapPathPrefix(from, result.path);
      await refreshAfterTransfer(from, result.path);
      setFocusPath(result.path);
      setFocusType(renaming.type);
      skipRenameBlurRef.current = true;
      setRenaming(null);
      setRenameName("");
      notifyChange();
    } catch (e) {
      setRenameError((e as Error).message);
    } finally {
      setRenameBusy(false);
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
            aria-label={creating.kind === "dir"
              ? t("explorer.tree.newFolderName")
              : t("explorer.tree.newFileName")}
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

  const renderRenameRow = (entry: FileEntry, depth: number): ReactNode => {
    const isDir = entry.type === "dir";
    const isOpen = expanded.has(entry.path);
    return (
      <div
        key={`rename:${entry.path}`}
        style={{ paddingLeft: depth * 12 + 8 }}
        className="flex flex-col gap-1 py-1 pr-2"
      >
        <div className="flex items-center gap-1.5">
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
          <Input
            ref={renameInputRef}
            value={renameName}
            disabled={renameBusy}
            className="h-7 text-xs"
            aria-label={t("explorer.tree.renameName")}
            onChange={(event) => setRenameName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitRename();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelRename();
              }
            }}
            onBlur={() => {
              if (!renameBusy) void submitRename();
            }}
          />
        </div>
        {renameError ? <p className="pl-9 text-xs text-destructive">{renameError}</p> : null}
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
    if (dirty && !isDir) titleBits.push(t("explorer.tree.titleUnsaved"));
    if (git === "added") {
      titleBits.push(isDir ? t("explorer.tree.titleNewChildren") : t("explorer.tree.titleNewFile"));
    }
    if (git === "modified") {
      titleBits.push(
        isDir ? t("explorer.tree.titleModifiedChildren") : t("explorer.tree.titleModified"),
      );
    }
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
            <span className="sr-only">{t("explorer.tree.unsavedMark")}</span>
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
    if (renaming?.path === entry.path) return renderRenameRow(entry, depth);
    const isDir = entry.type === "dir";
    const pasteParent = isDir ? entry.path : parentOf(entry.path);
    const menuBusy = actionBusy || createBusy || renameBusy;
    return (
      <ContextMenu key={entry.path}>
        <ContextMenuTrigger asChild>{renderEntryButton(entry, depth)}</ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem
            disabled={menuBusy}
            onSelect={() => {
              setFocusPath(entry.path);
              setFocusType(entry.type);
              void startCreate("file", isDir ? entry.path : parentOf(entry.path));
            }}
          >
            <FilePlus />
            {t("explorer.tree.newFile")}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={menuBusy}
            onSelect={() => {
              setFocusPath(entry.path);
              setFocusType(entry.type);
              void startCreate("dir", isDir ? entry.path : parentOf(entry.path));
            }}
          >
            <FolderPlus />
            {t("explorer.tree.newFolder")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={menuBusy}
            onSelect={() => startRename(entry)}
          >
            <Pencil />
            {t("explorer.tree.rename")}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={menuBusy}
            onSelect={() => {
              setClipboard({ mode: "cut", path: entry.path, type: entry.type });
              setFocusPath(entry.path);
              setFocusType(entry.type);
            }}
          >
            <Scissors />
            {t("explorer.tree.cut")}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={menuBusy}
            onSelect={() => {
              setClipboard({ mode: "copy", path: entry.path, type: entry.type });
              setFocusPath(entry.path);
              setFocusType(entry.type);
            }}
          >
            <Copy />
            {t("explorer.tree.copy")}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!clipboard || menuBusy}
            onSelect={() => void pasteInto(pasteParent)}
          >
            <ClipboardPaste />
            {clipboard
              ? t("explorer.tree.pasteWithName", { name: basenameOf(clipboard.path) })
              : t("explorer.tree.paste")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            disabled={menuBusy}
            onSelect={() => void deleteEntry(entry)}
          >
            <Trash2 />
            {t("explorer.tree.delete")}
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
        <PanelHeader title={t("explorer.tree.title")} count={rootEntries.length} />
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void startCreate("file")}
            disabled={!projectId || !configured || loading || createBusy || actionBusy || renameBusy}
            aria-label={t("explorer.tree.createFile")}
            title={t("explorer.tree.createFile")}
          >
            <FilePlus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void startCreate("dir")}
            disabled={!projectId || !configured || loading || createBusy || actionBusy || renameBusy}
            aria-label={t("explorer.tree.createFolder")}
            title={t("explorer.tree.createFolder")}
          >
            <FolderPlus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={!projectId || loading}
            aria-label={t("explorer.tree.refresh")}
          >
            <RefreshCw />
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2 text-xs">
        {!configured && (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            {t("explorer.tree.workspaceNotSet")}
          </p>
        )}
        {configured && error && <p className="px-2 py-2 text-xs text-destructive">{error}</p>}
        {configured && loading && (
          <div className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground">
            <Spinner />
            {t("explorer.tree.loading")}
          </div>
        )}
        {renderNodes(rootEntries, 0, "")}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="min-h-16 flex-1 px-2 py-3 text-xs text-muted-foreground">
              {configured && !loading && rootEntries.length === 0 && !creating
                ? t("explorer.tree.empty")
                : null}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-48">
            <ContextMenuItem
              disabled={!configured || actionBusy || createBusy || renameBusy}
              onSelect={() => void startCreate("file", "")}
            >
              <FilePlus />
              {t("explorer.tree.newFile")}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!configured || actionBusy || createBusy || renameBusy}
              onSelect={() => void startCreate("dir", "")}
            >
              <FolderPlus />
              {t("explorer.tree.newFolder")}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!clipboard || !configured || actionBusy || renameBusy}
              onSelect={() => void pasteInto("")}
            >
              <ClipboardPaste />
              {t("explorer.tree.pasteIntoRoot")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {clipboard ? (
          <p className="px-2 pt-1 text-[10px] text-muted-foreground">
            {t("explorer.tree.clipboardInfo", {
              mode: clipboard.mode,
              name: basenameOf(clipboard.path),
            })}
          </p>
        ) : null}
      </div>
    </>
  );
}
