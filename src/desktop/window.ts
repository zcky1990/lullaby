import { appDataDir } from "../core/paths.ts";
import { directoryExists, pickDirectory } from "./dialogs.ts";

export function isDesktopRuntime(): boolean {
  return typeof Deno.BrowserWindow === "function";
}

export function createMainWindow(options: { title: string }): Deno.BrowserWindow | null {
  if (!isDesktopRuntime()) return null;

  const win = new Deno.BrowserWindow({ title: options.title, width: 1200, height: 800 });

  win.bind("appInfo", () =>
    Promise.resolve({
      name: "RND Workflow",
      version: "0.1.0",
      dataDir: appDataDir(),
    }));

  win.bind("chooseDirectory", () => pickDirectory());

  win.bind(
    "checkDirectory",
    async (path: unknown) => typeof path === "string" ? await directoryExists(path) : false,
  );

  return win;
}
