import { useState } from "react";
import { FileCode2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api, type PendingFileChange } from "@/lib/api";
import { dispatchChatResponse } from "@/lib/review-events";
import { cn } from "@/lib/utils";

/** `pendingChanges[].applied` = perubahan sudah ditulis ke disk (review di akhir). */
type ReviewFileChange = PendingFileChange & { applied?: boolean };

function isAppliedReview(changes: PendingFileChange[]): boolean {
  return changes.length > 0 &&
    changes.every((change) => (change as ReviewFileChange).applied === true);
}

export function ReviewTab({
  runId,
  changes,
}: {
  runId: string;
  changes: PendingFileChange[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const applied = isAppliedReview(changes);

  const decide = async (callId: string, hunk: number, accept: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.chatChange({ runId, callId, hunk, accept });
      dispatchChatResponse(response);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const decideAll = async (accept: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.chatChangeAll({ runId, accept });
      dispatchChatResponse(response);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (changes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-xs text-muted-foreground">
        Tidak ada perubahan yang menunggu review.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-xs font-semibold">
            {applied ? "Review perubahan AI (sudah diterapkan)" : "Review perubahan AI"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {changes.length} file · {applied
              ? "Keep untuk mempertahankan, Revert untuk mengembalikan file ke kondisi sebelum chat"
              : "accept/reject per hunk"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {busy ? <Spinner /> : null}
          <Button size="sm" onClick={() => decideAll(true)} disabled={busy}>
            {applied ? "Keep all" : "Accept all"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => decideAll(false)} disabled={busy}>
            Revert all
          </Button>
        </div>
      </div>

      {error ? <p className="border-b px-4 py-2 text-xs text-destructive">{error}</p> : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-4">
          {changes.map((change) => (
            <div key={change.callId} className="overflow-hidden rounded-md border">
              <div className="flex items-center gap-2 bg-muted/50 px-3 py-2">
                <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{change.path}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {change.action === "create" ? "baru" : "diubah"} · +{change.added} −
                  {change.removed}
                </span>
              </div>

              {change.hunks.map((hunk, index) => (
                <div key={index} className="border-t first:border-t-0">
                  <div className="flex items-center justify-between gap-2 bg-background px-3 py-1.5">
                    <span className="text-[11px] text-muted-foreground">
                      Hunk {index + 1}
                      {hunk.decision !== "pending"
                        ? ` · ${hunk.decision === "accepted" ? "accepted" : "rejected"}`
                        : ""}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant={hunk.decision === "accepted" ? "secondary" : "ghost"}
                        className="h-7 px-2 text-xs"
                        disabled={busy || hunk.decision === "accepted"}
                        onClick={() => decide(change.callId, index, true)}
                      >
                        {applied ? "Keep" : "Accept"}
                      </Button>
                      <Button
                        size="sm"
                        variant={hunk.decision === "rejected" ? "destructive" : "ghost"}
                        className="h-7 px-2 text-xs"
                        disabled={busy || hunk.decision === "rejected"}
                        onClick={() => decide(change.callId, index, false)}
                      >
                        {applied ? "Revert" : "Reject"}
                      </Button>
                    </div>
                  </div>
                  <div className="bg-background py-1 font-mono text-xs leading-5">
                    {hunk.lines.map((line, lineIndex) => (
                      <div
                        key={lineIndex}
                        className={cn(
                          "flex",
                          line.type === "+" && "bg-emerald-500/10",
                          line.type === "-" && "bg-red-500/10",
                        )}
                      >
                        <span className="w-10 shrink-0 pr-2 text-right text-muted-foreground/60 select-none">
                          {line.oldLine ?? ""}
                        </span>
                        <span className="w-10 shrink-0 pr-2 text-right text-muted-foreground/60 select-none">
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
                        <span className="min-w-0 whitespace-pre-wrap break-all pr-3">
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
    </div>
  );
}
