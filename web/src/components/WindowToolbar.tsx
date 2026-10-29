import { MessageSquare, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  projectName?: string;
  workspace?: string | null;
  chatOpen: boolean;
  onToggleChat: () => void;
}

export function WindowToolbar({ projectName, workspace, chatOpen, onToggleChat }: Props) {
  return (
    <div className="window-toolbar flex h-[52px] shrink-0 items-center justify-between border-b border-border/50 bg-[var(--activitybar)]/80 pr-3 backdrop-blur-2xl">
      <div className="flex min-w-0 items-center gap-3 px-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-sm ring-1 ring-black/5">
          <Sparkles className="size-4" />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-semibold tracking-tight">
            {projectName ?? "Lullaby IDE"}
          </span>
          <span className="truncate text-[10px] text-muted-foreground">
            {workspace ?? "No workspace"}
          </span>
        </div>
      </div>

      <Button
        size="icon"
        variant="ghost"
        onClick={onToggleChat}
        className={cn(
          "size-9 rounded-full border border-transparent transition-all",
          chatOpen
            ? "border-primary/20 bg-primary/10 text-primary shadow-sm hover:bg-primary/15"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
        aria-label="Chat"
        title="Chat"
        aria-pressed={chatOpen}
      >
        <MessageSquare className="size-4" />
      </Button>
    </div>
  );
}
