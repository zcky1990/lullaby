import { Suspense, lazy } from "react";
import type { TicketSummary } from "@/lib/api";

export type { TicketColumns } from "@/components/TicketKanbanBoard";

// PERF-7: @dnd-kit + @base-ui (lewat komponen kanban ReUI) hanya dibutuhkan saat
// tab Ticket dibuka, jadi board-nya dimuat lazy di sini dan shell cukup memakai
// nama `TicketKanban` seperti sebelumnya.
const TicketKanbanBoard = lazy(() =>
  import("@/components/TicketKanbanBoard").then((module) => ({
    default: module.TicketKanbanBoard,
  }))
);

interface Props {
  tickets: TicketSummary[];
  onMove: (key: string, fromStatus: string, toStatus: string) => Promise<void>;
  onOpenDetail: (ticket: TicketSummary) => void;
  onError: (message: string) => void;
}

export function TicketKanban(props: Props) {
  return (
    <Suspense fallback={<div className="h-full w-full" />}>
      <TicketKanbanBoard {...props} />
    </Suspense>
  );
}
