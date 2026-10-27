import { appendEvent, getDb, markInterruptedWorkflowRuns, pruneEvents } from "../db/db.ts";
import { log } from "./logger.ts";
import { appDataDir, ensureAppDataDir } from "./paths.ts";

export async function bootstrap(): Promise<void> {
  const dir = await ensureAppDataDir();
  await getDb();
  await pruneEvents(1000);
  await markInterruptedWorkflowRuns();
  await appendEvent("app.started", { dataDir: dir });
  log.info("bootstrap complete", { dataDir: appDataDir() });
}
