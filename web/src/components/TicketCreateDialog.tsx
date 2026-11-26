import { lazy, Suspense } from "react";
import type { TicketCreateDialogProps } from "@/components/tickets/TicketCreateDialog";

/**
 * Lazy boundary (PERF-9). Implementasi dialog buat tiket (±7 KB: RichTextEditor
 * + 3 Select) dipisah ke `components/tickets/TicketCreateDialog.tsx`. Dialog
 * tidak di-mount sebelum dibuka, jadi chunk baru diunduh saat tombol + ditekan.
 */
export type { TicketCreateDialogProps };

const TicketCreateDialogImpl = lazy(() =>
  import("@/components/tickets/TicketCreateDialog").then((module) => ({
    default: module.TicketCreateDialog,
  }))
);

export function TicketCreateDialog(props: TicketCreateDialogProps) {
  if (!props.open) return null;
  return (
    <Suspense fallback={null}>
      <TicketCreateDialogImpl {...props} />
    </Suspense>
  );
}
