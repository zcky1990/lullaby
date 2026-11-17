import type { MessageDict } from "../../types";

/** Review perubahan hasil chat. */
export const review: MessageDict = {
  "review.tab.loading": "Memuat state review dari server…",
  "review.tab.empty": "Tidak ada perubahan yang menunggu review.",
  "review.tab.reload": "Muat ulang",
  "review.tab.reloadTitle": "Muat ulang state review dari server",
  "review.tab.title": "Review perubahan AI",
  "review.tab.titleApplied": "Review perubahan AI (sudah diterapkan)",
  "review.tab.meta": "{count} file · {mode}",
  "review.tab.keepHint":
    "Keep untuk mempertahankan, Revert untuk mengembalikan file ke kondisi sebelum chat",
  "review.tab.hunkHint": "accept/reject per hunk",
  "review.tab.fromServer": " · data dari server",
  "review.tab.keepAll": "Keep all",
  "review.tab.acceptAll": "Accept all",
  "review.tab.revertAll": "Revert all",
  "review.tab.interrupted.title": "Run terputus.",
  "review.tab.interrupted.before": "Aplikasi berhenti saat chat masih berjalan (status ",
  "review.tab.interrupted.after":
    "), tetapi perubahan berikut sudah tertulis di disk — Keep/Revert tetap bisa dilakukan.",
  "review.tab.action.create": "baru",
  "review.tab.action.update": "diubah",
  "review.tab.hunk": "Hunk {index}",
  "review.tab.decision": " · {decision}",
  "review.tab.decision.accepted": "accepted",
  "review.tab.decision.rejected": "rejected",
  "review.tab.keep": "Keep",
  "review.tab.accept": "Accept",
  "review.tab.revert": "Revert",
  "review.tab.reject": "Reject",
};
