import { useEffect, useState } from "react";
import { Bell, Pencil, Plus, Send, Trash2 } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  api,
  type NotificationChannel,
  type NotificationChannelType,
  type NotificationSettings,
} from "@/lib/api";

const CHANNEL_TYPES: { id: NotificationChannelType; label: string; hint: string }[] = [
  {
    id: "slack",
    label: "Slack",
    hint: "Incoming Webhook URL dari Slack app / workspace",
  },
  {
    id: "google_chat",
    label: "Google Chat",
    hint: "Incoming webhook URL dari space Google Chat",
  },
  {
    id: "discord",
    label: "Discord",
    hint: "Webhook URL channel Discord",
  },
  {
    id: "webhook",
    label: "Generic webhook",
    hint: "POST JSON event ke URL kustom",
  },
];

type DraftChannel = {
  id?: string;
  name: string;
  type: NotificationChannelType;
  enabled: boolean;
  webhookUrl: string;
};

function emptyDraft(): DraftChannel {
  return {
    name: "",
    type: "slack",
    enabled: true,
    webhookUrl: "",
  };
}

export function NotificationSettings() {
  const [settings, setSettings] = useState<NotificationSettings>({ channels: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<DraftChannel>(emptyDraft());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    api
      .getNotificationSettings()
      .then((res) => {
        if (!cancelled) setSettings(res.settings);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (next: NotificationSettings) => {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const res = await api.saveNotificationSettings(next);
      setSettings(res.settings);
      return res.settings;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => {
    setDraft(emptyDraft());
    setEditorOpen(true);
  };

  const openEdit = (channel: NotificationChannel) => {
    setDraft({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      enabled: channel.enabled,
      webhookUrl: channel.webhookUrl,
    });
    setEditorOpen(true);
  };

  const saveChannel = async () => {
    const name = draft.name.trim();
    const webhookUrl = draft.webhookUrl.trim();
    if (!name) {
      setError("Nama channel wajib diisi.");
      return;
    }
    if (!/^https?:\/\//i.test(webhookUrl)) {
      setError("Webhook URL harus http(s).");
      return;
    }
    const channel: NotificationChannel = {
      id: draft.id ?? crypto.randomUUID(),
      name,
      type: draft.type,
      enabled: draft.enabled,
      webhookUrl,
    };
    const channels = draft.id
      ? settings.channels.map((item) => (item.id === draft.id ? channel : item))
      : [...settings.channels, channel];
    try {
      await persist({ channels });
      setEditorOpen(false);
      setMessage(draft.id ? "Channel diperbarui." : "Channel ditambahkan.");
    } catch {
      // keep dialog open
    }
  };

  const removeChannel = async (id: string) => {
    try {
      await persist({
        channels: settings.channels.filter((channel) => channel.id !== id),
      });
      setMessage("Channel dihapus.");
    } catch {
      // error already set
    }
  };

  const toggleChannel = async (id: string, enabled: boolean) => {
    try {
      await persist({
        channels: settings.channels.map((channel) =>
          channel.id === id ? { ...channel, enabled } : channel
        ),
      });
    } catch {
      // error already set
    }
  };

  const testChannel = async (channelId?: string) => {
    setTestingId(channelId ?? "all");
    setError(undefined);
    setMessage(undefined);
    try {
      const res = await api.testNotificationSettings(
        channelId ? { channelId } : {},
      );
      if (res.ok) {
        setMessage(
          channelId
            ? "Test notifikasi terkirim."
            : `Test terkirim ke ${res.results.length} channel.`,
        );
      } else {
        const failed = res.results.filter((item) => !item.ok);
        setError(
          failed.map((item) => `${item.channelName}: ${item.error ?? "gagal"}`).join("; ") ||
            "Test gagal.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTestingId(null);
    }
  };

  const typeMeta = CHANNEL_TYPES.find((item) => item.id === draft.type);

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
          <Bell className="size-3.5" />
          Notifications
        </h2>
        <p className="text-xs text-muted-foreground">
          Daftarkan channel (Slack / Google Chat / Discord / webhook). Di workflow YAML, kirim
          pesan lewat step{" "}
          <code className="font-mono">action: notification</code>{" "}
          dengan{" "}
          <code className="font-mono">with.channel</code>{" "}
          sesuai nama channel di sini.
        </p>
        <Separator />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner />
          Memuat…
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {settings.channels.length} channel
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || testingId !== null || settings.channels.length === 0}
                onClick={() => void testChannel()}
              >
                {testingId === "all" ? <Spinner /> : <Send className="size-3.5" />}
                Test semua
              </Button>
              <Button size="sm" onClick={openCreate} disabled={busy}>
                <Plus className="size-3.5" />
                Tambah channel
              </Button>
            </div>
          </div>

          {settings.channels.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
              Belum ada channel. Tambahkan Slack / Google Chat / Discord / webhook, lalu
              referensikan namanya di step{" "}
              <code className="font-mono">action: notification</code>.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {settings.channels.map((channel) => (
                <div
                  key={channel.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium">{channel.name}</span>
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        {CHANNEL_TYPES.find((item) => item.id === channel.type)?.label ??
                          channel.type}
                      </Badge>
                      {!channel.enabled
                        ? (
                          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                            Off
                          </Badge>
                        )
                        : null}
                    </div>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {channel.webhookUrl}
                    </p>
                  </div>
                  <Switch
                    checked={channel.enabled}
                    onCheckedChange={(next) => void toggleChannel(channel.id, next)}
                    disabled={busy}
                    aria-label={`Aktifkan ${channel.name}`}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2"
                    disabled={busy || testingId !== null || !channel.enabled}
                    onClick={() => void testChannel(channel.id)}
                  >
                    {testingId === channel.id ? <Spinner /> : <Send className="size-3.5" />}
                    Test
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    disabled={busy}
                    onClick={() => openEdit(channel)}
                    aria-label={`Edit ${channel.name}`}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    disabled={busy}
                    onClick={() => void removeChannel(channel.id)}
                    aria-label={`Hapus ${channel.name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{draft.id ? "Edit channel" : "Tambah channel"}</DialogTitle>
            <DialogDescription>
              Nama channel dipakai di YAML sebagai{" "}
              <code className="font-mono">with.channel</code>. Webhook URL hanya disimpan lokal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="notif-name">Nama</Label>
              <Input
                id="notif-name"
                value={draft.name}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))}
                placeholder="team-slack"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipe</Label>
              <Select
                value={draft.type}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    type: value as NotificationChannelType,
                  }))}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {CHANNEL_TYPES.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {typeMeta
                ? <p className="text-[11px] text-muted-foreground">{typeMeta.hint}</p>
                : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notif-url">Webhook URL</Label>
              <Input
                id="notif-url"
                value={draft.webhookUrl}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  webhookUrl: event.target.value,
                }))}
                placeholder="https://…"
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <span className="text-xs font-medium">Aktif</span>
              <Switch
                checked={draft.enabled}
                onCheckedChange={(next) =>
                  setDraft((current) => ({ ...current, enabled: next }))}
                aria-label="Channel aktif"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={busy}>
              Batal
            </Button>
            <Button onClick={() => void saveChannel()} disabled={busy}>
              {busy ? <Spinner /> : null}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
