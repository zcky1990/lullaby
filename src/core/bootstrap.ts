import { appendEvent, getDb, markInterruptedWorkflowRuns, pruneEvents } from "../db/db.ts";
import { ensureChatSessionTombstones } from "../db/chat-tombstones.ts";
import { migratePlaintextSecrets } from "../secrets/migrate.ts";
import { syncConfiguredCursorModels } from "../server/chat/cursor-models.ts";
import { installDefaultSkills } from "../server/skills.ts";
import { startWorkflowScheduler } from "../server/workflow/scheduler.ts";
import { log } from "./logger.ts";
import { appDataDir, ensureAppDataDir } from "./paths.ts";

/** Blocking work required before the HTTP server / window can open. */
export async function bootstrap(): Promise<void> {
  const dir = await ensureAppDataDir();
  await getDb();
  try {
    // Trigger tombstone: sesi chat Cursor yang dihapus user tidak di-import ulang
    // dari SDK Cursor pada `GET /chat/sessions` berikutnya.
    await ensureChatSessionTombstones();
  } catch (error) {
    log.warn("cursor chat tombstones skipped", { error: String(error) });
  }
  try {
    await migratePlaintextSecrets();
  } catch (error) {
    log.warn("secrets migration skipped", { error: String(error) });
  }
  await pruneEvents(1000);
  await markInterruptedWorkflowRuns();
  const installedSkills = await installDefaultSkills();
  if (installedSkills.length > 0) {
    log.info("installed default skills", { skills: installedSkills });
  }
  startWorkflowScheduler();
  await appendEvent("app.started", { dataDir: dir });
  log.info("bootstrap complete", { dataDir: appDataDir() });
}

/** Non-blocking work that must not delay first paint / listen. */
export function bootstrapBackground(): void {
  void (async () => {
    try {
      const synced = await syncConfiguredCursorModels();
      if (synced > 0) {
        log.info("synced cursor models", { providers: synced });
      }
    } catch (error) {
      log.warn("cursor model sync skipped", { error: String(error) });
    }
  })();
}
