import {
  NotificationSettingsInput,
  type NotificationSettingsInput as NotificationSettings,
} from "../../config/schema.ts";
import { log } from "../../core/logger.ts";
import { getAppSetting, setAppSetting } from "../../db/db.ts";

export const NOTIFICATIONS_KEY = "notifications";

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  channels: [],
};

export async function readNotificationSettings(): Promise<NotificationSettings> {
  const raw = await getAppSetting(NOTIFICATIONS_KEY);
  if (!raw) return { channels: [] };
  try {
    const parsedJson = JSON.parse(raw) as unknown;
    // Migrate older shape that had enabled/onSuccess/… by keeping only channels.
    const candidate = parsedJson && typeof parsedJson === "object" && !Array.isArray(parsedJson)
      ? { channels: (parsedJson as { channels?: unknown }).channels ?? [] }
      : { channels: [] };
    const parsed = NotificationSettingsInput.safeParse(candidate);
    if (!parsed.success) {
      log.debug("corrupt notifications JSON", { issues: parsed.error.issues.length });
      return { channels: [] };
    }
    return {
      channels: parsed.data.channels.map((channel) => ({
        ...channel,
        id: channel.id ?? crypto.randomUUID(),
      })),
    };
  } catch (error) {
    log.debug("corrupt notifications JSON", { error: String(error) });
    return { channels: [] };
  }
}

export async function writeNotificationSettings(
  settings: NotificationSettings,
): Promise<NotificationSettings> {
  const channels = settings.channels.map((channel) => ({
    ...channel,
    id: channel.id ?? crypto.randomUUID(),
  }));
  const next: NotificationSettings = { channels };
  await setAppSetting(NOTIFICATIONS_KEY, JSON.stringify(next));
  return next;
}

export async function findNotificationChannel(
  channelRef: string,
): Promise<NotificationSettings["channels"][number] | undefined> {
  const settings = await readNotificationSettings();
  const key = channelRef.trim().toLowerCase();
  return settings.channels.find((channel) =>
    channel.enabled &&
    (channel.id === channelRef ||
      channel.name === channelRef ||
      channel.name.toLowerCase() === key ||
      (channel.id?.toLowerCase() === key))
  );
}
