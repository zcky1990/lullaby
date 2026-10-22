import { GitBranch } from "lucide-react";

interface Props {
  projectName?: string;
  workspacePath?: string | null;
  activeTitle?: string;
}

export function StatusBar({ projectName, workspacePath, activeTitle }: Props) {
  return (
    <footer className="flex h-6 shrink-0 items-center justify-between gap-4 bg-[var(--statusbar)] px-3 text-[11px] text-[var(--statusbar-foreground)]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex items-center gap-1">
          <GitBranch className="size-3.5" />
          main
        </span>
        <span className="truncate opacity-90">{projectName ?? "No project"}</span>
        {workspacePath ? <span className="truncate opacity-75">{workspacePath}</span> : null}
      </div>
      <div className="flex shrink-0 items-center gap-3 opacity-90">
        {activeTitle ? <span className="max-w-48 truncate">{activeTitle}</span> : null}
        <span>UTF-8</span>
        <span>LF</span>
        <span>RND Workflow</span>
      </div>
    </footer>
  );
}
