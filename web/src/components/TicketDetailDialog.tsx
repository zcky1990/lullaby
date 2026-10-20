import { useEffect, useState } from "react";
import { ExternalLink, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { api, type TicketDetail } from "@/lib/api";

interface Props {
  projectId: string | null;
  ticketKey: string | null;
  localId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}

export function TicketDetailDialog({
  projectId,
  ticketKey,
  localId,
  open,
  onOpenChange,
  onChanged,
}: Props) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [syncError, setSyncError] = useState<string | undefined>();

  useEffect(() => {
    if (!open || !projectId || (!ticketKey && !localId)) return;
    setLoading(true);
    setError(undefined);
    setSyncError(undefined);
    setTicket(null);
    const load = localId
      ? api.getLocalTicket(projectId, localId)
      : api.getTicket(projectId, ticketKey!);
    load
      .then((res) => setTicket(res.ticket))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [open, projectId, ticketKey, localId]);

  const syncNow = async () => {
    if (!projectId || !localId) return;
    setSyncing(true);
    setSyncError(undefined);
    try {
      const res = await api.syncLocalTicket(projectId, localId);
      setTicket(res.ticket);
      onChanged?.();
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-muted-foreground">{ticketKey}</span>
            {ticket?.status && <Badge>{ticket.status}</Badge>}
            {ticket?.priority && <Badge variant="outline">{ticket.priority}</Badge>}
            {ticket?.source === "local" && (
              <Badge variant={ticket.syncStatus === "synced" ? "secondary" : "outline"}>
                {ticket.syncStatus === "synced"
                  ? "Synced"
                  : ticket.syncStatus === "error"
                  ? "Sync error"
                  : "Local"}
              </Badge>
            )}
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
              {ticket.description ? (
                /<[a-z][\s\S]*>/i.test(ticket.description) ? (
                  <div
                    className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 text-sm [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:font-mono [&_h1]:mb-1 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_p]:last:mb-0 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-background [&_pre]:p-2 [&_pre]:font-mono [&_ul]:list-disc [&_ul]:pl-5"
                    dangerouslySetInnerHTML={{ __html: ticket.description }}
                  />
                ) : (
                  <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-sans text-sm whitespace-pre-wrap">
                    {ticket.description}
                  </pre>
                )
              ) : (
                <p className="text-sm text-muted-foreground">(tidak ada deskripsi)</p>
              )}
            </div>

            {ticket.source === "local" && ticket.syncStatus !== "synced" ? (
              <div className="flex flex-col gap-2">
                {ticket.syncError ? (
                  <p className="text-xs text-destructive">{ticket.syncError}</p>
                ) : null}
                {syncError ? <p className="text-xs text-destructive">{syncError}</p> : null}
                <Button
                  size="sm"
                  onClick={syncNow}
                  disabled={syncing}
                  data-icon="inline-start"
                  className="self-start"
                >
                  {syncing ? <Spinner /> : <Upload />}
                  Sync ke Jira
                </Button>
              </div>
            ) : ticket.url ? (
              <Button asChild variant="outline" size="sm" data-icon="inline-start" className="self-start">
                <a href={ticket.url} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Buka di Jira
                </a>
              </Button>
            ) : null}
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
