interface AppBindings {
  appInfo?: () => Promise<{ name: string; version: string; dataDir: string }>;
  chooseDirectory?: () => Promise<string | null>;
  checkDirectory?: (path: string) => Promise<boolean>;
}

export function getBindings(): AppBindings | undefined {
  return (globalThis as unknown as { bindings?: AppBindings }).bindings;
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
