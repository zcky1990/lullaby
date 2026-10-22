import { GitBranch as GitBranchIcon, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/PanelHeader";
import { Spinner } from "@/components/ui/spinner";
import type { GitBranch, GitStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  status: GitStatus | null;
  branches: GitBranch[];
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onCheckout: (branch: string) => void;
}

export function GitPanel({
  status,
  branches,
  loading,
  error,
  onRefresh,
  onCheckout,
}: Props) {
  const changes = status
    ? status.staged.length + status.unstaged.length + status.untracked.length
    : 0;

  return (
    <>
      <PanelHeader title="Git" count={status ? changes : undefined} />

      <div className="flex flex-col gap-3 px-3 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono text-xs">{status?.branch ?? "—"}</span>
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
          <Button
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh git"
            title="Refresh"
          >
            {loading ? <Spinner /> : <RefreshCw />}
          </Button>
        </div>

        {error ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-destructive">{error}</p>
            <p className="text-[11px] text-muted-foreground">
              Pastikan git terpasang dan workspace menunjuk ke folder di dalam repository (bukan
              folder induk).
            </p>
          </div>
        ) : null}

        {!error ? (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Branches
            </span>
            {branches.length === 0 ? (
              <p className="text-xs text-muted-foreground">Belum ada branch.</p>
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
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
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
                  <span className="truncate">{branch.name}</span>
                  {branch.current ? (
                    <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
                      current
                    </Badge>
                  ) : null}
                </button>
              ))
            )}
          </div>
        ) : null}

        {status?.clean ? (
          <p className="text-[11px] text-muted-foreground">Working tree bersih.</p>
        ) : null}
      </div>
    </>
  );
}
