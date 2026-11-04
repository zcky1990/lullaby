import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  Kanban,
  KanbanBoard,
  KanbanColumn,
  KanbanColumnContent,
  KanbanItem,
  KanbanItemHandle,
  KanbanOverlay,
} from "@/components/reui/kanban";
import { Badge } from "@/components/ui/badge";
import type { TicketSummary } from "@/lib/api";
import { CANONICAL_COLUMNS, canonicalTicketColumn } from "@/lib/ticket-columns";
import { cn } from "@/lib/utils";

export type TicketColumns = Record<string, TicketSummary[]>;

interface Board {
  columns: TicketColumns;
  target: Record<string, string>;
}

function buildBoard(tickets: TicketSummary[]): Board {
  const columns: TicketColumns = {};
  const target: Record<string, string> = {};

  for (const column of CANONICAL_COLUMNS) columns[column.title] = [];

  for (const ticket of tickets) {
    const column = canonicalTicketColumn(ticket.status);
    (columns[column] ??= []).push(ticket);
    if (!target[column] && ticket.status) target[column] = ticket.status;
  }

  for (const column of CANONICAL_COLUMNS) {
    if (!target[column.title]) target[column.title] = column.title;
  }

  return { columns, target };
}

function priorityTone(priority?: string): string {
  const value = priority?.toLowerCase() ?? "";
  if (value.includes("urgent") || value.includes("highest") || value.includes("critical")) {
    return "border-destructive/40 text-destructive";
  }
  if (value.includes("high")) return "border-orange-500/40 text-orange-600 dark:text-orange-400";
  if (value.includes("low") || value.includes("lowest")) {
    return "border-muted-foreground/30 text-muted-foreground";
  }
  return "";
}

interface Props {
  tickets: TicketSummary[];
  onMove: (key: string, fromStatus: string, toStatus: string) => Promise<void>;
  onOpenDetail: (ticket: TicketSummary) => void;
  onError: (message: string) => void;
}

export function TicketKanban({ tickets, onMove, onOpenDetail, onError }: Props) {
  const board = useMemo(() => buildBoard(tickets), [tickets]);
  const [columns, setColumns] = useState<TicketColumns>(() => buildBoard(tickets).columns);

  useEffect(() => {
    setColumns(board.columns);
  }, [board]);

  return (
    <Kanban
      value={columns}
      onValueChange={setColumns}
      getItemValue={(ticket) => ticket.key}
      className="flex h-full min-h-0 flex-col"
      onValueCommit={async (next, meta) => {
        if (meta.kind === "column") {
          setColumns(next);
          return;
        }
        if (meta.overContainer === meta.activeContainer) return;
        const previous = meta.previousValue;
        try {
          await onMove(
            String(meta.event.active.id),
            meta.activeContainer,
            board.target[meta.overContainer] ?? meta.overContainer,
          );
        } catch (error) {
          setColumns(previous);
          onError((error as Error).message);
        }
      }}
    >
      <KanbanBoard className="flex h-full min-h-0 items-stretch gap-3 overflow-x-auto pb-1">
        {Object.entries(columns).map(([status, items]) => (
          <KanbanColumn
            key={status}
            value={status}
            className="bg-muted/25 flex h-full w-72 shrink-0 flex-col overflow-hidden rounded-lg border"
          >
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
              <span className="truncate text-xs font-semibold">{status}</span>
              <Badge variant="secondary" className="tabular-nums">
                {items.length}
              </Badge>
            </div>
            <KanbanColumnContent
              value={status}
              className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2"
            >
              {items.length === 0 ? (
                <div className="text-muted-foreground/60 flex min-h-24 flex-1 items-center justify-center rounded-md border border-dashed text-xs">
                  Kosong
                </div>
              ) : null}
              {items.map((ticket) => (
                <KanbanItem key={ticket.key} value={ticket.key}>
                  <KanbanItemHandle>
                    <button
                      type="button"
                      onClick={() => onOpenDetail(ticket)}
                      className={cn(
                        "bg-card hover:bg-accent/40 flex w-full cursor-grab flex-col gap-2 rounded-md border p-3 text-left shadow-sm transition-colors active:cursor-grabbing",
                        "focus-visible:ring-ring outline-none focus-visible:ring-2",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {ticket.key}
                        </span>
                        <div className="flex max-w-[55%] flex-wrap justify-end gap-1">
                          {ticket.source === "local" && ticket.syncStatus !== "synced" ? (
                            <Badge
                              variant={ticket.syncStatus === "error" ? "destructive" : "secondary"}
                              className="h-5 px-1.5 text-[10px]"
                            >
                              {ticket.syncStatus === "error" ? "Sync error" : "Local"}
                            </Badge>
                          ) : null}
                          {ticket.priority ? (
                            <Badge
                              variant="outline"
                              className={cn("h-5 px-1.5 text-[10px]", priorityTone(ticket.priority))}
                            >
                              {ticket.priority}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <p className="line-clamp-3 text-xs leading-snug font-medium">
                        {ticket.summary}
                      </p>
                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">{ticket.assignee ?? "Tanpa assignee"}</span>
                        {ticket.url ? (
                          <a
                            href={ticket.url}
                            target="_blank"
                            rel="noreferrer"
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex shrink-0 items-center gap-1 hover:text-foreground"
                          >
                            <ExternalLink className="size-3" />
                            {ticket.source === "clickup"
                              ? "ClickUp"
                              : ticket.source === "local" && ticket.syncProvider === "clickup"
                              ? "ClickUp"
                              : "Jira"}
                          </a>
                        ) : ticket.source === "local" ? (
                          <span className="shrink-0">Belum sync</span>
                        ) : null}
                      </div>
                    </button>
                  </KanbanItemHandle>
                </KanbanItem>
              ))}
            </KanbanColumnContent>
          </KanbanColumn>
        ))}
      </KanbanBoard>
      <KanbanOverlay>
        <div className="bg-muted/20 size-full rounded-md border-2 border-dashed border-primary/40" />
      </KanbanOverlay>
    </Kanban>
  );
}
