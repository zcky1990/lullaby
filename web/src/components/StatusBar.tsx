import { GitBranch } from "lucide-react";
import type { LspStatusEvent } from "@/lib/lsp";

interface Props {
  projectName?: string;
  workspacePath?: string | null;
  activeTitle?: string;
  branch?: string;
  lspStatus?: LspStatusEvent;
  lspLanguage?: string;
}

function lspLabel(status: LspStatusEvent["status"]): string | null {
  switch (status) {
    case "connecting":
      return "LSP · Connecting";
    case "ready":
      return "LSP · Ready";
    case "error":
      return "LSP · Error";
    default:
      return null;
  }
}

export function StatusBar({
  projectName,
  workspacePath,
  activeTitle,
  branch,
  lspStatus,
  lspLanguage,
}: Props) {
  const lspText = lspStatus ? lspLabel(lspStatus.status) : null;

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between gap-4 bg-[var(--statusbar)] px-3 text-[11px] text-[var(--statusbar-foreground)]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex items-center gap-1">
          <GitBranch className="size-3.5" />
          {branch || "main"}
        </span>
        <span className="truncate opacity-90">{projectName ?? "No project"}</span>
        {workspacePath ? <span className="truncate opacity-75">{workspacePath}</span> : null}
      </div>
      <div className="flex shrink-0 items-center gap-3 opacity-90">
        {activeTitle ? <span className="max-w-48 truncate">{activeTitle}</span> : null}
        {lspText ? (
          <span title={lspStatus?.message} className={lspStatus?.status === "error" ? "opacity-100" : undefined}>
            {lspText}
            {lspLanguage ? ` · ${lspLanguage}` : ""}
          </span>
        ) : null}
        <span>UTF-8</span>
        <span>LF</span>
        <span>Lullaby IDE</span>
      </div>
    </footer>
  );
}
