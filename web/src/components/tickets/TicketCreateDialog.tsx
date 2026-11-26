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
import { useI18n } from "@/lib/i18n";

const STATUSES = ["Backlog", "To Do", "In Progress", "Test", "Done"];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const TYPES = ["Task", "Bug", "Story"];

export interface TicketCreateDialogProps {
  projectId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function TicketCreateDialog({ projectId, open, onOpenChange, onCreated }: TicketCreateDialogProps) {
  const { t } = useI18n();
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
      <DialogContent className="flex max-h-[min(90vh,820px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="shrink-0 space-y-1.5 border-b px-6 pt-6 pr-12 pb-4 text-left">
          <DialogTitle>{t("tickets.create.title")}</DialogTitle>
          <DialogDescription>
            {t("tickets.create.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ticket-title">{t("tickets.create.titleLabel")}</Label>
              <Input
                id="ticket-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("tickets.create.titlePlaceholder")}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t("tickets.create.descriptionLabel")}</Label>
              <RichTextEditor
                value={description}
                onChange={setDescription}
                placeholder={t("tickets.create.descriptionPlaceholder")}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label>{t("tickets.create.statusLabel")}</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger
                    size="sm"
                    className="w-full"
                    aria-label={t("tickets.create.statusAria")}
                  >
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
                <Label>{t("tickets.create.priorityLabel")}</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger
                    size="sm"
                    className="w-full"
                    aria-label={t("tickets.create.priorityAria")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">{t("tickets.create.priorityNone")}</SelectItem>
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
                <Label>{t("tickets.create.typeLabel")}</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger
                    size="sm"
                    className="w-full"
                    aria-label={t("tickets.create.typeAria")}
                  >
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
        </div>

        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("tickets.create.cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={saving || !title.trim() || !projectId}
            data-icon="inline-start"
          >
            {saving ? <Spinner /> : <Plus />}
            {t("tickets.create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
