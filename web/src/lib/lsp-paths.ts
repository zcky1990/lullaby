export function fileUri(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const prefix = normalized.startsWith("/") ? "file://" : "file:///";
  return `${prefix}${
    normalized
      .split("/")
      .map((segment, index) => {
        if (index === 0 && segment === "") return "";
        if (index === 0 && /^[A-Za-z]:$/.test(segment)) return segment;
        return encodeURIComponent(segment);
      })
      .join("/")
  }`;
}

export function normalizeWorkspacePath(workspace: string, path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return normalized;
  const root = workspace.replace(/\\/g, "/").replace(/\/+$/, "");
  return `${root}/${normalized.replace(/^\/+/, "")}`;
}

export function lspLanguageId(path: string, fallback: string): string {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const ext = name.includes(".") ? name.split(".").pop() ?? "" : "";
  switch (ext) {
    case "tsx":
      return "typescriptreact";
    case "jsx":
      return "javascriptreact";
    case "ts":
    case "mts":
    case "cts":
      return "typescript";
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    default:
      return fallback;
  }
}
