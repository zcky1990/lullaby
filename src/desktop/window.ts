import { appDataDir } from "../core/paths.ts";
import { directoryExists, pickDirectory } from "./dialogs.ts";

export function isDesktopRuntime(): boolean {
  return typeof Deno.BrowserWindow === "function";
}

export function createMainWindow(options: { title: string }): Deno.BrowserWindow | null {
  if (!isDesktopRuntime()) return null;

  const win = new Deno.BrowserWindow({
    title: options.title,
    width: 1200,
    height: 800,
    transparentTitlebar: Deno.build.os === "darwin",
  });

  win.bind("appInfo", () =>
    Promise.resolve({
      name: "Lullaby IDE",
      version: "0.1.0",
      dataDir: appDataDir(),
      platform: Deno.build.os,
    }));

  win.bind("chooseDirectory", () => pickDirectory());

  win.bind(
    "checkDirectory",
    async (path: unknown) => typeof path === "string" ? await directoryExists(path) : false,
  );

  return win;
}
