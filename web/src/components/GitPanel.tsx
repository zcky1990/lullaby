import { useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Cloud,
  GitBranch as GitBranchIcon,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/PanelHeader";
import { Spinner } from "@/components/ui/spinner";
import type { GitBranch, GitRemoteBranch, GitStash, GitStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  status: GitStatus | null;
  branches: GitBranch[];
  remotes: GitRemoteBranch[];
  stashes: GitStash[];
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onCheckout: (branch: string) => void;
  onApplyStash: (index: number, pop?: boolean) => void;
}

export function GitPanel({
  status,
  branches,
  remotes,
  stashes,
  loading,
  error,
  onRefresh,
  onCheckout,
  onApplyStash,
}: Props) {
  const [remotesOpen, setRemotesOpen] = useState(true);
  const [stashesOpen, setStashesOpen] = useState(true);
  const [openRemotes, setOpenRemotes] = useState<Record<string, boolean>>({});

  const changes = status
    ? status.staged.length + status.unstaged.length + status.untracked.length
    : 0;

  const remoteGroups = useMemo(() => {
    const groups = new Map<string, GitRemoteBranch[]>();
    for (const branch of remotes) {
      const list = groups.get(branch.remote) ?? [];
      list.push(branch);
      groups.set(branch.remote, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [remotes]);

  const isRemoteOpen = (name: string) => openRemotes[name] ?? true;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between pr-1">
        <PanelHeader title="Git" count={status ? changes : undefined} />
        <Button
          size="icon"
          variant="ghost"
          className="mr-2 size-7 shrink-0"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh git"
          title="Refresh"
        >
          {loading ? <Spinner /> : <RefreshCw />}
        </Button>
      </div>

      {error ? (
        <div className="flex flex-col gap-1 px-3 pb-3">
          <p className="text-xs text-destructive">{error}</p>
          <p className="text-[11px] text-muted-foreground">
            Pastikan git terpasang dan workspace menunjuk ke folder di dalam repository (bukan
            folder induk).
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b px-3 py-2">
            <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              Workspace
            </span>
            <div className="mt-1.5 flex min-w-0 items-center gap-2">
              <GitBranchIcon className="size-3.5 shrink-0 text-primary" />
              <span className="truncate font-mono text-xs font-medium">
                {status?.branch ?? "—"}
              </span>
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
            {status?.clean ? (
              <p className="mt-1 text-[11px] text-muted-foreground">Working tree clean</p>
            ) : status ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {status.staged.length} staged · {status.unstaged.length} unstaged ·{" "}
                {status.untracked.length} untracked
              </p>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            <SectionLabel>Branches</SectionLabel>
            <div className="px-1">
              {branches.length === 0 ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">Belum ada branch lokal.</p>
              ) : (
                branches.map((branch) => (
                  <button
                    key={branch.name}
                    type="button"
                    onClick={() => {
                      if (branch.current) return;
                      if (confirm(`Checkout branch "${branch.name}"?`)) onCheckout(branch.name);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-accent",
                      branch.current && "bg-accent",
                    )}
                    title={branch.current ? "Branch aktif" : `Checkout ${branch.name}`}
                  >
                    <GitBranchIcon
                      className={cn(
                        "size-3.5 shrink-0",
                        branch.current ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                    <span className="truncate font-mono text-xs">{branch.name}</span>
                    {branch.current ? (
                      <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
                        HEAD
                      </Badge>
                    ) : null}
                  </button>
                ))
              )}
            </div>

            <SectionToggle
              open={remotesOpen}
              onToggle={() => setRemotesOpen((value) => !value)}
              icon={<Cloud className="size-3.5" />}
              label="Remotes"
              count={remotes.length}
            />
            {remotesOpen ? (
              <div className="px-1 pb-1">
                {remoteGroups.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    Belum ada remote branch (fetch dulu).
                  </p>
                ) : (
                  remoteGroups.map(([remoteName, items]) => (
                    <div key={remoteName} className="mb-1">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenRemotes((current) => ({
                            ...current,
                            [remoteName]: !isRemoteOpen(remoteName),
                          }))
                        }
                        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent/60"
                      >
                        {isRemoteOpen(remoteName) ? (
                          <ChevronDown className="size-3.5 shrink-0" />
                        ) : (
                          <ChevronRight className="size-3.5 shrink-0" />
                        )}
                        <Cloud className="size-3 shrink-0" />
                        <span className="truncate font-mono font-medium text-foreground">
                          {remoteName}
                        </span>
                        <span className="ml-auto text-[10px]">{items.length}</span>
                      </button>
                      {isRemoteOpen(remoteName)
                        ? items.map((branch) => (
                          <button
                            key={branch.name}
                            type="button"
                            onClick={() => {
                              if (
                                confirm(
                                  `Checkout remote "${branch.name}" sebagai branch lokal "${branch.shortName}"?`,
                                )
                              ) {
                                onCheckout(branch.name);
                              }
                            }}
                            className="flex w-full items-center gap-2 rounded-md py-1 pr-2 pl-7 text-left text-sm transition-colors hover:bg-accent"
                            title={`Checkout ${branch.name}`}
                          >
                            <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate font-mono text-xs">{branch.shortName}</span>
                          </button>
                        ))
                        : null}
                    </div>
                  ))
                )}
              </div>
            ) : null}

            <SectionToggle
              open={stashesOpen}
              onToggle={() => setStashesOpen((value) => !value)}
              icon={<Archive className="size-3.5" />}
              label="Stashes"
              count={stashes.length}
            />
            {stashesOpen ? (
              <div className="px-1 pb-1">
                {stashes.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted-foreground">Tidak ada stash.</p>
                ) : (
                  stashes.map((stash) => (
                    <button
                      key={stash.label}
                      type="button"
                      onClick={() => {
                        if (confirm(`Apply ${stash.label}?\n\n${stash.message}`)) {
                          onApplyStash(stash.index, false);
                        }
                      }}
                      className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                      title={`Apply ${stash.label}`}
                    >
                      <div className="flex items-center gap-2">
                        <Archive className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {stash.label}
                        </span>
                      </div>
                      <span className="truncate pl-5 text-xs">{stash.message}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="sticky top-0 z-[1] bg-[var(--sidebar)] px-3 py-1.5">
      <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        {children}
      </span>
    </div>
  );
}

function SectionToggle({
  open,
  onToggle,
  icon,
  label,
  count,
}: {
  open: boolean;
  onToggle: () => void;
  icon: ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="sticky top-0 z-[1] flex w-full items-center gap-1.5 bg-[var(--sidebar)] px-3 py-1.5 text-left hover:bg-accent/40"
    >
      {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <span className="ml-auto text-[10px] text-muted-foreground">{count}</span>
    </button>
  );
}
