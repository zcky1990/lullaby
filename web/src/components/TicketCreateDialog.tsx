import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
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
import { RichTextEditor } from "@/components/RichTextEditor";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";

const STATUSES = ["Backlog", "To Do", "In Progress", "Test", "Done"];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const TYPES = ["Task", "Bug", "Story"];

interface Props {
  projectId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function TicketCreateDialog({ projectId, open, onOpenChange, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("Backlog");
  const [priority, setPriority] = useState("none");
  const [type, setType] = useState("Task");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setStatus("Backlog");
    setPriority("none");
    setType("Task");
    setError(undefined);
  }, [open]);

  const submit = async () => {
    const clean = title.trim();
    if (!clean || !projectId) return;
    setSaving(true);
    setError(undefined);
    try {
      await api.createLocalTicket(projectId, {
        title: clean,
        description: description.trim() || undefined,
        status,
        priority: priority === "none" ? undefined : priority,
        type,
      });
      onCreated();
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tiket baru (lokal)</DialogTitle>
          <DialogDescription>
            Disimpan di workspace lokal. Sync ke Jira dilakukan manual dari detail tiket.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ticket-title">Judul</Label>
            <Input
              id="ticket-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Mis. Perbaiki dropdown chat"
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
          <div className="grid grid-cols-3 gap-2">
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
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button
            onClick={submit}
            disabled={saving || !title.trim() || !projectId}
            data-icon="inline-start"
          >
            {saving ? <Spinner /> : <Plus />}
            Buat tiket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
