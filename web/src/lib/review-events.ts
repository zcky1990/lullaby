import type { ChatResponse, PendingFileChange } from "./api";

export const REVIEW_EVENT = "rnd:chat-review";
export const CHAT_RESPONSE_EVENT = "rnd:chat-response";
export const CHANGES_APPLIED_EVENT = "rnd:changes-applied";

export interface ReviewDetail {
  runId: string;
  changes: PendingFileChange[];
}

export function dispatchReview(
  runId: string | null,
  changes: PendingFileChange[] | null,
): void {
  window.dispatchEvent(
    new CustomEvent<ReviewDetail | null>(REVIEW_EVENT, {
      detail: runId && changes?.length ? { runId, changes } : null,
    }),
  );
}

export function dispatchChatResponse(response: ChatResponse): void {
  window.dispatchEvent(new CustomEvent<ChatResponse>(CHAT_RESPONSE_EVENT, { detail: response }));
}

export function dispatchChangesApplied(paths: string[]): void {
  window.dispatchEvent(new CustomEvent<{ paths: string[] }>(CHANGES_APPLIED_EVENT, {
    detail: { paths },
  }));
}
