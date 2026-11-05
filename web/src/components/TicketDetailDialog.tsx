import { useEffect, useState } from "react";
import { ExternalLink, Pencil, Play, Trash2, Upload } from "lucide-react";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { api, type TicketDetail, type TicketProvider, type TicketSource } from "@/lib/api";
import { dispatchAutoBuild } from "@/lib/auto-build-events";
import { requestChatOpen } from "@/lib/chat-drag";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { cn } from "@/lib/utils";

const STATUSES = ["Backlog", "To Do", "In Progress", "Test", "Done"];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const TYPES = ["Task", "Bug", "Story"];

const DESCRIPTION_HTML =
  "prose prose-sm dark:prose-invert max-w-none [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_h1]:mb-1 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_p]:last:mb-0 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:font-mono [&_ul]:list-disc [&_ul]:pl-5";

interface Props {
  projectId: string | null;
  ticketKey: string | null;
  localId?: string;
  ticketSource?: TicketSource;
  syncProviders?: TicketProvider[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
  /** Override aksi "Kerjakan tiket" (default: buka chat + mulai auto build). */
  onWorkOnTicket?: (ticket: TicketDetail) => void;
}

export function TicketDetailDialog({
  projectId,
  ticketKey,
  localId,
  ticketSource,
  syncProviders = [],
  open,
  onOpenChange,
  onChanged,
  onWorkOnTicket,
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
  const [syncProvider, setSyncProvider] = useState<TicketProvider>(
    syncProviders[0] ?? "jira",
  );

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
    if (syncProviders.length === 0) return;
    setSyncProvider((current) =>
      syncProviders.includes(current) ? current : syncProviders[0]!
    );
  }, [syncProviders]);

  useEffect(() => {
    if (!open || !projectId || (!ticketKey && !localId)) return;
    setLoading(true);
    setError(undefined);
    setSyncError(undefined);
    setActionError(undefined);
    setEditing(false);
    setTicket(null);
    const remoteSource = ticketSource === "clickup" || ticketSource === "jira"
      ? ticketSource
      : undefined;
    const load = localId
      ? api.getLocalTicket(projectId, localId)
      : api.getTicket(projectId, ticketKey!, remoteSource);
    load
      .then((res) => {
        setTicket(res.ticket);
        applyDrafts(res.ticket);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [open, projectId, ticketKey, localId, ticketSource]);

  const syncNow = async () => {
    if (!projectId || !localId) return;
    setSyncing(true);
    setSyncError(undefined);
    try {
      const provider = syncProviders.length > 1
        ? syncProvider
        : syncProviders[0];
      const res = await api.syncLocalTicket(projectId, localId, provider);
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

  /**
   * "Kerjakan tiket": buka panel chat lalu kirim prompt auto-build untuk tiket
   * ini. Dialog ditutup dulu supaya chat (yang bukan modal) terlihat, karena
   * dialog ini memblokir interaksi di luarnya.
   */
  const workOnTicket = (value: TicketDetail) => {
    if (onWorkOnTicket) {
      onWorkOnTicket(value);
      return;
    }
    if (!projectId) return;
    onOpenChange(false);
    requestChatOpen();
    dispatchAutoBuild({
      projectId,
      key: value.key,
      summary: value.summary,
      description: value.description?.trim() || undefined,
    });
  };

  const isLocal = ticket?.source === "local";
  const canDelete = isLocal && ticket?.syncStatus !== "synced";
  const canSync = isLocal && ticket?.syncStatus !== "synced" && syncProviders.length > 0;
  const displayKey = ticket?.key ?? ticketKey ?? "—";
  const remoteLabel = ticket?.source === "clickup" ||
      (ticket?.source === "local" && ticket.syncProvider === "clickup")
    ? "ClickUp"
    : "Jira";
  const syncLabel = syncProviders.length === 1 && syncProviders[0] === "clickup"
    ? "ClickUp"
    : syncProviders.length === 1
    ? "Jira"
    : syncProvider === "clickup"
    ? "ClickUp"
    : "Jira";
  const isHtmlDescription = ticket?.description
    ? /<[a-z][\s\S]*>/i.test(ticket.description)
    : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[min(90vh,880px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl",
        )}
      >
        <DialogHeader className="shrink-0 space-y-3 border-b px-6 pt-6 pr-12 pb-4 text-left">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs text-muted-foreground">{displayKey}</span>
            {ticket?.status ? <Badge variant="secondary">{ticket.status}</Badge> : null}
            {ticket?.priority ? <Badge variant="outline">{ticket.priority}</Badge> : null}
            {ticket?.type ? <Badge variant="outline">{ticket.type}</Badge> : null}
            {ticket?.source === "local" ? (
              <Badge
                variant={ticket.syncStatus === "error"
                  ? "destructive"
                  : ticket.syncStatus === "synced"
                  ? "secondary"
                  : "outline"}
              >
                {ticket.syncStatus === "synced"
                  ? "Synced"
                  : ticket.syncStatus === "error"
                  ? "Sync error"
                  : "Local"}
              </Badge>
            ) : null}
          </div>
          <DialogTitle className="text-left text-xl leading-snug font-semibold">
            {editing
              ? "Edit tiket"
              : ticket?.summary ?? (loading ? "Memuat…" : "Detail tiket")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Detail tiket {displayKey}
          </DialogDescription>
          {!editing && ticket && !loading && !error ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => workOnTicket(ticket)}
                data-icon="inline-start"
                title="Buka chat dan mulai kerjakan tiket ini"
              >
                <Play />
                Kerjakan tiket
              </Button>
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
              {canSync ? (
                <>
                  {syncProviders.length > 1 ? (
                    <Select
                      value={syncProvider}
                      onValueChange={(value) =>
                        setSyncProvider(value as TicketProvider)
                      }
                    >
                      <SelectTrigger size="sm" className="w-[7.5rem]" aria-label="Provider sync">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {syncProviders.map((provider) => (
                            <SelectItem key={provider} value={provider}>
                              {provider === "clickup" ? "ClickUp" : "Jira"}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : null}
                  <Button
                    size="sm"
                    onClick={syncNow}
                    disabled={syncing}
                    data-icon="inline-start"
                  >
                    {syncing ? <Spinner /> : <Upload />}
                    Sync ke {syncLabel}
                  </Button>
                </>
              ) : null}
              {ticket.url ? (
                <Button asChild size="sm" variant="outline" data-icon="inline-start">
                  <a href={ticket.url} target="_blank" rel="noreferrer">
                    <ExternalLink />
                    Buka di {remoteLabel}
                  </a>
                </Button>
              ) : null}
              {canDelete ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={removeTicket}
                  disabled={deleting}
                  data-icon="inline-start"
                  className="text-destructive hover:text-destructive"
                >
                  {deleting ? <Spinner /> : <Trash2 />}
                  Hapus
                </Button>
              ) : null}
            </div>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
              <Spinner />
              Memuat detail tiket…
            </div>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          {ticket && !loading && !error && editing ? (
            <div className="flex flex-col gap-4 text-xs">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ticket-edit-title">Judul</Label>
                <Input
                  id="ticket-edit-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Deskripsi</Label>
                <RichTextEditor
                  value={description}
                  onChange={setDescription}
                  placeholder="Konteks, langkah reproduksi, atau acceptance criteria…"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Status</Label>
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
                  <Label>Prioritas</Label>
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
                  <Label>Tipe</Label>
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
            </div>
          ) : null}

          {ticket && !loading && !error && !editing ? (
            <div className="flex flex-col gap-5 text-xs">
              {(ticket.syncError || syncError || actionError) ? (
                <div className="flex flex-col gap-1">
                  {ticket.syncError ? (
                    <p className="text-xs text-destructive">{ticket.syncError}</p>
                  ) : null}
                  {syncError ? <p className="text-xs text-destructive">{syncError}</p> : null}
                  {actionError ? <p className="text-xs text-destructive">{actionError}</p> : null}
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-4">
                <Field label="Assignee" value={ticket.assignee} />
                <Field label="Reporter" value={ticket.reporter} />
                <Field label="Type" value={ticket.type} />
                <Field label="Updated" value={formatDate(ticket.updated)} />
              </div>

              {ticket.labels.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                    Labels
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ticket.labels.map((label) => (
                      <Badge key={label} variant="secondary">
                        {label}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                  Deskripsi
                </p>
                {ticket.description ? (
                  isHtmlDescription ? (
                    <div
                      className={cn(
                        "max-h-[min(50vh,420px)] overflow-auto rounded-lg border bg-muted/30 p-4",
                        DESCRIPTION_HTML,
                      )}
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(ticket.description) }}
                    />
                  ) : (
                    <pre className="max-h-[min(50vh,420px)] overflow-auto rounded-lg border bg-muted/30 p-4 font-sans text-xs leading-relaxed whitespace-pre-wrap">
                      {ticket.description}
                    </pre>
                  )
                ) : (
                  <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
                    Tidak ada deskripsi
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {editing && ticket && !loading && !error ? (
          <DialogFooter className="shrink-0 border-t px-6 py-4 sm:justify-between">
            <p className="text-xs text-muted-foreground">{displayKey}</p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={cancelEdit} disabled={saving}>
                Batal
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={saving} data-icon="inline-start">
                {saving ? <Spinner /> : null}
                Simpan
              </Button>
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value?.trim() || "—"}</span>
    </div>
  );
}

function formatDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
