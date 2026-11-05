import { getLlmProvider, listLlmProviders, updateLlmProviderConfig } from "../../db/db.ts";
import { log } from "../../core/logger.ts";
import { type CursorModelInfo, listCursorModels } from "./cursor.ts";

function parseProviderConfig(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function storeCursorModels(
  providerId: string,
  models: CursorModelInfo[],
): Promise<void> {
  const existing = await getLlmProvider(providerId);
  if (!existing) return;
  const config = parseProviderConfig(existing.config);
  await updateLlmProviderConfig(providerId, {
    ...config,
    cursorModels: models,
    cursorModelsUpdatedAt: new Date().toISOString(),
  });
}

export async function refreshCursorModels(
  providerId: string,
  apiKey: string,
): Promise<CursorModelInfo[]> {
  const models = await listCursorModels(apiKey);
  await storeCursorModels(providerId, models);
  return models;
}

export async function syncConfiguredCursorModels(): Promise<number> {
  const providers = await listLlmProviders();
  let synced = 0;
  for (const provider of providers) {
    if ((provider.provider || "").toLowerCase() !== "cursor") continue;
    const apiKey = provider.api_key?.trim();
    if (!apiKey) continue;
    try {
      await refreshCursorModels(provider.id, apiKey);
      synced += 1;
    } catch (error) {
      log.warn("cursor model sync failed", {
        providerId: provider.id,
        error: String(error),
      });
    }
  }
  return synced;
}
