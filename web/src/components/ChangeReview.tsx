import { FileCode2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PendingFileChange } from "@/lib/api";

interface Props {
  changes: PendingFileChange[];
  busy: boolean;
  onDecision: (callId: string, hunk: number, accept: boolean) => void;
  onAll: (accept: boolean) => void;
}

export function ChangeReview({ changes, busy, onDecision, onAll }: Props) {
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium">Perubahan dari AI</p>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" onClick={() => onAll(true)} disabled={busy}>
            Accept all
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAll(false)} disabled={busy}>
            Revert all
          </Button>
        </div>
      </div>

      <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
        {changes.map((change) => (
          <div key={change.callId} className="overflow-hidden rounded-md border">
            <div className="flex items-center gap-2 bg-muted/50 px-2 py-1">
              <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{change.path}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {change.action === "create" ? "baru" : "diubah"} · +{change.added} −{change.removed}
              </span>
            </div>

            {change.hunks.map((hunk, index) => (
              <div key={index} className="border-t first:border-t-0">
                <div className="flex items-center justify-between gap-2 bg-background px-2 py-1">
                  <span className="text-[10px] text-muted-foreground">
                    Hunk {index + 1}
                    {hunk.decision !== "pending"
                      ? ` · ${hunk.decision === "accepted" ? "accepted" : "rejected"}`
                      : ""}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant={hunk.decision === "accepted" ? "secondary" : "ghost"}
                      className="h-6 px-2 text-[11px]"
                      disabled={busy || hunk.decision === "accepted"}
                      onClick={() => onDecision(change.callId, index, true)}
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant={hunk.decision === "rejected" ? "destructive" : "ghost"}
                      className="h-6 px-2 text-[11px]"
                      disabled={busy || hunk.decision === "rejected"}
                      onClick={() => onDecision(change.callId, index, false)}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto bg-background py-1 font-mono text-[11px] leading-4">
                  {hunk.lines.map((line, lineIndex) => (
                    <div
                      key={lineIndex}
                      className={cn(
                        "flex",
                        line.type === "+" && "bg-emerald-500/10",
                        line.type === "-" && "bg-red-500/10",
                      )}
                    >
                      <span className="w-8 shrink-0 pr-1 text-right text-muted-foreground/60 select-none">
                        {line.oldLine ?? ""}
                      </span>
                      <span className="w-8 shrink-0 pr-1 text-right text-muted-foreground/60 select-none">
                        {line.newLine ?? ""}
                      </span>
                      <span
                        className={cn(
                          "w-4 shrink-0 text-center select-none",
                          line.type === "+" && "text-emerald-600 dark:text-emerald-400",
                          line.type === "-" && "text-red-600 dark:text-red-400",
                        )}
                      >
                        {line.type === " " ? "" : line.type}
                      </span>
                      <span className="min-w-0 whitespace-pre-wrap break-all pr-2">
                        {line.text || " "}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
