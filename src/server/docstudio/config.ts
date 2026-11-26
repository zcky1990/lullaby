/**
 * Konfigurasi Doc Studio (`app_settings.doc_studio`).
 *
 * Semua pengaturan fitur disimpan sebagai satu JSON supaya tidak menambah tabel:
 * role default, provider default, bahasa output, override per tipe dokumen, dan
 * daftar tipe kustom.
 */
import type { DocStudioConfigInput } from "../../config/schema_doc_studio.ts";
import {
  getAppSetting,
  getLlmProvider,
  getRole,
  listLlmProviders,
  listRoles,
  setAppSetting,
  type LlmProviderRow,
  type RoleRow,
} from "../../db/db.ts";
import type { DocStudioLanguage } from "./prompts.ts";
import { listDocTemplates, resolveDocTemplate, type DocTemplate } from "./templates.ts";

export const DOC_STUDIO_KEY = "doc_studio";

export interface DocStudioTypeConfig {
  roleId: string | null;
  prompt: string;
}

export interface DocStudioConfig {
  defaultRoleId: string | null;
  defaultProviderId: string | null;
  language: DocStudioLanguage;
  types: Record<string, DocStudioTypeConfig>;
  customTypes: DocTemplate[];
}

export const EMPTY_DOC_STUDIO_CONFIG: DocStudioConfig = {
  defaultRoleId: null,
  defaultProviderId: null,
  language: "auto",
  types: {},
  customTypes: [],
};

function asString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

function asLanguage(value: unknown): DocStudioLanguage {
  return value === "id" || value === "en" ? value : "auto";
}

function parseCustomTypes(raw: unknown): DocTemplate[] {
  if (!Array.isArray(raw)) return [];
  const out: DocTemplate[] = [];
  for (const item of raw.slice(0, 20)) {
    const record = item as Record<string, unknown> | null;
    if (!record || typeof record !== "object") continue;
    const id = asString(record.id, 64);
    const label = asString(record.label, 40);
    const outline = Array.isArray(record.outline)
      ? record.outline.map((line) => String(line).trim()).filter(Boolean).slice(0, 30)
      : [];
    const interviewTopics = Array.isArray(record.interviewTopics)
      ? record.interviewTopics.map((line) => String(line).trim()).filter(Boolean).slice(0, 20)
      : [];
    if (!id || !label || outline.length < 2) continue;
    out.push({
      id,
      label,
      description: asString(record.description, 200) ?? "",
      outline,
      interviewTopics: interviewTopics.length ? interviewTopics : outline,
    });
  }
  return out;
}

function parseTypes(raw: unknown): Record<string, DocStudioTypeConfig> {
  const out: Record<string, DocStudioTypeConfig> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const typeId = key.trim().slice(0, 64);
    if (!typeId) continue;
    const record = (value ?? {}) as Record<string, unknown>;
    out[typeId] = {
      roleId: asString(record.roleId, 80),
      prompt: typeof record.prompt === "string" ? record.prompt.slice(0, 20_000) : "",
    };
  }
  return out;
}

export async function readDocStudioConfig(): Promise<DocStudioConfig> {
  const raw = await getAppSetting(DOC_STUDIO_KEY);
  if (!raw) return { ...EMPTY_DOC_STUDIO_CONFIG, types: {}, customTypes: [] };
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    parsed = {};
  }
  return {
    defaultRoleId: asString(parsed.defaultRoleId, 80),
    defaultProviderId: asString(parsed.defaultProviderId, 80),
    language: asLanguage(parsed.language),
    types: parseTypes(parsed.types),
    customTypes: parseCustomTypes(parsed.customTypes),
  };
}

/**
 * Simpan konfigurasi. Field yang tidak ada di payload tidak menimpa nilai
 * tersimpan (payload lama dari UI versi sebelumnya tetap aman).
 */
export async function writeDocStudioConfig(
  input: DocStudioConfigInput,
): Promise<DocStudioConfig> {
  const existing = await readDocStudioConfig();
  const next: DocStudioConfig = {
    defaultRoleId: input.defaultRoleId === undefined
      ? existing.defaultRoleId
      : asString(input.defaultRoleId, 80),
    defaultProviderId: input.defaultProviderId === undefined
      ? existing.defaultProviderId
      : asString(input.defaultProviderId, 80),
    language: input.language === undefined ? existing.language : asLanguage(input.language),
    types: input.types === undefined ? existing.types : parseTypes(input.types),
    customTypes: input.customTypes === undefined
      ? existing.customTypes
      : parseCustomTypes(input.customTypes),
  };
  await setAppSetting(DOC_STUDIO_KEY, JSON.stringify(next));
  return next;
}

export async function availableDocTemplates(cfg?: DocStudioConfig): Promise<DocTemplate[]> {
  const config = cfg ?? (await readDocStudioConfig());
  return listDocTemplates(config.customTypes);
}

export function docStudioTemplate(
  typeId: string,
  cfg: DocStudioConfig,
): DocTemplate | null {
  return resolveDocTemplate(typeId, cfg.customTypes);
}

/** Role efektif: override role per tipe (draft → tipe → default). */
export async function resolveDocStudioRole(
  typeId: string,
  cfg: DocStudioConfig,
  draftRoleId?: string | null,
): Promise<RoleRow | null> {
  const candidate = draftRoleId || cfg.types[typeId]?.roleId || cfg.defaultRoleId;
  if (!candidate) return null;
  const role = await getRole(candidate);
  if (!role) return null;
  return role;
}

/**
 * Provider efektif: provider role → provider default config → provider pertama.
 * Urutan ini sama dengan cara generate-ticket memilih provider saat tidak ada
 * `providerId` eksplisit, jadi perilakunya konsisten.
 */
export async function resolveDocStudioProvider(
  cfg: DocStudioConfig,
  role?: RoleRow | null,
): Promise<LlmProviderRow | null> {
  if (role?.provider_id) {
    const fromRole = await getLlmProvider(role.provider_id);
    if (fromRole) return fromRole;
  }
  if (cfg.defaultProviderId) {
    const fromConfig = await getLlmProvider(cfg.defaultProviderId);
    if (fromConfig) return fromConfig;
  }
  const providers = await listLlmProviders();
  return providers[0] ?? null;
}

/** Validasi referensi role/provider dari payload settings. */
export async function docStudioConfigReferencesValid(
  input: DocStudioConfigInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.defaultRoleId) {
    const role = await getRole(input.defaultRoleId);
    if (!role) return { ok: false, error: "role_not_found" };
  }
  if (input.defaultProviderId) {
    const provider = await getLlmProvider(input.defaultProviderId);
    if (!provider) return { ok: false, error: "provider_not_found" };
  }
  for (const [typeId, value] of Object.entries(input.types ?? {})) {
    if (!value.roleId) continue;
    const role = await getRole(value.roleId);
    if (!role) return { ok: false, error: `role_not_found:${typeId}` };
  }
  return { ok: true };
}

/** Ringkasan untuk respons GET settings (nama role/provider, bukan id saja). */
export async function docStudioConfigPayload(): Promise<{
  config: DocStudioConfig;
  roles: Array<{ id: string; name: string }>;
  templates: DocTemplate[];
  customized: boolean;
}> {
  const config = await readDocStudioConfig();
  const roles = await listRoles();
  return {
    config,
    roles: roles.map((role) => ({ id: role.id, name: role.name })),
    templates: listDocTemplates(config.customTypes),
    customized: Boolean(
      config.defaultRoleId ||
        config.defaultProviderId ||
        config.language !== "auto" ||
        Object.keys(config.types).length ||
        config.customTypes.length,
    ),
  };
}
