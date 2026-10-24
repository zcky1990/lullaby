import { useMemo, useState } from "react";
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
import { Card, CardContent } from "@/components/ui/card";
import type { TicketSummary } from "@/lib/api";
import { CANONICAL_COLUMNS, canonicalTicketColumn } from "@/lib/ticket-columns";

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

interface Props {
  tickets: TicketSummary[];
  onMove: (key: string, fromStatus: string, toStatus: string) => Promise<void>;
  onOpenDetail: (ticket: TicketSummary) => void;
  onError: (message: string) => void;
}

export function TicketKanban({ tickets, onMove, onOpenDetail, onError }: Props) {
  const [columns, setColumns] = useState<TicketColumns>(() => buildBoard(tickets).columns);
  const targets = useMemo(() => buildBoard(tickets).target, [tickets]);

  return (
    <Kanban
      value={columns}
      onValueChange={setColumns}
      getItemValue={(ticket) => ticket.key}
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
            targets[meta.overContainer] ?? meta.overContainer,
          );
        } catch (error) {
          setColumns(previous);
          onError((error as Error).message);
        }
      }}
    >
      <KanbanBoard className="flex h-full items-start gap-4 overflow-x-auto pb-4">
        {Object.entries(columns).map(([status, items]) => (
          <KanbanColumn
            key={status}
            value={status}
            className="flex w-72 shrink-0 flex-col rounded-lg border bg-muted/20"
          >
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-semibold">{status}</span>
              <Badge variant="outline">{items.length}</Badge>
            </div>
            <KanbanColumnContent
              value={status}
              className="flex min-h-[140px] flex-col gap-2 p-2"
            >
              {items.length === 0 && (
                <div className="text-muted-foreground/60 flex min-h-[120px] items-center justify-center rounded-md border border-dashed text-xs">
                  Kosong
                </div>
              )}
              {items.map((ticket) => (
                <KanbanItem key={ticket.key} value={ticket.key}>
                  <KanbanItemHandle>
                    <Card
                      onClick={() => onOpenDetail(ticket)}
                      className="h-[108px] cursor-grab overflow-hidden shadow-sm active:cursor-grabbing"
                    >
                      <CardContent className="flex h-full flex-col justify-between py-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {ticket.key}
                          </span>
                          <div className="flex items-center gap-1">
                            {ticket.source === "local" && ticket.syncStatus !== "synced" && (
                              <Badge
                                variant={ticket.syncStatus === "error" ? "destructive" : "secondary"}
                                className="h-5 px-1.5 text-[10px]"
                              >
                                {ticket.syncStatus === "error" ? "Sync error" : "Local"}
                              </Badge>
                            )}
                            {ticket.priority && (
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                {ticket.priority}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <p className="line-clamp-2 text-sm">{ticket.summary}</p>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
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
                              Jira
                            </a>
                          ) : (
                            <span className="inline-flex shrink-0 items-center gap-1">
                              {ticket.source === "local" ? "Belum disync" : ""}
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
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
