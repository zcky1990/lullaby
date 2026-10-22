import { useEffect, useState } from "react";
import { Check, FileCode2, GitCommitHorizontal, History, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api, type GitCommit, type GitFile, type GitStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string | null;
  status: GitStatus | null;
  commits: GitCommit[];
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onStage: (paths: string[]) => Promise<void>;
  onUnstage: (paths: string[]) => Promise<void>;
  onCommit: (message: string) => Promise<void>;
}

type View = "changes" | "history";

export function GitTab({
  projectId,
  status,
  commits,
  loading,
  error,
  onRefresh,
  onStage,
  onUnstage,
  onCommit,
}: Props) {
  const [view, setView] = useState<View>("changes");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<{ path: string; staged: boolean } | null>(null);
  const [diff, setDiff] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    setDiff("");
    setDiffError(undefined);
    setSelected(null);
  }, [projectId]);

  const loadDiff = async (file: GitFile, staged: boolean) => {
    if (!projectId) return;
    setSelected({ path: file.path, staged });
    setDiffLoading(true);
    setDiffError(undefined);
    try {
      const result = await api.gitDiff(projectId, file.path, staged);
      setDiff(result.diff || "(tidak ada diff)");
    } catch (e) {
      setDiffError((e as Error).message);
      setDiff("");
    } finally {
      setDiffLoading(false);
    }
  };

  const stage = async (paths: string[], staged: boolean) => {
    setActionError(undefined);
    try {
      if (staged) await onUnstage(paths);
      else await onStage(paths);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const commitNow = async () => {
    if (!message.trim()) return;
    setCommitting(true);
    setActionError(undefined);
    try {
      await onCommit(message.trim());
      setMessage("");
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setCommitting(false);
    }
  };

  const staged = status?.staged ?? [];
  const unstaged = status?.unstaged ?? [];
  const untracked = status?.untracked ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={view === "changes" ? "secondary" : "ghost"}
            onClick={() => setView("changes")}
            data-icon="inline-start"
          >
            <FileCode2 />
            Changes
          </Button>
          <Button
            size="sm"
            variant={view === "history" ? "secondary" : "ghost"}
            onClick={() => setView("history")}
            data-icon="inline-start"
          >
            <History />
            History
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {status ? (
            <span className="font-mono text-xs text-muted-foreground">{status.branch}</span>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={onRefresh}
            disabled={loading}
            data-icon="inline-start"
          >
            {loading ? <Spinner /> : <RefreshCw />}
            Refresh
          </Button>
        </div>
      </div>

      {error ? <p className="border-b px-4 py-2 text-xs text-destructive">{error}</p> : null}
      {actionError ? (
        <p className="border-b px-4 py-2 text-xs text-destructive">{actionError}</p>
      ) : null}

      {view === "changes" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={3}
                placeholder="Commit message…"
                className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {staged.length} file staged
                </span>
                <Button
                  size="sm"
                  onClick={commitNow}
                  disabled={committing || !message.trim() || staged.length === 0}
                  data-icon="inline-start"
                >
                  {committing ? <Spinner /> : <GitCommitHorizontal />}
                  Commit
                </Button>
              </div>
            </div>

            <FileSection
              title="Staged"
              files={staged}
              staged
              selected={selected}
              onSelect={loadDiff}
              onAction={(paths) => stage(paths, true)}
              actionLabel="Unstage"
              onAll={() => stage(staged.map((file) => file.path), true)}
            />

            <FileSection
              title="Changes"
              files={unstaged}
              selected={selected}
              onSelect={loadDiff}
              onAction={(paths) => stage(paths, false)}
              actionLabel="Stage"
              onAll={() => stage(unstaged.map((file) => file.path), false)}
            />

            <FileSection
              title="Untracked"
              files={untracked}
              selected={selected}
              onSelect={loadDiff}
              onAction={(paths) => stage(paths, false)}
              actionLabel="Stage"
              onAll={() => stage(untracked.map((file) => file.path), false)}
            />

            {selected ? (
              <div className="overflow-hidden rounded-md border">
                <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {selected.path}
                  </span>
                  <Badge variant="outline">{selected.staged ? "staged" : "working tree"}</Badge>
                </div>
                {diffLoading ? (
                  <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                    <Spinner />
                    Memuat diff…
                  </div>
                ) : diffError ? (
                  <p className="p-3 text-xs text-destructive">{diffError}</p>
                ) : (
                  <div className="max-h-72 overflow-auto bg-background py-1 font-mono text-[11px] leading-4">
                    {diff.split("\n").map((line, index) => (
                      <div
                        key={index}
                        className={cn(
                          "flex whitespace-pre-wrap break-all",
                          line.startsWith("+") && !line.startsWith("+++") && "bg-emerald-500/10",
                          line.startsWith("-") && !line.startsWith("---") && "bg-red-500/10",
                        )}
                      >
                        <span className="w-5 shrink-0 text-center text-muted-foreground/60 select-none">
                          {line.startsWith("+") && !line.startsWith("+++")
                            ? "+"
                            : line.startsWith("-") && !line.startsWith("---")
                            ? "-"
                            : ""}
                        </span>
                        <span
                          className={cn(
                            line.startsWith("+") && !line.startsWith("+++") &&
                              "text-emerald-600 dark:text-emerald-400",
                            line.startsWith("-") && !line.startsWith("---") &&
                              "text-red-600 dark:text-red-400",
                            !line.startsWith("+") && !line.startsWith("-") &&
                              "text-muted-foreground",
                          )}
                        >
                          {line.startsWith("+") || line.startsWith("-") ? line.slice(1) : line}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {status?.clean ? (
              <p className="text-sm text-muted-foreground">Tidak ada perubahan.</p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {commits.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada commit.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {commits.map((commit) => (
                <div
                  key={commit.hash}
                  className="flex flex-col gap-1 rounded-md border px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {commit.short}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-sm">{commit.subject}</span>
                    {commit.refs ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {commit.refs}
                      </Badge>
                    ) : null}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {commit.author} · {commit.date}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FileSection({
  title,
  files,
  staged,
  selected,
  onSelect,
  onAction,
  actionLabel,
  onAll,
}: {
  title: string;
  files: GitFile[];
  staged?: boolean;
  selected: { path: string; staged: boolean } | null;
  onSelect: (file: GitFile, staged: boolean) => void;
  onAction: (paths: string[]) => void;
  actionLabel: string;
  onAll: () => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {title} ({files.length})
        </span>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={onAll}>
          {actionLabel} all
        </Button>
      </div>
      {files.map((file) => {
        const active = selected?.path === file.path && selected.staged === Boolean(staged);
        return (
          <div
            key={`${file.path}:${staged ? "s" : "w"}`}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-accent",
              active && "bg-accent",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(file, Boolean(staged))}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              title={file.path}
            >
              <span className="w-5 shrink-0 font-mono text-[10px] text-muted-foreground">
                {file.status.trim() || "M"}
              </span>
              <span className="truncate">{file.path}</span>
            </button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 shrink-0 px-2 text-[11px]"
              onClick={() => onAction([file.path])}
              data-icon="inline-start"
            >
              <Check />
              {actionLabel}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
