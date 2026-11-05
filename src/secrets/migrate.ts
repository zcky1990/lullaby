import { log } from "../core/logger.ts";
import { getAppSetting, getDb, setAppSetting } from "../db/db.ts";
import {
  configNeedsEncryption,
  decryptConfigSecrets,
  decryptMcpServers,
  decryptNotificationChannels,
  encryptConfigSecrets,
  encryptMcpServers,
  encryptNotificationChannels,
  encryptSecretValue,
  type McpServerSecrets,
  type NotificationChannelSecrets,
  valueNeedsEncryption,
} from "./fields.ts";

export const SECRETS_MIGRATED_KEY = "secrets_encrypted_v1";

async function migrateIntegrations(): Promise<number> {
  const db = await getDb();
  const rows = db.prepare("SELECT id, config FROM project_integrations").all() as Array<{
    id: string;
    config: string;
  }>;
  let updated = 0;
  for (const row of rows) {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(row.config) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!configNeedsEncryption(config)) continue;
    const encrypted = await encryptConfigSecrets(await decryptConfigSecrets(config));
    db.prepare(
      "UPDATE project_integrations SET config = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(JSON.stringify(encrypted), row.id);
    updated += 1;
  }
  return updated;
}

async function migrateLlmProviders(): Promise<number> {
  const db = await getDb();
  const rows = db.prepare("SELECT id, api_key FROM llm_providers").all() as Array<{
    id: string;
    api_key: string | null;
  }>;
  let updated = 0;
  for (const row of rows) {
    if (!valueNeedsEncryption(row.api_key)) continue;
    const encrypted = await encryptSecretValue(row.api_key);
    db.prepare(
      "UPDATE llm_providers SET api_key = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(encrypted, row.id);
    updated += 1;
  }
  return updated;
}

async function migrateMcpServers(): Promise<number> {
  const raw = await getAppSetting("mcp_servers");
  if (!raw) return 0;
  let servers: McpServerSecrets[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return 0;
    servers = parsed as McpServerSecrets[];
  } catch {
    return 0;
  }
  const needs = servers.some((server) => {
    const maps = [server.env, server.headers];
    return maps.some((map) =>
      map &&
      Object.values(map).some((value) => typeof value === "string" && valueNeedsEncryption(value))
    );
  });
  if (!needs) return 0;
  const encrypted = await encryptMcpServers(await decryptMcpServers(servers));
  await setAppSetting("mcp_servers", JSON.stringify(encrypted));
  return 1;
}

async function migrateNotifications(): Promise<number> {
  const raw = await getAppSetting("notifications");
  if (!raw) return 0;
  let channels: NotificationChannelSecrets[] = [];
  try {
    const parsed = JSON.parse(raw) as { channels?: unknown };
    if (!Array.isArray(parsed.channels)) return 0;
    channels = parsed.channels as NotificationChannelSecrets[];
  } catch {
    return 0;
  }
  if (!channels.some((channel) => valueNeedsEncryption(channel.webhookUrl))) return 0;
  const encrypted = await encryptNotificationChannels(
    await decryptNotificationChannels(channels),
  );
  await setAppSetting(
    "notifications",
    JSON.stringify({ channels: encrypted }),
  );
  return 1;
}

export async function migratePlaintextSecrets(): Promise<{ updated: number }> {
  const flag = await getAppSetting(SECRETS_MIGRATED_KEY);
  if (flag === "true") return { updated: 0 };

  const updated = (await migrateIntegrations()) +
    (await migrateLlmProviders()) +
    (await migrateMcpServers()) +
    (await migrateNotifications());

  await setAppSetting(SECRETS_MIGRATED_KEY, "true");
  if (updated > 0) {
    log.info("encrypted plaintext secrets at rest", { updated });
  }
  return { updated };
}
