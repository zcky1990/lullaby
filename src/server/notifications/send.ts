import type { NotificationChannelInput } from "../../config/schema.ts";
import { log } from "../../core/logger.ts";
import { findNotificationChannel, readNotificationSettings } from "./settings.ts";

export interface ChannelSendResult {
  channelId: string;
  channelName: string;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface NotifyMessagePayload {
  text: string;
  projectId?: string;
  projectName?: string;
  slug?: string;
  workflowName?: string;
  runId?: string;
  stepId?: string;
}

function buildBody(
  channel: NotificationChannelInput,
  payload: NotifyMessagePayload,
): Record<string, unknown> {
  const text = payload.text;
  if (channel.type === "discord") {
    return { content: text.slice(0, 1900) };
  }
  if (channel.type === "webhook") {
    return {
      event: "workflow.notification",
      text,
      projectId: payload.projectId ?? null,
      projectName: payload.projectName ?? null,
      slug: payload.slug ?? null,
      workflowName: payload.workflowName ?? null,
      runId: payload.runId ?? null,
      stepId: payload.stepId ?? null,
      sentAt: new Date().toISOString(),
    };
  }
  return { text };
}

export async function sendToChannel(
  channel: NotificationChannelInput,
  payload: NotifyMessagePayload,
): Promise<ChannelSendResult> {
  const id = channel.id ?? channel.name;
  const text = payload.text.trim();
  if (!text) {
    return {
      channelId: id,
      channelName: channel.name,
      ok: false,
      error: "Pesan notifikasi kosong.",
    };
  }
  try {
    const response = await fetch(channel.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody(channel, { ...payload, text })),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      return {
        channelId: id,
        channelName: channel.name,
        ok: false,
        status: response.status,
        error: detail || `HTTP ${response.status}`,
      };
    }
    return {
      channelId: id,
      channelName: channel.name,
      ok: true,
      status: response.status,
    };
  } catch (error) {
    return {
      channelId: id,
      channelName: channel.name,
      ok: false,
      error: (error as Error).message,
    };
  }
}

export async function sendNotificationByChannelRef(
  channelRef: string,
  payload: NotifyMessagePayload,
): Promise<ChannelSendResult> {
  const channel = await findNotificationChannel(channelRef);
  if (!channel) {
    return {
      channelId: channelRef,
      channelName: channelRef,
      ok: false,
      error:
        `Channel notifikasi "${channelRef}" tidak ditemukan atau nonaktif (Global Settings → Notifications).`,
    };
  }
  const result = await sendToChannel(channel, payload);
  if (!result.ok) {
    log.warn("workflow notification step failed", {
      channel: result.channelName,
      error: result.error,
      status: result.status,
    });
  }
  return result;
}

export async function testNotificationChannels(
  channelId?: string,
): Promise<ChannelSendResult[]> {
  const settings = await readNotificationSettings();
  const channels = settings.channels.filter((channel) => channel.enabled && channel.webhookUrl);
  const targets = channelId ? channels.filter((channel) => channel.id === channelId) : channels;
  const payload: NotifyMessagePayload = {
    text: "Test notifikasi dari Lullaby (Global Settings → Notifications).",
  };
  return await Promise.all(targets.map((channel) => sendToChannel(channel, payload)));
}
