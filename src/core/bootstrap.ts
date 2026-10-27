import { appendEvent, getDb, markInterruptedWorkflowRuns, pruneEvents } from "../db/db.ts";
import { installDefaultSkills } from "../server/skills.ts";
import { log } from "./logger.ts";
import { appDataDir, ensureAppDataDir } from "./paths.ts";

export async function bootstrap(): Promise<void> {
  const dir = await ensureAppDataDir();
  await getDb();
  await pruneEvents(1000);
  await markInterruptedWorkflowRuns();
  const installedSkills = await installDefaultSkills();
  if (installedSkills.length > 0) {
    log.info("installed default skills", { skills: installedSkills });
  }
  await appendEvent("app.started", { dataDir: dir });
  log.info("bootstrap complete", { dataDir: appDataDir() });
}
