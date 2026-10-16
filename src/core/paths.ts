import { join } from "node:path";

export function appDataDir(): string {
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

export async function ensureAppDataDir(): Promise<string> {
  const dir = appDataDir();
  await Deno.mkdir(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return join(appDataDir(), "data.db");
}

export function configPath(): string {
  return join(appDataDir(), "config.json");
}
