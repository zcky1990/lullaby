import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  CloudDownload,
  FileCode2,
  GitBranchPlus,
  GitCommitHorizontal,
  GitMerge,
  History,
  Minus,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  api,
  type GitBranch,
  type GitCommit,
  type GitCommitDetail,
  type GitFile,
  type GitStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string | null;
  status: GitStatus | null;
  branches: GitBranch[];
  commits: GitCommit[];
  loading: boolean;
  error?: string;
  onRefresh: () => void | Promise<void>;
  onStage: (paths: string[]) => Promise<void>;
  onUnstage: (paths: string[]) => Promise<void>;
  onCommit: (message: string) => Promise<void>;
}

type View = "changes" | "history";

const SPLIT_KEY = "rnd.gitSplit:v1";
const MIN_LEFT = 240;
const MIN_RIGHT = 280;
const EMPTY_FILES: GitFile[] = [];

function readSplit(): number {
  try {
    const value = Number(localStorage.getItem(SPLIT_KEY));
    if (Number.isFinite(value) && value >= 0.25 && value <= 0.7) return value;
  } catch {
    // ignore
  }
  return 0.42;
}

export function GitTab({
  projectId,
  status,
  branches,
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
  const [actionNotice, setActionNotice] = useState<string | undefined>();
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [split, setSplit] = useState(readSplit);
  const [resizing, setResizing] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [commitDetail, setCommitDetail] = useState<GitCommitDetail | null>(null);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitError, setCommitError] = useState<string | undefined>();
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeBranch, setMergeBranch] = useState("");
  const [stashOpen, setStashOpen] = useState(false);
  const [stashMessage, setStashMessage] = useState("");
  const splitRef = useRef<HTMLDivElement>(null);
  const autoSelectKey = useRef<string>("");

  const mergeCandidates = useMemo(
    () => branches.filter((branch) => !branch.current),
    [branches],
  );

  const staged = status?.staged ?? EMPTY_FILES;
  const unstaged = status?.unstaged ?? EMPTY_FILES;
  const untracked = status?.untracked ?? EMPTY_FILES;

  const firstFile = useMemo(() => {
    if (staged[0]) return { file: staged[0], staged: true };
    if (unstaged[0]) return { file: unstaged[0], staged: false };
    if (untracked[0]) return { file: untracked[0], staged: false };
    return null;
  }, [staged, unstaged, untracked]);

  useEffect(() => {
    setDiff("");
    setDiffError(undefined);
    setSelected(null);
    setSelectedCommit(null);
    setCommitDetail(null);
    setCommitError(undefined);
    setMessage("");
    autoSelectKey.current = "";
  }, [projectId]);

  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_KEY, String(split));
    } catch {
      // ignore
    }
  }, [split]);

  const loadDiff = async (file: GitFile, isStaged: boolean) => {
    if (!projectId) return;
    setSelected({ path: file.path, staged: isStaged });
    setDiffLoading(true);
    setDiffError(undefined);
    try {
      const result = await api.gitDiff(projectId, file.path, isStaged);
      setDiff(result.diff || "(tidak ada diff)");
    } catch (e) {
      setDiffError((e as Error).message);
      setDiff("");
    } finally {
      setDiffLoading(false);
    }
  };

  useEffect(() => {
    if (view !== "changes" || !projectId || !firstFile) return;
    const key = `${projectId}:${firstFile.file.path}:${firstFile.staged ? "s" : "w"}`;
    if (autoSelectKey.current === key) return;
    if (
      selected &&
      (staged.some((f) => f.path === selected.path) ||
        unstaged.some((f) => f.path === selected.path) ||
        untracked.some((f) => f.path === selected.path))
    ) {
      return;
    }
    autoSelectKey.current = key;
    void loadDiff(firstFile.file, firstFile.staged);
  }, [view, projectId, firstFile, status, selected, staged, unstaged, untracked]);

  useEffect(() => {
    if (view !== "history" || !projectId) return;
    if (commits.length === 0) {
      setSelectedCommit(null);
      setCommitDetail(null);
      return;
    }
    const hash = selectedCommit && commits.some((c) => c.hash === selectedCommit)
      ? selectedCommit
      : commits[0].hash;
    if (hash !== selectedCommit) setSelectedCommit(hash);
  }, [view, projectId, commits, selectedCommit]);

  useEffect(() => {
    if (view !== "history" || !projectId || !selectedCommit) return;
    let cancelled = false;
    setCommitLoading(true);
    setCommitError(undefined);
    api
      .gitShow(projectId, selectedCommit)
      .then((res) => {
        if (!cancelled) setCommitDetail(res.commit);
      })
      .catch((e) => {
        if (!cancelled) {
          setCommitError((e as Error).message);
          setCommitDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) setCommitLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, projectId, selectedCommit]);

  const stage = async (paths: string[], isStaged: boolean) => {
    setActionError(undefined);
    try {
      if (isStaged) await onUnstage(paths);
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

  const runRemoteAction = async (
    label: string,
    fn: () => Promise<{ output?: string }>,
  ) => {
    if (!projectId || actionBusy) return;
    setActionBusy(label);
    setActionError(undefined);
    setActionNotice(undefined);
    try {
      const result = await fn();
      const note = result.output?.trim();
      setActionNotice(note ? note.slice(0, 240) : `${label} selesai.`);
      await onRefresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const host = splitRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    setResizing(true);
    const onMove = (moveEvent: PointerEvent) => {
      const next = (moveEvent.clientX - rect.left) / rect.width;
      const min = MIN_LEFT / rect.width;
      const max = 1 - MIN_RIGHT / rect.width;
      setSplit(Math.min(Math.max(next, min), max));
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const busy = Boolean(actionBusy) || loading || !projectId;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 flex-wrap items-center gap-1 border-b bg-[var(--tabbar)] px-2">
        <ToolbarButton
          label="Fetch"
          icon={actionBusy === "Fetch" ? <Spinner /> : <CloudDownload />}
          disabled={busy}
          onClick={() =>
            void runRemoteAction("Fetch", () => api.gitFetch(projectId!))
          }
        />
        <ToolbarButton
          label="Pull"
          icon={actionBusy === "Pull" ? <Spinner /> : <ArrowDownToLine />}
          disabled={busy}
          onClick={() => void runRemoteAction("Pull", () => api.gitPull(projectId!))}
        />
        <ToolbarButton
          label="Push"
          icon={actionBusy === "Push" ? <Spinner /> : <ArrowUpFromLine />}
          disabled={busy}
          onClick={() => void runRemoteAction("Push", () => api.gitPush(projectId!))}
        />
        <span className="mx-1 h-4 w-px bg-border" />
        <ToolbarButton
          label="Branch"
          icon={<GitBranchPlus />}
          disabled={busy}
          onClick={() => {
            setBranchName("");
            setBranchOpen(true);
          }}
        />
        <ToolbarButton
          label="Merge"
          icon={<GitMerge />}
          disabled={busy || mergeCandidates.length === 0}
          onClick={() => {
            setMergeBranch(mergeCandidates[0]?.name ?? "");
            setMergeOpen(true);
          }}
        />
        <ToolbarButton
          label="Stash"
          icon={<Archive />}
          disabled={busy || !!status?.clean}
          onClick={() => {
            setStashMessage("");
            setStashOpen(true);
          }}
        />
        <div className="ml-auto flex items-center gap-2">
          {status ? (
            <span className="font-mono text-xs text-muted-foreground">{status.branch}</span>
          ) : null}
          {status && status.ahead > 0 ? (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              ↑{status.ahead}
            </Badge>
          ) : null}
          {status && status.behind > 0 ? (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              ↓{status.behind}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="flex h-9 shrink-0 flex-wrap items-center justify-between gap-2 border-b px-2">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={view === "changes" ? "secondary" : "ghost"}
            className="h-7"
            onClick={() => setView("changes")}
            data-icon="inline-start"
          >
            <FileCode2 />
            File Status
          </Button>
          <Button
            size="sm"
            variant={view === "history" ? "secondary" : "ghost"}
            className="h-7"
            onClick={() => setView("history")}
            data-icon="inline-start"
          >
            <History />
            History
          </Button>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          onClick={() => void onRefresh()}
          disabled={loading || Boolean(actionBusy)}
          data-icon="inline-start"
        >
          {loading ? <Spinner /> : <RefreshCw />}
          Refresh
        </Button>
      </div>

      {error ? <p className="shrink-0 border-b px-3 py-1.5 text-xs text-destructive">{error}</p> : null}
      {actionError ? (
        <p className="shrink-0 border-b px-3 py-1.5 text-xs text-destructive">{actionError}</p>
      ) : null}
      {actionNotice ? (
        <p className="shrink-0 border-b px-3 py-1.5 text-xs text-muted-foreground">{actionNotice}</p>
      ) : null}

      <Dialog open={branchOpen} onOpenChange={setBranchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Branch</DialogTitle>
            <DialogDescription>
              Buat branch lokal baru dari HEAD saat ini, lalu checkout.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="git-branch-name">Nama branch</Label>
            <Input
              id="git-branch-name"
              value={branchName}
              autoFocus
              placeholder="feature/my-change"
              onChange={(e) => setBranchName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && branchName.trim()) {
                  void runRemoteAction("Branch", async () => {
                    await api.gitCreateBranch(projectId!, { name: branchName.trim() });
                    setBranchOpen(false);
                    return { output: `Branch ${branchName.trim()} dibuat.` };
                  });
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBranchOpen(false)}>
              Batal
            </Button>
            <Button
              disabled={!branchName.trim() || Boolean(actionBusy)}
              onClick={() =>
                void runRemoteAction("Branch", async () => {
                  await api.gitCreateBranch(projectId!, { name: branchName.trim() });
                  setBranchOpen(false);
                  return { output: `Branch ${branchName.trim()} dibuat.` };
                })
              }
            >
              Buat & Checkout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge Branch</DialogTitle>
            <DialogDescription>
              Merge branch lokal ke <span className="font-mono">{status?.branch ?? "HEAD"}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label>Branch sumber</Label>
            <Select value={mergeBranch} onValueChange={setMergeBranch}>
              <SelectTrigger aria-label="Branch untuk merge">
                <SelectValue placeholder="Pilih branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {mergeCandidates.map((branch) => (
                    <SelectItem key={branch.name} value={branch.name}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeOpen(false)}>
              Batal
            </Button>
            <Button
              disabled={!mergeBranch || Boolean(actionBusy)}
              onClick={() =>
                void runRemoteAction("Merge", async () => {
                  const result = await api.gitMerge(projectId!, mergeBranch);
                  setMergeOpen(false);
                  return result;
                })
              }
            >
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stashOpen} onOpenChange={setStashOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stash Changes</DialogTitle>
            <DialogDescription>
              Simpan perubahan working tree ke stash (termasuk untracked).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="git-stash-message">Pesan (opsional)</Label>
            <Input
              id="git-stash-message"
              value={stashMessage}
              autoFocus
              placeholder="WIP…"
              onChange={(e) => setStashMessage(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStashOpen(false)}>
              Batal
            </Button>
            <Button
              disabled={Boolean(actionBusy)}
              onClick={() =>
                void runRemoteAction("Stash", async () => {
                  const result = await api.gitStashCreate(projectId!, {
                    message: stashMessage.trim() || undefined,
                  });
                  setStashOpen(false);
                  return result;
                })
              }
            >
              Stash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div
        ref={splitRef}
        className={cn("flex min-h-0 flex-1", resizing && "select-none")}
      >
        <div
          className="flex min-h-0 min-w-0 flex-col border-r"
          style={{ width: `${split * 100}%` }}
        >
          {view === "changes" ? (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <FileSection
                  title="Staged Files"
                  files={staged}
                  staged
                  selected={selected}
                  onSelect={loadDiff}
                  onAction={(paths) => stage(paths, true)}
                  actionLabel="Unstage"
                  onAll={() => stage(staged.map((file) => file.path), true)}
                />
                <FileSection
                  title="Unstaged Files"
                  files={unstaged}
                  selected={selected}
                  onSelect={loadDiff}
                  onAction={(paths) => stage(paths, false)}
                  actionLabel="Stage"
                  onAll={() => stage(unstaged.map((file) => file.path), false)}
                />
                <FileSection
                  title="Untracked Files"
                  files={untracked}
                  selected={selected}
                  onSelect={loadDiff}
                  onAction={(paths) => stage(paths, false)}
                  actionLabel="Stage"
                  onAll={() => stage(untracked.map((file) => file.path), false)}
                />
                {status?.clean ? (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                    Working tree clean — tidak ada perubahan.
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col gap-2 border-t bg-muted/20 p-3">
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={3}
                  placeholder="Commit message…"
                  className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
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
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {commits.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Belum ada commit.
                </p>
              ) : (
                commits.map((commit) => {
                  const active = commit.hash === selectedCommit;
                  return (
                    <button
                      key={commit.hash}
                      type="button"
                      onClick={() => setSelectedCommit(commit.hash)}
                      className={cn(
                        "flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left transition-colors hover:bg-accent/70",
                        active && "bg-accent",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {commit.short}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">{commit.subject}</span>
                        {commit.refs ? (
                          <Badge variant="secondary" className="h-5 max-w-40 truncate text-[10px]">
                            {commit.refs}
                          </Badge>
                        ) : null}
                      </div>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {commit.author} · {commit.date}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div
          onPointerDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize git panes"
          className="group relative flex w-1.5 shrink-0 cursor-col-resize items-stretch justify-center"
        >
          <span
            className={cn(
              "w-px bg-border transition-colors group-hover:bg-primary/60",
              resizing && "bg-primary",
            )}
          />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {view === "changes" ? (
            <>
              <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-muted/30 px-3">
                {selected ? (
                  <>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {selected.path}
                    </span>
                    <Badge variant="outline" className="h-5 text-[10px]">
                      {selected.staged ? "staged" : "working tree"}
                    </Badge>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">Pilih file untuk melihat diff</span>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {diffLoading ? (
                  <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                    <Spinner />
                    Memuat diff…
                  </div>
                ) : diffError ? (
                  <p className="p-3 text-xs text-destructive">{diffError}</p>
                ) : selected ? (
                  <GitDiffView diff={diff} />
                ) : (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    Tidak ada file terpilih.
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex shrink-0 flex-col gap-1 border-b bg-muted/30 px-3 py-2">
                {commitDetail ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {commitDetail.short}
                      </Badge>
                      <span className="min-w-0 flex-1 text-sm font-medium">
                        {commitDetail.subject}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {commitDetail.author} · {commitDetail.date}
                      {commitDetail.refs ? ` · ${commitDetail.refs}` : ""}
                    </span>
                    {commitDetail.body ? (
                      <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-muted-foreground">
                        {commitDetail.body}
                      </pre>
                    ) : null}
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {commitLoading ? "Memuat commit…" : "Pilih commit"}
                  </span>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {commitLoading ? (
                  <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                    <Spinner />
                    Memuat diff…
                  </div>
                ) : commitError ? (
                  <p className="p-3 text-xs text-destructive">{commitError}</p>
                ) : commitDetail?.diff ? (
                  <GitDiffView diff={commitDetail.diff} />
                ) : (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    Tidak ada patch untuk commit ini.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 px-2"
      disabled={disabled}
      onClick={onClick}
      data-icon="inline-start"
      title={label}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

function GitDiffView({ diff }: { diff: string }) {
  return (
    <div className="bg-background py-1 font-mono text-[11px] leading-4">
      {diff.split("\n").map((line, index) => (
        <div
          key={index}
          className={cn(
            "flex whitespace-pre-wrap break-all px-2",
            line.startsWith("+") && !line.startsWith("+++") && "bg-emerald-500/10",
            line.startsWith("-") && !line.startsWith("---") && "bg-red-500/10",
            line.startsWith("@@") && "bg-sky-500/10",
            line.startsWith("diff ") && "mt-2 bg-muted/40 font-semibold",
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
              line.startsWith("@@") && "text-sky-600 dark:text-sky-400",
              !line.startsWith("+") && !line.startsWith("-") && !line.startsWith("@@") &&
                "text-muted-foreground",
            )}
          >
            {line.startsWith("+") || line.startsWith("-") ? line.slice(1) : line}
          </span>
        </div>
      ))}
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
  const isStaged = Boolean(staged);
  return (
    <div className="flex flex-col border-b">
      <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 bg-[var(--sidebar)] px-2 py-1.5">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {title} ({files.length})
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          onClick={onAll}
          data-icon="inline-start"
        >
          {isStaged ? <Minus /> : <Plus />}
          {actionLabel} All
        </Button>
      </div>
      {files.map((file) => {
        const active = selected?.path === file.path && selected.staged === isStaged;
        return (
          <div
            key={`${file.path}:${isStaged ? "s" : "w"}`}
            className={cn(
              "group flex items-center gap-1 px-1 py-0.5 text-xs hover:bg-accent/70",
              active && "bg-accent",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(file, isStaged)}
              className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left"
              title={file.path}
            >
              <span
                className={cn(
                  "w-4 shrink-0 text-center font-mono text-[10px] font-semibold",
                  file.untracked && "text-amber-600 dark:text-amber-400",
                  !file.untracked && isStaged && "text-emerald-600 dark:text-emerald-400",
                  !file.untracked && !isStaged && "text-sky-600 dark:text-sky-400",
                )}
              >
                {file.status.trim() || (file.untracked ? "?" : "M")}
              </span>
              <span className="truncate">{file.path}</span>
            </button>
            <Button
              size="icon"
              variant="ghost"
              className="size-6 shrink-0 opacity-0 group-hover:opacity-100"
              onClick={() => onAction([file.path])}
              aria-label={`${actionLabel} ${file.path}`}
              title={actionLabel}
            >
              {isStaged ? <Minus /> : <Check />}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
