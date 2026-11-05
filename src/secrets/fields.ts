import { isMaskedSecret, SECRET_CONFIG_KEYS, SECRET_MASK } from "./constants.ts";
import { decryptString, encryptString, isEncryptedSecret } from "./crypto.ts";
import { getMasterKeyBytes } from "./master-key.ts";

export async function encryptSecretValue(value: string | null | undefined): Promise<string | null> {
  if (value == null || value === "") return value ?? null;
  const key = await getMasterKeyBytes();
  return await encryptString(value, key);
}

export async function decryptSecretValue(value: string | null | undefined): Promise<string | null> {
  if (value == null || value === "") return value ?? null;
  const key = await getMasterKeyBytes();
  return await decryptString(value, key);
}

export async function encryptConfigSecrets(
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const key = await getMasterKeyBytes();
  const out: Record<string, unknown> = { ...config };
  for (const field of SECRET_CONFIG_KEYS) {
    const value = out[field];
    if (typeof value === "string" && value.length > 0) {
      out[field] = await encryptString(value, key);
    }
  }
  return out;
}

export async function decryptConfigSecrets(
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const key = await getMasterKeyBytes();
  const out: Record<string, unknown> = { ...config };
  for (const field of SECRET_CONFIG_KEYS) {
    const value = out[field];
    if (typeof value === "string" && value.length > 0) {
      out[field] = await decryptString(value, key);
    }
  }
  return out;
}

async function encryptStringMap(
  map: Record<string, string> | undefined,
  key: Uint8Array,
): Promise<Record<string, string> | undefined> {
  if (!map) return undefined;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(map)) {
    out[name] = value ? await encryptString(value, key) : value;
  }
  return out;
}

async function decryptStringMap(
  map: Record<string, string> | undefined,
  key: Uint8Array,
): Promise<Record<string, string> | undefined> {
  if (!map) return undefined;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(map)) {
    out[name] = value ? await decryptString(value, key) : value;
  }
  return out;
}

function maskStringMap(
  map: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!map) return undefined;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(map)) {
    out[name] = value ? SECRET_MASK : value;
  }
  return out;
}

function mergeStringMap(
  incoming: Record<string, string> | undefined,
  existing: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!incoming && !existing) return undefined;
  if (!incoming) return existing;
  const out: Record<string, string> = { ...incoming };
  for (const [name, value] of Object.entries(out)) {
    if (isMaskedSecret(value) && existing?.[name] !== undefined) {
      out[name] = existing[name]!;
    }
  }
  return out;
}

export type McpServerSecrets = {
  id?: string;
  name: string;
  transport?: string;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  enabled?: boolean;
};

export async function encryptMcpServers(
  servers: McpServerSecrets[],
): Promise<McpServerSecrets[]> {
  const key = await getMasterKeyBytes();
  const out: McpServerSecrets[] = [];
  for (const server of servers) {
    out.push({
      ...server,
      env: await encryptStringMap(server.env, key),
      headers: await encryptStringMap(server.headers, key),
    });
  }
  return out;
}

export async function decryptMcpServers(
  servers: McpServerSecrets[],
): Promise<McpServerSecrets[]> {
  const key = await getMasterKeyBytes();
  const out: McpServerSecrets[] = [];
  for (const server of servers) {
    out.push({
      ...server,
      env: await decryptStringMap(server.env, key),
      headers: await decryptStringMap(server.headers, key),
    });
  }
  return out;
}

export function maskMcpServers(servers: McpServerSecrets[]): McpServerSecrets[] {
  return servers.map((server) => ({
    ...server,
    env: maskStringMap(server.env),
    headers: maskStringMap(server.headers),
  }));
}

export function mergeMcpServerSecrets(
  incoming: McpServerSecrets[],
  existing: McpServerSecrets[],
): McpServerSecrets[] {
  const byId = new Map(
    existing.filter((server) => server.id).map((server) => [server.id!, server]),
  );
  const byName = new Map(existing.map((server) => [server.name, server]));
  return incoming.map((server) => {
    const prev = (server.id ? byId.get(server.id) : undefined) ?? byName.get(server.name);
    if (!prev) return server;
    return {
      ...server,
      env: mergeStringMap(server.env, prev.env),
      headers: mergeStringMap(server.headers, prev.headers),
    };
  });
}

export type NotificationChannelSecrets = {
  id?: string;
  name: string;
  type: string;
  enabled?: boolean;
  webhookUrl: string;
};

export async function encryptNotificationChannels(
  channels: NotificationChannelSecrets[],
): Promise<NotificationChannelSecrets[]> {
  const key = await getMasterKeyBytes();
  const out: NotificationChannelSecrets[] = [];
  for (const channel of channels) {
    out.push({
      ...channel,
      webhookUrl: channel.webhookUrl
        ? await encryptString(channel.webhookUrl, key)
        : channel.webhookUrl,
    });
  }
  return out;
}

export async function decryptNotificationChannels(
  channels: NotificationChannelSecrets[],
): Promise<NotificationChannelSecrets[]> {
  const key = await getMasterKeyBytes();
  const out: NotificationChannelSecrets[] = [];
  for (const channel of channels) {
    out.push({
      ...channel,
      webhookUrl: channel.webhookUrl
        ? await decryptString(channel.webhookUrl, key)
        : channel.webhookUrl,
    });
  }
  return out;
}

export function maskNotificationChannels(
  channels: NotificationChannelSecrets[],
): NotificationChannelSecrets[] {
  return channels.map((channel) => ({
    ...channel,
    webhookUrl: channel.webhookUrl ? SECRET_MASK : channel.webhookUrl,
  }));
}

export function mergeNotificationChannelSecrets(
  incoming: NotificationChannelSecrets[],
  existing: NotificationChannelSecrets[],
): NotificationChannelSecrets[] {
  const byId = new Map(
    existing.filter((channel) => channel.id).map((channel) => [channel.id!, channel]),
  );
  return incoming.map((channel) => {
    const prev = channel.id ? byId.get(channel.id) : undefined;
    if (!prev) return channel;
    if (isMaskedSecret(channel.webhookUrl)) {
      return { ...channel, webhookUrl: prev.webhookUrl };
    }
    return channel;
  });
}

export function configNeedsEncryption(config: Record<string, unknown>): boolean {
  for (const field of SECRET_CONFIG_KEYS) {
    const value = config[field];
    if (typeof value === "string" && value.length > 0 && !isEncryptedSecret(value)) {
      return true;
    }
  }
  return false;
}

export function valueNeedsEncryption(value: string | null | undefined): boolean {
  return typeof value === "string" && value.length > 0 && !isEncryptedSecret(value);
}
