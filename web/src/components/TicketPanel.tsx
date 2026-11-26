import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { TicketPanelProps } from "@/components/tickets/TicketPanel";

/**
 * Lazy boundary (PERF-9). Implementasi panel tiket (±3 KB, Select + i18n)
 * dipisah ke `components/tickets/TicketPanel.tsx` lalu dimuat saat menu Ticket
 * dibuka, jadi tidak ikut chunk utama. Call site di `App.tsx` tidak berubah.
 */
export type { TicketPanelProps };

const TicketPanelImpl = lazy(() =>
  import("@/components/tickets/TicketPanel").then((module) => ({ default: module.TicketPanel }))
);

export function TicketPanel(props: TicketPanelProps) {
  return (
    <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
      <TicketPanelImpl {...props} />
    </Suspense>
  );
}
