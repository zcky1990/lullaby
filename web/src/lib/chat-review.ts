import type { ChatResponse, PendingFileChange } from "./api";
import { describeChanges, summarizeChanges } from "./chat-changes";

export interface DeferredReview {
  runId: string;
  changes: PendingFileChange[];
}

/**
 * Ambil review yang ditawarkan setelah chat selesai (mode non-blok).
 * `null` bila respons bukan `done` atau tidak membawa perubahan untuk direview.
 */
export function readDeferredReview(
  response: ChatResponse | null | undefined,
): DeferredReview | null {
  if (!response || response.status !== "done") return null;
  const deferred = response;
  const runId = deferred.runId?.trim() ?? "";
  if (!deferred.reviewDeferred || !runId) return null;
  const changes = deferred.pendingChanges ?? [];
  if (changes.length === 0) return null;
  return { runId, changes };
}

export function countPendingHunks(changes: PendingFileChange[] | null | undefined): number {
  return (changes ?? []).reduce((total, change) => total + (change.hunks?.length ?? 0), 0);
}

/** Ringkasan ringkas, mis. "2 file (1 baru, 1 diubah) · +12 · −3". */
export function describeDeferredReview(
  changes: PendingFileChange[] | null | undefined,
): string {
  const summary = summarizeChanges(
    (changes ?? []).map((change) => ({
      path: change.path,
      action: change.action,
      added: change.added,
      removed: change.removed,
      diff: "",
    })),
  );
  if (summary.files.length === 0) return "";
  const label = summary.files.length === 1 ? "1 file" : `${summary.files.length} file`;
  const detail = describeChanges(summary);
  return [
    detail ? `${label} (${detail})` : label,
    `+${summary.added}`,
    `−${summary.removed}`,
  ].join(" · ");
}

/** true bila semua hunk pada satu file sudah diputuskan (accepted/rejected). */
export function isChangeSettled(change: PendingFileChange): boolean {
  return (change.hunks ?? []).every((hunk) => hunk.decision !== "pending");
}
