import { describe, expect, it } from "vitest";
import {
  BACKUP_TABLE_LABELS,
  backupFileName,
  readBackupFile,
  summarizeImport,
  type BackupBundle,
  type BackupImportResult,
} from "./backup";

function bundle(overrides: Partial<BackupBundle> = {}): BackupBundle {
  return {
    format: "lullaby-backup",
    version: 1,
    scope: "global",
    exportedAt: "2024-01-01T00:00:00.000Z",
    appVersion: "0.1.0",
    includeSecrets: false,
    tables: {},
    ...overrides,
  };
}

function result(imported: Record<string, number>): BackupImportResult {
  return { ok: true, scope: "global", mode: "merge", imported };
}

describe("backup helpers", () => {
  it("membuat nama file sesuai scope", () => {
    expect(backupFileName("global")).toMatch(/^lullaby-global-backup-.+\.json$/);
    expect(backupFileName("project", "proj-1")).toMatch(/^lullaby-project-proj-1-.+\.json$/);
    expect(backupFileName("project", null)).toContain("lullaby-project-backup-");
  });

  it("meringkas hasil import", () => {
    expect(summarizeImport(result({}))).toContain("Tidak ada data");
    const text = summarizeImport(result({ local_tickets: 3, chat_sessions: 1, chat_messages: 0 }));
    expect(text).toContain("4 baris diimpor");
    expect(text).toContain("Tiket lokal: 3");
    expect(text).toContain("Sesi chat: 1");
    expect(text).not.toContain("Pesan chat");
  });

  it("membaca file backup yang valid", async () => {
    const file = new File([JSON.stringify(bundle())], "global.json", {
      type: "application/json",
    });
    const parsed = await readBackupFile(file, "global");
    expect(parsed.scope).toBe("global");
  });

  it("menolak file dengan scope berbeda", async () => {
    const file = new File([JSON.stringify(bundle({ scope: "project" }))], "project.json");
    await expect(readBackupFile(file, "global")).rejects.toThrow(/backup project/i);
  });

  it("menolak file yang bukan backup Lullaby", async () => {
    const notJson = new File(["bukan json"], "notes.json");
    await expect(readBackupFile(notJson, "global")).rejects.toThrow(/JSON/);

    const other = new File([JSON.stringify({ format: "lain", tables: {} })], "other.json");
    await expect(readBackupFile(other, "global")).rejects.toThrow(/bukan backup Lullaby/);
  });

  it("menolak backup tanpa tabel", async () => {
    const file = new File([JSON.stringify({ format: "lullaby-backup", scope: "global" })], "x.json");
    await expect(readBackupFile(file, "global")).rejects.toThrow(/tabel/i);
  });

  it("punya label untuk semua tabel yang diekspor", () => {
    for (
      const table of [
        "app_settings",
        "llm_providers",
        "roles",
        "projects",
        "project_integrations",
        "local_tickets",
        "local_documents",
        "chat_sessions",
        "chat_messages",
        "workflow_sessions",
        "workflow_session_messages",
        "workflow_runs",
        "workflow_run_steps",
        "workflow_schedules",
      ]
    ) {
      expect(BACKUP_TABLE_LABELS[table]).toBeTruthy();
    }
  });
});
