import type { RoleRow } from "../db/db.ts";
import { maskConfigSecrets, SECRET_CONFIG_KEYS, SECRET_MASK } from "./http.ts";

export function serializeIntegration(row: {
  kind: string;
  mode: string;
  config: string;
  updated_at: string;
}) {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(row.config) as Record<string, unknown>;
  } catch {
    config = {};
  }
  return {
    kind: row.kind,
    mode: row.mode,
    config: maskConfigSecrets(config),
    updatedAt: row.updated_at,
    hasSecrets: Object.keys(config).some((key) =>
      SECRET_CONFIG_KEYS.has(key) && typeof config[key] === "string" &&
      (config[key] as string).length > 0
    ),
  };
}

export function serializeLlm(row: {
  id: string;
  name: string;
  provider: string;
  model: string | null;
  base_url: string | null;
  api_key: string | null;
  config: string;
  mode: string;
  updated_at: string;
}) {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(row.config || "{}") as Record<string, unknown>;
  } catch {
    config = {};
  }
  const models = row.provider === "cursor" && Array.isArray(config.cursorModels)
    ? config.cursorModels
    : undefined;
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    model: row.model,
    baseUrl: row.base_url,
    apiKey: row.api_key ? SECRET_MASK : "",
    hasApiKey: Boolean(row.api_key),
    models,
    mode: row.mode,
    updatedAt: row.updated_at,
  };
}

export function serializeRole(row: RoleRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    persona: row.persona,
    providerId: row.provider_id ?? undefined,
    updatedAt: row.updated_at,
  };
}
