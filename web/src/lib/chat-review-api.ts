import type { PendingFileChange } from "@/lib/api";

export type ChatReviewStatus = "running" | "review" | "interrupted";

/** `applied` = perubahan sudah ditulis ke disk (review di akhir / setelah restart). */
export type ReviewFileChange = PendingFileChange & { applied?: boolean };

export interface ChatReviewRun {
  runId: string;
  sessionId: string;
  projectId: string;
  status: ChatReviewStatus;
  interrupted: boolean;
  reviewDeferred: boolean;
  createdAt: number;
  finishedAt: number | null;
  pendingChanges: ReviewFileChange[];
}

async function requestRun(path: string): Promise<ChatReviewRun | null> {
  const res = await fetch(path);
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const error = (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new Error(error);
  }
  return (data as { run?: ChatReviewRun | null } | null)?.run ?? null;
}

/** State review satu run, dibaca dari `chat_runs` (sumber data tab Review). */
export function fetchChatReview(runId: string): Promise<ChatReviewRun | null> {
  return requestRun(`/api/chat/review?runId=${encodeURIComponent(runId)}`);
}

/** Run review terbaru milik project — dipakai untuk memulihkan tab setelah restart. */
export function fetchProjectChatReview(projectId: string): Promise<ChatReviewRun | null> {
  return requestRun(`/api/projects/${encodeURIComponent(projectId)}/chat/review`);
}
