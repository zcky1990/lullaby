import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, type TicketDetail } from "@/lib/api";

interface Props {
  projectId: string | null;
  ticketKey: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TicketDetailDialog({ projectId, ticketKey, open, onOpenChange }: Props) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!open || !projectId || !ticketKey) return;
    setLoading(true);
    setError(undefined);
    setTicket(null);
    api
      .getTicket(projectId, ticketKey)
      .then((res) => setTicket(res.ticket))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [open, projectId, ticketKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-muted-foreground">{ticketKey}</span>
            {ticket?.status && <Badge>{ticket.status}</Badge>}
            {ticket?.priority && <Badge variant="outline">{ticket.priority}</Badge>}
          </DialogTitle>
          <DialogDescription>{ticket?.summary ?? "Memuat detail tiket…"}</DialogDescription>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">Memuat…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {ticket && !loading && !error && (
          <div className="flex flex-col gap-4 text-sm">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Field label="Type" value={ticket.type} />
              <Field label="Assignee" value={ticket.assignee} />
              <Field label="Reporter" value={ticket.reporter} />
              <Field label="Updated" value={formatDate(ticket.updated)} />
            </div>

            {ticket.labels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {ticket.labels.map((label) => (
                  <Badge key={label} variant="secondary">
                    {label}
                  </Badge>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Deskripsi
              </p>
              <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-sans text-sm whitespace-pre-wrap">
                {ticket.description || "(tidak ada deskripsi)"}
              </pre>
            </div>

            <Button asChild variant="outline" size="sm" data-icon="inline-start">
              <a href={ticket.url} target="_blank" rel="noreferrer">
                <ExternalLink />
                Buka di Jira
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span>{value ?? "—"}</span>
    </div>
  );
}

function formatDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
