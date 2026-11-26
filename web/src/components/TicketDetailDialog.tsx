import { lazy, Suspense } from "react";
import type { TicketDetailDialogProps } from "@/components/tickets/TicketDetailDialog";

/**
 * Lazy boundary (PERF-9). Implementasi dialog detail tiket (±21 KB: RichTextEditor,
 * sanitize-html, 3 Select, aksi sync/delete) dipisah ke
 * `components/tickets/TicketDetailDialog.tsx`. Dialog tidak di-mount sebelum
 * dibuka, jadi chunk baru diunduh saat tiket pertama kali diklik.
 */
export type { TicketDetailDialogProps };

const TicketDetailDialogImpl = lazy(() =>
  import("@/components/tickets/TicketDetailDialog").then((module) => ({
    default: module.TicketDetailDialog,
  }))
);

export function TicketDetailDialog(props: TicketDetailDialogProps) {
  if (!props.open) return null;
  return (
    <Suspense fallback={null}>
      <TicketDetailDialogImpl {...props} />
    </Suspense>
  );
}
