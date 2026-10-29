interface AppBindings {
  appInfo?: () => Promise<{
    name: string;
    version: string;
    dataDir: string;
    platform?: string;
  }>;
  chooseDirectory?: () => Promise<string | null>;
  checkDirectory?: (path: string) => Promise<boolean>;
}

export function getBindings(): AppBindings | undefined {
  return (globalThis as unknown as { bindings?: AppBindings }).bindings;
}

export async function getAppPlatform(): Promise<string | null> {
  const bindings = getBindings();
  if (!bindings?.appInfo) return null;
  try {
    const info = await bindings.appInfo();
    return typeof info.platform === "string" ? info.platform : null;
  } catch {
    return null;
  }
}

export function canPickDirectory(): boolean {
  return typeof getBindings()?.chooseDirectory === "function";
}

export async function chooseWorkspaceDirectory(): Promise<string | null> {
  const bindings = getBindings();
  if (!bindings?.chooseDirectory) return null;
  try {
    const result = await bindings.chooseDirectory();
    return typeof result === "string" && result.length > 0 ? result : null;
  } catch {
    return null;
  }
}
