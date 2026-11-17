import { useCallback, useEffect, useState } from "react";
import { CircleAlert, FileCode2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api, type PendingFileChange } from "@/lib/api";
import {
  type ChatReviewRun,
  fetchChatReview,
  type ReviewFileChange,
} from "@/lib/chat-review-api";
import { dispatchChatResponse } from "@/lib/review-events";
import { cn } from "@/lib/utils";

/**
 * Tab Review. Datanya dibaca dari API (`GET /api/chat/review?runId=` →
 * tabel `chat_runs`), bukan dari state stream chat, sehingga tetap tersedia
 * setelah aplikasi restart/crash.
 */
export function ReviewTab({
  runId,
  changes,
}: {
  runId: string;
  changes?: PendingFileChange[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [review, setReview] = useState<ChatReviewRun | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchChatReview(runId);
      setReview(data);
    } catch (e) {
      setReview(undefined);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    setReview(undefined);
    setError(undefined);
    void load();
  }, [load]);

  const items: ReviewFileChange[] = review === undefined
    ? (changes ?? [])
    : review?.pendingChanges ?? [];
  const applied = items.length > 0 && items.every((change) => change.applied === true);
  const interrupted = review?.interrupted === true;

  const applyDecision = async (work: () => Promise<Awaited<ReturnType<typeof api.chatChange>>>) => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await work();
      dispatchChatResponse(response);
      if (response.status === "error") setError(response.error);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      await load();
    }
  };

  const decide = (callId: string, hunk: number, accept: boolean) =>
    applyDecision(() => api.chatChange({ runId, callId, hunk, accept }));

  const decideAll = (accept: boolean) => applyDecision(() => api.chatChangeAll({ runId, accept }));

  if (loading && items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-2 p-8 text-xs text-muted-foreground">
        <Spinner />
        Memuat state review dari server…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-xs text-muted-foreground">
        <p>Tidak ada perubahan yang menunggu review.</p>
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => void load()}>
          <RefreshCw className="size-3" />
          Muat ulang
        </Button>
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
            {items.length} file · {applied
              ? "Keep untuk mempertahankan, Revert untuk mengembalikan file ke kondisi sebelum chat"
              : "accept/reject per hunk"}
            {review ? " · data dari server" : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {busy || loading ? <Spinner /> : null}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => void load()}
            disabled={busy}
            title="Muat ulang state review dari server"
          >
            <RefreshCw className="size-3" />
            Muat ulang
          </Button>
          <Button size="sm" onClick={() => decideAll(true)} disabled={busy}>
            {applied ? "Keep all" : "Accept all"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => decideAll(false)} disabled={busy}>
            Revert all
          </Button>
        </div>
      </div>

      {interrupted ? (
        <div className="flex items-start gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <p>
            <span className="font-medium">Run terputus.</span>{" "}
            Aplikasi berhenti saat chat masih berjalan (status <code>interrupted</code>), tetapi
            perubahan berikut sudah tertulis di disk — Keep/Revert tetap bisa dilakukan.
          </p>
        </div>
      ) : null}

      {error ? <p className="border-b px-4 py-2 text-xs text-destructive">{error}</p> : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-4">
          {items.map((change) => (
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
