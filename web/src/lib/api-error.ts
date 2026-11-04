export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** Prefer API `message` (+ `issues`) over the opaque `error` code. */
export function formatApiError(error: unknown, fallback = "Request failed"): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : fallback;
  }
  const body = error.body as
    | { error?: string; message?: string; issues?: unknown }
    | null
    | undefined;
  const base = (typeof body?.message === "string" && body.message.trim())
    ? body.message.trim()
    : (typeof body?.error === "string" && body.error.trim())
    ? body.error.trim()
    : (error.message || fallback);
  const issues = body?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return base;
  const lines = issues.map((issue) => {
    if (typeof issue === "string") return issue;
    if (issue && typeof issue === "object" && "message" in issue) {
      const path = "path" in issue && Array.isArray(issue.path)
        ? issue.path.join(".")
        : "";
      const msg = String((issue as { message: unknown }).message);
      return path ? `${path}: ${msg}` : msg;
    }
    return JSON.stringify(issue);
  });
  return `${base}\n${lines.join("\n")}`;
}
