import type { MessageDict } from "../../types";

/** Review perubahan hasil chat. */
export const review: MessageDict = {
  "review.tab.loading": "Loading review state from the server…",
  "review.tab.empty": "No changes waiting for review.",
  "review.tab.reload": "Reload",
  "review.tab.reloadTitle": "Reload review state from the server",
  "review.tab.title": "AI change review",
  "review.tab.titleApplied": "AI change review (already applied)",
  "review.tab.meta": "{count} file(s) · {mode}",
  "review.tab.keepHint": "Keep to retain, Revert to restore the files to their pre-chat state",
  "review.tab.hunkHint": "accept/reject per hunk",
  "review.tab.fromServer": " · data from server",
  "review.tab.keepAll": "Keep all",
  "review.tab.acceptAll": "Accept all",
  "review.tab.revertAll": "Revert all",
  "review.tab.interrupted.title": "Run interrupted.",
  "review.tab.interrupted.before": "The app stopped while the chat was still running (status ",
  "review.tab.interrupted.after":
    "), but the following changes are already written to disk — Keep/Revert still works.",
  "review.tab.action.create": "new",
  "review.tab.action.update": "modified",
  "review.tab.hunk": "Hunk {index}",
  "review.tab.decision": " · {decision}",
  "review.tab.decision.accepted": "accepted",
  "review.tab.decision.rejected": "rejected",
  "review.tab.keep": "Keep",
  "review.tab.accept": "Accept",
  "review.tab.revert": "Revert",
  "review.tab.reject": "Reject",
};
