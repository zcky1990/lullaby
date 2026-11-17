import { GitBranch } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { LspStatusEvent } from "@/lib/lsp";

interface Props {
  projectName?: string;
  workspacePath?: string | null;
  activeTitle?: string;
  branch?: string;
  lspStatus?: LspStatusEvent;
  lspLanguage?: string;
}

function lspLabel(
  status: LspStatusEvent["status"],
  t: (key: string) => string,
): string | null {
  switch (status) {
    case "connecting":
      return t("status.lsp.connecting");
    case "ready":
      return t("status.lsp.ready");
    case "error":
      return t("status.lsp.error");
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
  const { t } = useI18n();
  const lspText = lspStatus ? lspLabel(lspStatus.status, t) : null;

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between gap-4 border-t border-border/50 bg-[var(--activitybar)]/70 px-3 text-[11px] text-muted-foreground backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex items-center gap-1">
          <GitBranch className="size-3.5" />
          {branch || "main"}
        </span>
        <span className="truncate opacity-90">{projectName ?? t("status.noProject")}</span>
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
        <span>Lullaby</span>
      </div>
    </footer>
  );
}
