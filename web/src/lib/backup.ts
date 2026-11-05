import { ApiError } from "@/lib/api-error";

export type BackupScope = "global" | "project";
export type BackupMode = "merge" | "replace";

export interface BackupBundle {
  format: string;
  version: number;
  scope: BackupScope;
  exportedAt: string;
  appVersion: string;
  includeSecrets: boolean;
  settings?: Record<string, unknown>;
  llmProviders?: Array<Record<string, unknown>>;
  roles?: Array<Record<string, unknown>>;
  project?: Record<string, unknown> | null;
  integrations?: Array<{ kind: string; mode: string; config: Record<string, unknown> }>;
  tables: Record<string, Array<Record<string, unknown>>>;
}

export interface BackupImportResult {
  ok: boolean;
  scope: BackupScope;
  mode: BackupMode;
  imported: Record<string, number>;
}

export interface BackupSaveResult {
  ok: boolean;
  path: string;
  bytes: number;
}

const BACKUP_TIMEOUT_MS = 300_000;

export const BACKUP_TABLE_LABELS: Record<string, string> = {
  app_settings: "Settings",
  llm_providers: "LLM provider",
  roles: "Roles",
  projects: "Project",
  project_integrations: "Integrasi",
  local_tickets: "Tiket lokal",
  local_documents: "Dokumen lokal",
  chat_sessions: "Sesi chat",
  chat_messages: "Pesan chat",
  workflow_sessions: "Sesi workflow",
  workflow_session_messages: "Pesan workflow",
  workflow_runs: "Workflow run",
  workflow_run_steps: "Step run",
  workflow_schedules: "Jadwal workflow",
};

/** Ringkasan singkat hasil import untuk ditampilkan di UI. */
export function summarizeImport(result: BackupImportResult): string {
  const entries = Object.entries(result.imported ?? {}).filter(([, count]) => count > 0);
  if (entries.length === 0) {
    return "Tidak ada data yang diimpor (backup kosong).";
  }
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const detail = entries
    .slice(0, 6)
    .map(([table, count]) => `${BACKUP_TABLE_LABELS[table] ?? table}: ${count}`)
    .join(", ");
  const suffix = entries.length > 6 ? ", …" : "";
  return `${total} baris diimpor — ${detail}${suffix}`;
}

export function backupFileName(scope: BackupScope, projectId?: string | null): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return scope === "global"
    ? `lullaby-global-backup-${stamp}.json`
    : `lullaby-project-${projectId ?? "backup"}-${stamp}.json`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKUP_TIMEOUT_MS);
  try {
    const res = await fetch(path, { ...init, signal: controller.signal });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const payload = data as { error?: string; message?: string } | null;
      throw new ApiError(
        res.status,
        payload?.message ?? payload?.error ?? `HTTP ${res.status}`,
        data,
      );
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as Error).name === "AbortError") {
      throw new ApiError(408, "Request timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function exportGlobalBackup(includeSecrets: boolean): Promise<BackupBundle> {
  return await requestJson<BackupBundle>(
    `/api/backup/global?secrets=${includeSecrets ? "1" : "0"}`,
  );
}

export async function exportProjectBackup(
  projectId: string,
  includeSecrets: boolean,
): Promise<BackupBundle> {
  return await requestJson<BackupBundle>(
    `/api/projects/${projectId}/backup?secrets=${includeSecrets ? "1" : "0"}`,
  );
}

/** Simpan langsung ke folder `backups/` di data dir aplikasi (fallback tanpa dialog unduh). */
export async function saveGlobalBackupToDisk(includeSecrets: boolean): Promise<BackupSaveResult> {
  return await requestJson<BackupSaveResult>(
    `/api/backup/global?secrets=${includeSecrets ? "1" : "0"}&save=1`,
  );
}

export async function saveProjectBackupToDisk(
  projectId: string,
  includeSecrets: boolean,
): Promise<BackupSaveResult> {
  return await requestJson<BackupSaveResult>(
    `/api/projects/${projectId}/backup?secrets=${includeSecrets ? "1" : "0"}&save=1`,
  );
}

export async function importGlobalBackup(
  bundle: unknown,
  mode: BackupMode,
): Promise<BackupImportResult> {
  return await requestJson<BackupImportResult>("/api/backup/global", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bundle, mode }),
  });
}

export async function importProjectBackup(
  projectId: string,
  bundle: unknown,
  mode: BackupMode,
): Promise<BackupImportResult> {
  return await requestJson<BackupImportResult>(`/api/projects/${projectId}/backup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bundle, mode }),
  });
}

export async function readBackupFile(
  file: File,
  expectedScope: BackupScope,
): Promise<BackupBundle> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("File bukan JSON yang valid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Isi file backup tidak valid.");
  }
  const bundle = parsed as Partial<BackupBundle>;
  if (bundle.format !== "lullaby-backup") {
    throw new Error("File bukan backup Lullaby.");
  }
  if (bundle.scope !== expectedScope) {
    throw new Error(
      expectedScope === "global"
        ? "File ini backup project. Buka import dari Project Settings → Backup."
        : "File ini backup global. Buka import dari Global Settings → Backup.",
    );
  }
  if (!bundle.tables || typeof bundle.tables !== "object") {
    throw new Error("File backup tidak memuat data tabel.");
  }
  return bundle as BackupBundle;
}

/** Unduh bundle sebagai file JSON lewat browser/webview. */
export function downloadBackupFile(bundle: BackupBundle, fileName: string): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
