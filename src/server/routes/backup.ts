import { join } from "node:path";
import {
  applyGlobalBackup,
  applyProjectBackup,
  backupFilename,
  buildGlobalBackup,
  buildProjectBackup,
  type BackupMode,
  validateBackupBundle,
} from "../backup.ts";
import { appDataDir, ensureAppDataDir } from "../../core/paths.ts";
import { HttpError, isAuthorized, json, readJson, record } from "../http.ts";

const GLOBAL_BACKUP_PATH = "/api/backup/global";
const PROJECT_BACKUP_PATTERN = /^\/api\/projects\/([^/]+)\/backup$/;

/** `?secrets=1` menyertakan nilai rahasia (api key, token, webhook) di file backup. */
function wantsSecrets(url: URL): boolean {
  const raw = url.searchParams.get("secrets");
  return raw === "1" || raw === "true";
}

/** `?save=1` menulis file ke `<data dir>/backups` dan mengembalikan path-nya. */
function wantsSave(url: URL): boolean {
  const raw = url.searchParams.get("save");
  return raw === "1" || raw === "true";
}

function parseMode(value: unknown): BackupMode {
  return value === "replace" ? "replace" : "merge";
}

/**
 * Route backup/restore. Mengembalikan `null` bila path bukan milik modul ini,
 * sehingga `handleRequest` di router tetap menangani route lain.
 */
export async function handleBackupRequest(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method.toUpperCase();
  const isGlobal = pathname === GLOBAL_BACKUP_PATH;
  const projectMatch = PROJECT_BACKUP_PATTERN.exec(pathname);
  if (!isGlobal && !projectMatch) return null;

  if (!isAuthorized(req)) return json({ error: "unauthorized" }, 401);

  const scope = isGlobal ? "global" : "project";
  const projectId = projectMatch ? decodeURIComponent(projectMatch[1]) : null;

  if (method === "GET") {
    try {
      const includeSecrets = wantsSecrets(url);
      const bundle = isGlobal
        ? await buildGlobalBackup({ includeSecrets })
        : await buildProjectBackup(projectId!, { includeSecrets });
      const filename = backupFilename(scope, projectId);

      if (wantsSave(url)) {
        const dir = join(appDataDir(), "backups");
        await ensureAppDataDir();
        await Deno.mkdir(dir, { recursive: true });
        const path = join(dir, filename);
        const text = JSON.stringify(bundle, null, 2);
        await Deno.writeTextFile(path, text);
        await record("backup.exported", { scope, includeSecrets, path });
        return json({ ok: true, path, bytes: new TextEncoder().encode(text).byteLength });
      }

      await record("backup.exported", { scope, includeSecrets });
      return new Response(JSON.stringify(bundle, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "no-store",
        },
      });
    } catch (error) {
      const message = (error as Error).message;
      return json({ error: message }, message === "project_not_found" ? 404 : 500);
    }
  }

  if (method === "POST" || method === "PUT") {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (error) {
      if (error instanceof HttpError) return json(error.body, error.status);
      return json({ error: "invalid_json" }, 400);
    }
    const payload = (body ?? {}) as { bundle?: unknown; mode?: unknown };
    const parsed = validateBackupBundle(payload.bundle, scope);
    if (!parsed.ok) {
      return json({ error: "invalid_backup", message: parsed.error }, 400);
    }
    const mode = parseMode(payload.mode);
    try {
      const result = isGlobal
        ? await applyGlobalBackup(parsed.bundle, mode)
        : await applyProjectBackup(projectId!, parsed.bundle, mode);
      await record("backup.imported", { scope, mode, imported: result.imported });
      return json(result);
    } catch (error) {
      const message = (error as Error).message;
      return json({ error: message }, message === "project_not_found" ? 404 : 500);
    }
  }

  return json({ error: "method_not_allowed" }, 405);
}
