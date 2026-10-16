type Level = "debug" | "info" | "warn" | "error";

const REDACT = /(api[_-]?key|token|authorization|password|secret)/i;

function redact(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT.test(k) ? "[redacted]" : redact(v);
  }
  return out;
}

function emit(level: Level, message: string, meta?: unknown) {
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta === undefined ? {} : { meta: redact(meta) }),
  };
  const writer = level === "error" ? console.error : console.log;
  writer(JSON.stringify(line));
}

export const log = {
  debug: (m: string, meta?: unknown) => emit("debug", m, meta),
  info: (m: string, meta?: unknown) => emit("info", m, meta),
  warn: (m: string, meta?: unknown) => emit("warn", m, meta),
  error: (m: string, meta?: unknown) => emit("error", m, meta),
};
