/**
 * Klien HTTP menu Doc Studio.
 *
 * Dipisah dari `lib/api.ts` (berkas besar) dan memakai pola `request` yang sama
 * supaya pesan error (`ApiError`) konsisten dengan fitur lain.
 */
import { ApiError, type LlmProvider, type Role } from "@/lib/api";

export interface DocTemplate {
  id: string;
  label: string;
  description: string;
  outline: string[];
  interviewTopics: string[];
}

export interface DocStudioTypeConfig {
  roleId: string | null;
  prompt: string;
}

export type DocStudioLanguage = "auto" | "id" | "en";

export interface DocStudioConfig {
  defaultRoleId: string | null;
  defaultProviderId: string | null;
  language: DocStudioLanguage;
  types: Record<string, DocStudioTypeConfig>;
  customTypes: DocTemplate[];
}

export interface DocStudioTemplatesResponse {
  templates: DocTemplate[];
  language: DocStudioLanguage;
  defaultRoleId: string | null;
  types: Record<string, DocStudioTypeConfig>;
}

export interface DocStudioSettingsResponse {
  config: DocStudioConfig;
  roles: Array<Pick<Role, "id" | "name">>;
  templates: DocTemplate[];
  customized: boolean;
  defaultPrompt: string;
}

export interface DocStudioDraft {
  id: string;
  projectId: string;
  typeId: string;
  roleId: string | null;
  title: string;
  status: "interviewing" | "ready" | "saved";
  documentPath: string | null;
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface DocStudioDraftResponse {
  draft: DocStudioDraft;
  reply: string;
  ready: boolean;
  template?: DocTemplate;
  roleName?: string | null;
}

export interface DocStudioFinalizeResponse {
  draft: DocStudioDraft;
  document: { path: string; title: string };
}

export interface DocStudioConfigPayload {
  defaultRoleId?: string | null;
  defaultProviderId?: string | null;
  language?: DocStudioLanguage;
  types?: Record<string, DocStudioTypeConfig>;
  customTypes?: DocTemplate[];
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { timeoutMs: _timeout, ...rest } = init ?? {};
    const res = await fetch(path, { ...rest, signal: controller.signal });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const error = (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
      throw new ApiError(res.status, error, data);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as Error).name === "AbortError") throw new ApiError(408, "Request timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const jsonInit = (method: string, body: unknown, timeoutMs?: number): RequestInit & {
  timeoutMs?: number;
} => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
  ...(timeoutMs ? { timeoutMs } : {}),
});

const base = (projectId: string) => `/api/projects/${projectId}/doc-studio/drafts`;

export const docStudioApi = {
  templates: () => request<DocStudioTemplatesResponse>("/api/doc-studio/templates"),
  getSettings: () => request<DocStudioSettingsResponse>("/api/settings/doc-studio"),
  saveSettings: (payload: DocStudioConfigPayload) =>
    request<DocStudioSettingsResponse>("/api/settings/doc-studio", jsonInit("PUT", payload)),
  listDrafts: (projectId: string) =>
    request<{ drafts: DocStudioDraft[] }>(base(projectId)),
  createDraft: (projectId: string, payload: { typeId: string; roleId?: string | null }) =>
    // Interview pertama memanggil LLM: butuh waktu lebih dari default 60s.
    request<DocStudioDraftResponse>(base(projectId), jsonInit("POST", payload, 180_000)),
  getDraft: (projectId: string, draftId: string) =>
    request<{ draft: DocStudioDraft }>(`${base(projectId)}/${draftId}`),
  sendTurn: (projectId: string, draftId: string, message: string) =>
    request<DocStudioDraftResponse>(
      `${base(projectId)}/${draftId}/turns`,
      jsonInit("POST", { message }, 180_000),
    ),
  finalize: (projectId: string, draftId: string, title?: string) =>
    request<DocStudioFinalizeResponse>(
      `${base(projectId)}/${draftId}/finalize`,
      jsonInit("POST", title ? { title } : {}, 300_000),
    ),
  deleteDraft: (projectId: string, draftId: string) =>
    request<{ ok: boolean }>(`${base(projectId)}/${draftId}`, { method: "DELETE" }),
};

export type { LlmProvider, Role };
