import { join } from "node:path";

export function appDataDir(): string {
  const override = Deno.env.get("RND_APP_DATA_DIR")?.trim();
  if (override) return override;

  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? Deno.cwd();
  switch (Deno.build.os) {
    case "darwin":
      return join(home, "Library", "Application Support", "Lullaby");
    case "windows":
      return join(Deno.env.get("APPDATA") ?? home, "Lullaby");
    default:
      return join(
        Deno.env.get("XDG_DATA_HOME") ?? join(home, ".local", "share"),
        "lullaby",
      );
  }
}

/** Pre-rebrand location; used once to migrate existing installs. */
function legacyAppDataDir(): string | null {
  if (Deno.env.get("RND_APP_DATA_DIR")?.trim()) return null;
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? Deno.cwd();
  switch (Deno.build.os) {
    case "darwin":
      return join(home, "Library", "Application Support", "RND Workflow");
    case "windows":
      return join(Deno.env.get("APPDATA") ?? home, "RND Workflow");
    default:
      return join(
        Deno.env.get("XDG_DATA_HOME") ?? join(home, ".local", "share"),
        "rnd-workflow",
      );
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function migrateLegacyAppData(dir: string): Promise<void> {
  const legacy = legacyAppDataDir();
  if (!legacy || legacy === dir) return;
  if (await exists(join(dir, "data.db"))) return;
  if (!(await exists(join(legacy, "data.db")))) return;

  if (!(await exists(dir))) {
    try {
      await Deno.rename(legacy, dir);
      return;
    } catch {
      // fall through
    }
  }

  await Deno.mkdir(dir, { recursive: true });
  try {
    await Deno.rename(join(legacy, "data.db"), join(dir, "data.db"));
  } catch {
    try {
      await Deno.copyFile(join(legacy, "data.db"), join(dir, "data.db"));
    } catch {
      // leave legacy in place
    }
  }
}

export async function ensureAppDataDir(): Promise<string> {
  const dir = appDataDir();
  await migrateLegacyAppData(dir);
  await Deno.mkdir(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return join(appDataDir(), "data.db");
}

export function configPath(): string {
  return join(appDataDir(), "config.json");
}
