import { useRef, useState } from "react";
import {
  Database,
  Download,
  FileJson,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  backupFileName,
  BACKUP_TABLE_LABELS,
  downloadBackupFile,
  exportGlobalBackup,
  exportProjectBackup,
  importGlobalBackup,
  importProjectBackup,
  readBackupFile,
  saveGlobalBackupToDisk,
  saveProjectBackupToDisk,
  summarizeImport,
  type BackupBundle,
  type BackupImportResult,
  type BackupMode,
  type BackupScope,
} from "@/lib/backup";
import { cn } from "@/lib/utils";

interface Props {
  scope: BackupScope;
  projectId?: string | null;
}

interface FilePreview {
  name: string;
  exportedAt: string;
  includeSecrets: boolean;
  counts: Array<[string, number]>;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function previewFromBundle(bundle: BackupBundle, name: string): FilePreview {
  const counts: Array<[string, number]> = [];
  for (const [table, rows] of Object.entries(bundle.tables ?? {})) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    counts.push([table, rows.length]);
  }
  if (bundle.settings && Object.keys(bundle.settings).length > 0) {
    counts.unshift(["app_settings", Object.keys(bundle.settings).length]);
  }
  if (bundle.llmProviders?.length) counts.push(["llm_providers", bundle.llmProviders.length]);
  if (bundle.roles?.length) counts.push(["roles", bundle.roles.length]);
  counts.sort((a, b) => b[1] - a[1]);
  return {
    name,
    exportedAt: bundle.exportedAt ?? "—",
    includeSecrets: bundle.includeSecrets === true,
    counts,
  };
}

export function BackupSettings({ scope, projectId }: Props) {
  const isGlobal = scope === "global";
  const ready = isGlobal || !!projectId;
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [mode, setMode] = useState<BackupMode>("merge");
  const [busy, setBusy] = useState<"download" | "save" | "import" | null>(null);
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [savedPath, setSavedPath] = useState<string | undefined>();
  const [result, setResult] = useState<BackupImportResult | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const resetFeedback = () => {
    setMessage(undefined);
    setError(undefined);
    setSavedPath(undefined);
  };

  const download = async () => {
    if (!ready || busy) return;
    resetFeedback();
    setBusy("download");
    try {
      const bundle = isGlobal
        ? await exportGlobalBackup(includeSecrets)
        : await exportProjectBackup(projectId!, includeSecrets);
      downloadBackupFile(bundle, backupFileName(scope, projectId));
      setMessage(
        `File backup dibuat (${formatBytes(JSON.stringify(bundle).length)}). ` +
          "Jika unduhan diblokir, pakai “Simpan ke folder backup”.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveToDisk = async () => {
    if (!ready || busy) return;
    resetFeedback();
    setBusy("save");
    try {
      const saved = isGlobal
        ? await saveGlobalBackupToDisk(includeSecrets)
        : await saveProjectBackupToDisk(projectId!, includeSecrets);
      setSavedPath(saved.path);
      setMessage(`Backup tersimpan di disk (${formatBytes(saved.bytes)}).`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pickFile = async (file: File | null) => {
    resetFeedback();
    setResult(null);
    setPreview(null);
    setImportFile(file);
    if (!file) return;
    try {
      const bundle = await readBackupFile(file, scope);
      setPreview(previewFromBundle(bundle, file.name));
    } catch (e) {
      setImportFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setError((e as Error).message);
    }
  };

  const runImport = async () => {
    if (!importFile || !ready || busy) return;
    const confirmText = isGlobal
      ? `Import mode REPLACE akan MENGHAPUS seluruh config & database aplikasi ` +
        `(project, tiket, chat, workflow), lalu menggantinya dengan isi file backup.\n\n` +
        `Lanjutkan?`
      : `Import mode REPLACE akan menghapus tiket lokal, dokumen lokal, sesi chat, ` +
        `integration, dan workflow milik project ini, lalu menggantinya dengan isi backup.\n\n` +
        `Lanjutkan?`;
    if (mode === "replace" && !confirm(confirmText)) return;

    resetFeedback();
    setBusy("import");
    try {
      const bundle = await readBackupFile(importFile, scope);
      const imported = isGlobal
        ? await importGlobalBackup(bundle, mode)
        : await importProjectBackup(projectId!, bundle, mode);
      setResult(imported);
      setMessage(summarizeImport(imported));
      setImportFile(null);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      if (isGlobal) setNeedsReload(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Export {isGlobal ? "global" : "project"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {isGlobal
              ? "Menyimpan seluruh config (settings, LLM provider, role, integrasi) dan database " +
                "(project, tiket lokal, dokumen lokal, riwayat chat, workflow) ke satu file JSON."
              : "Menyimpan config integration project ini beserta database-nya: tiket lokal, " +
                "dokumen lokal, riwayat chat, dan workflow run."}
          </p>
          <Separator />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-2 text-xs font-medium">
              Sertakan nilai rahasia
              {includeSecrets ? <Badge variant="destructive">plain text</Badge> : null}
            </span>
            <span className="text-xs text-muted-foreground">
              API key, token integrasi, dan webhook URL disertakan apa adanya. Tanpa opsi ini,
              nilainya diganti <span className="font-mono">{SECRET_MASK_PREVIEW}</span>.
            </span>
            {includeSecrets ? (
              <span className="flex items-center gap-1 text-xs text-destructive">
                <ShieldAlert className="size-3" />
                Simpan file di tempat aman.
              </span>
            ) : null}
          </div>
          <Switch
            checked={includeSecrets}
            onCheckedChange={setIncludeSecrets}
            aria-label="Sertakan nilai rahasia"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={download}
            disabled={!ready || busy !== null}
            data-icon="inline-start"
          >
            {busy === "download" ? <Loader2 className="animate-spin" /> : <Download />}
            Unduh backup
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={saveToDisk}
            disabled={!ready || busy !== null}
            data-icon="inline-start"
          >
            {busy === "save" ? <Loader2 className="animate-spin" /> : <Database />}
            Simpan ke folder backup
          </Button>
          {busy ? <span className="text-xs text-muted-foreground">Menyiapkan…</span> : null}
        </div>

        {savedPath ? (
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <p className="font-medium">File backup</p>
            <p className="break-all font-mono text-[11px] text-muted-foreground">{savedPath}</p>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Import {isGlobal ? "global" : "project"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {isGlobal
              ? "Memulihkan config & database dari file backup. Gunakan mode Merge untuk " +
                "menambal data yang ada, atau Replace untuk mengganti seluruh isi."
              : "Memulihkan data dari file backup ke project ini. Tiket, sesi chat, dan " +
                "workflow run diimpor sebagai salinan baru."}
          </p>
          <Separator />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">Mode import</span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={mode}
            onValueChange={(value) => value && setMode(value as BackupMode)}
            className="w-fit"
          >
            <ToggleGroupItem value="merge" aria-label="Mode merge">
              Merge
            </ToggleGroupItem>
            <ToggleGroupItem value="replace" aria-label="Mode replace">
              Replace (hapus data lama)
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            {mode === "merge"
              ? "Data lama dipertahankan; baris dengan id sama akan ditimpa."
              : "Data lama dihapus lebih dulu sebelum import. Tidak bisa dibatalkan."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void pickFile(event.target.files?.[0] ?? null)}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null}
            data-icon="inline-start"
          >
            <FileJson />
            Pilih file backup
          </Button>
          <Button
            size="sm"
            onClick={runImport}
            disabled={!importFile || !ready || busy !== null}
            data-icon="inline-start"
          >
            {busy === "import" ? <Loader2 className="animate-spin" /> : <Upload />}
            Import
          </Button>
          {!ready ? (
            <span className="text-xs text-muted-foreground">Pilih project dulu.</span>
          ) : null}
        </div>

        {preview ? (
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <p className="font-medium">Preview file</p>
            <p className="text-muted-foreground">
              {preview.name} · diekspor {preview.exportedAt}
              {preview.includeSecrets ? " · berisi rahasia" : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {preview.counts.length === 0 ? (
                <span className="text-muted-foreground">Tidak ada data.</span>
              ) : (
                preview.counts.slice(0, 10).map(([table, count]) => (
                  <Badge key={table} variant="secondary" className="text-[10px]">
                    {BACKUP_TABLE_LABELS[table] ?? table}: {count}
                  </Badge>
                ))
              )}
            </div>
          </div>
        ) : null}
      </section>

      {message ? (
        <div className="flex flex-col gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-xs">
          <span className="flex items-center gap-2 font-medium">
            <Database className="size-3" />
            {message}
          </span>
          {result ? (
            <div className="flex flex-wrap gap-1">
              {Object.entries(result.imported)
                .filter(([, count]) => count > 0)
                .map(([table, count]) => (
                  <Badge key={table} variant="outline" className="text-[10px]">
                    {BACKUP_TABLE_LABELS[table] ?? table}: {count}
                  </Badge>
                ))}
            </div>
          ) : null}
          {needsReload ? (
            <Button
              size="sm"
              variant="outline"
              className={cn("w-fit")}
              onClick={() => window.location.reload()}
              data-icon="inline-start"
            >
              <RefreshCw />
              Muat ulang aplikasi
            </Button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  );
}

const SECRET_MASK_PREVIEW = "••••••••";
