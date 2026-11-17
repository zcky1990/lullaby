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
import { useI18n } from "@/lib/i18n";
import {
  api,
  SECRET_MASK,
  type NotificationChannel,
  type NotificationChannelType,
  type NotificationSettings,
} from "@/lib/api";

const CHANNEL_TYPES: { id: NotificationChannelType; labelKey: string; hintKey: string }[] = [
  {
    id: "slack",
    labelKey: "settings.notifications.type.slack",
    hintKey: "settings.notifications.type.slackHint",
  },
  {
    id: "google_chat",
    labelKey: "settings.notifications.type.googleChat",
    hintKey: "settings.notifications.type.googleChatHint",
  },
  {
    id: "discord",
    labelKey: "settings.notifications.type.discord",
    hintKey: "settings.notifications.type.discordHint",
  },
  {
    id: "webhook",
    labelKey: "settings.notifications.type.webhook",
    hintKey: "settings.notifications.type.webhookHint",
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
  const { t } = useI18n();

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
      setError(t("settings.notifications.errorNameRequired"));
      return;
    }
    if (webhookUrl !== SECRET_MASK && !/^https?:\/\//i.test(webhookUrl)) {
      setError(t("settings.notifications.errorWebhookUrl"));
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
      setMessage(
        draft.id ? t("settings.notifications.updated") : t("settings.notifications.added"),
      );
    } catch {
      // keep dialog open
    }
  };

  const removeChannel = async (id: string) => {
    try {
      await persist({
        channels: settings.channels.filter((channel) => channel.id !== id),
      });
      setMessage(t("settings.notifications.removed"));
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
            ? t("settings.notifications.testSent")
            : t("settings.notifications.testSentCount", { count: res.results.length }),
        );
      } else {
        const failed = res.results.filter((item) => !item.ok);
        setError(
          failed
            .map((item) =>
              `${item.channelName}: ${item.error ?? t("settings.notifications.failed")}`
            )
            .join("; ") || t("settings.notifications.testFailed"),
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
          {t("settings.notifications.title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("settings.notifications.description")}{" "}
          <code className="font-mono">action: notification</code>{" "}
          {t("settings.notifications.descriptionWith")}{" "}
          <code className="font-mono">with.channel</code>{" "}
          {t("settings.notifications.descriptionOutro")}
        </p>
        <Separator />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner />
          {t("settings.notifications.loading")}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {t("settings.notifications.channelCount", { count: settings.channels.length })}
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || testingId !== null || settings.channels.length === 0}
                onClick={() => void testChannel()}
              >
                {testingId === "all" ? <Spinner /> : <Send className="size-3.5" />}
                {t("settings.notifications.testAll")}
              </Button>
              <Button size="sm" onClick={openCreate} disabled={busy}>
                <Plus className="size-3.5" />
                {t("settings.notifications.addChannel")}
              </Button>
            </div>
          </div>

          {settings.channels.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
              {t("settings.notifications.emptyBefore")}{" "}
              {t("settings.notifications.emptyAfter")}{" "}
              <code className="font-mono">action: notification</code>.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {settings.channels.map((channel) => {
                const meta = CHANNEL_TYPES.find((item) => item.id === channel.type);
                return (
                  <div
                    key={channel.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium">{channel.name}</span>
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                          {meta ? t(meta.labelKey) : channel.type}
                        </Badge>
                        {!channel.enabled
                          ? (
                            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                              {t("common.off")}
                            </Badge>
                          )
                          : null}
                      </div>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {channel.webhookUrl === SECRET_MASK
                          ? t("settings.notifications.webhookSaved")
                          : channel.webhookUrl}
                      </p>
                    </div>
                    <Switch
                      checked={channel.enabled}
                      onCheckedChange={(next) => void toggleChannel(channel.id, next)}
                      disabled={busy}
                      aria-label={t("settings.notifications.enableChannel", { name: channel.name })}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2"
                      disabled={busy || testingId !== null || !channel.enabled}
                      onClick={() => void testChannel(channel.id)}
                    >
                      {testingId === channel.id ? <Spinner /> : <Send className="size-3.5" />}
                      {t("settings.notifications.test")}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      disabled={busy}
                      onClick={() => openEdit(channel)}
                      aria-label={t("settings.notifications.editChannel", { name: channel.name })}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      disabled={busy}
                      onClick={() => void removeChannel(channel.id)}
                      aria-label={t("settings.notifications.deleteChannel", { name: channel.name })}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {draft.id ? t("settings.notifications.editTitle") : t("settings.notifications.addTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("settings.notifications.dialogDescription")}{" "}
              <code className="font-mono">with.channel</code>.{" "}
              {t("settings.notifications.dialogDescriptionOutro")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="notif-name">{t("settings.notifications.name")}</Label>
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
              <Label>{t("settings.notifications.typeLabel")}</Label>
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
                        {t(item.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {typeMeta
                ? <p className="text-[11px] text-muted-foreground">{t(typeMeta.hintKey)}</p>
                : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notif-url">{t("settings.notifications.webhookUrl")}</Label>
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
              <span className="text-xs font-medium">{t("settings.notifications.active")}</span>
              <Switch
                checked={draft.enabled}
                onCheckedChange={(next) =>
                  setDraft((current) => ({ ...current, enabled: next }))}
                aria-label={t("settings.notifications.channelActiveAria")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void saveChannel()} disabled={busy}>
              {busy ? <Spinner /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
