import { useEffect, useState } from "react";
import { ExternalLink, Pencil, Trash2, Upload } from "lucide-react";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { api, type TicketDetail } from "@/lib/api";

const STATUSES = ["Backlog", "To Do", "In Progress", "Test", "Done"];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const TYPES = ["Task", "Bug", "Story"];

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
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [syncError, setSyncError] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("Backlog");
  const [priority, setPriority] = useState("none");
  const [type, setType] = useState("Task");

  const applyDrafts = (value: TicketDetail) => {
    setTitle(value.summary);
    setDescription(value.description);
    setStatus(value.status ?? "Backlog");
    setPriority(value.priority ?? "none");
    setType(value.type ?? "Task");
  };

  useEffect(() => {
    if (!open || !projectId || (!ticketKey && !localId)) return;
    setLoading(true);
    setError(undefined);
    setSyncError(undefined);
    setActionError(undefined);
    setEditing(false);
    setTicket(null);
    const load = localId
      ? api.getLocalTicket(projectId, localId)
      : api.getTicket(projectId, ticketKey!);
    load
      .then((res) => {
        setTicket(res.ticket);
        applyDrafts(res.ticket);
      })
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
      applyDrafts(res.ticket);
      onChanged?.();
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const startEdit = () => {
    if (!ticket) return;
    applyDrafts(ticket);
    setActionError(undefined);
    setEditing(true);
  };

  const cancelEdit = () => {
    if (ticket) applyDrafts(ticket);
    setActionError(undefined);
    setEditing(false);
  };

  const saveEdit = async () => {
    if (!projectId || !localId) return;
    if (!title.trim()) {
      setActionError("Judul tiket wajib diisi.");
      return;
    }
    setSaving(true);
    setActionError(undefined);
    try {
      const res = await api.updateLocalTicket(projectId, localId, {
        title: title.trim(),
        description,
        status,
        priority: priority === "none" ? null : priority,
        type,
      });
      setTicket(res.ticket);
      applyDrafts(res.ticket);
      setEditing(false);
      onChanged?.();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const removeTicket = async () => {
    if (!projectId || !localId || !ticketKey) return;
    if (!confirm(`Hapus tiket ${ticketKey}? Tindakan ini tidak bisa dibatalkan.`)) return;
    setDeleting(true);
    setActionError(undefined);
    try {
      await api.deleteLocalTicket(projectId, localId);
      onChanged?.();
      onOpenChange(false);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const isLocal = ticket?.source === "local";
  const canDelete = isLocal && ticket?.syncStatus !== "synced";

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
          <DialogDescription>
            {editing ? "Edit tiket lokal" : ticket?.summary ?? "Memuat detail tiket…"}
          </DialogDescription>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">Memuat…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {ticket && !loading && !error && editing ? (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Judul</span>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Deskripsi</span>
              <RichTextEditor
                value={description}
                onChange={setDescription}
                placeholder="Konteks, langkah reproduksi, atau acceptance criteria…"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Status</span>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger size="sm" className="w-full" aria-label="Status tiket">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {STATUSES.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Prioritas</span>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger size="sm" className="w-full" aria-label="Prioritas tiket">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">Tanpa</SelectItem>
                      {PRIORITIES.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Tipe</span>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger size="sm" className="w-full" aria-label="Tipe tiket">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {TYPES.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {ticket.syncStatus === "synced" ? (
              <p className="text-xs text-muted-foreground">
                Tiket sudah synced ke Jira — perubahan lokal tidak otomatis dikirim ke Jira.
              </p>
            ) : null}
            {actionError ? <p className="text-xs text-destructive">{actionError}</p> : null}
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={saveEdit} disabled={saving} data-icon="inline-start">
                {saving ? <Spinner /> : null}
                Simpan
              </Button>
              <Button size="sm" variant="outline" onClick={cancelEdit} disabled={saving}>
                Batal
              </Button>
            </div>
          </div>
        ) : ticket && !loading && !error ? (
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {isLocal ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={startEdit}
                  data-icon="inline-start"
                >
                  <Pencil />
                  Edit
                </Button>
              ) : null}
              {canDelete ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={removeTicket}
                  disabled={deleting}
                  data-icon="inline-start"
                  className="text-destructive"
                >
                  {deleting ? <Spinner /> : <Trash2 />}
                  Hapus
                </Button>
              ) : null}
            </div>

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

            {actionError ? <p className="text-xs text-destructive">{actionError}</p> : null}

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
        ) : null}
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
