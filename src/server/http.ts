import { appendEvent } from "../db/db.ts";
import { publish } from "./bus.ts";
import { APP_TOKEN_COOKIE, APP_TOKEN_HEADER, appToken } from "./session.ts";

const MAX_BODY_BYTES = 26_000_000;
export const SECRET_MASK = "••••••••";
export const SECRET_CONFIG_KEYS = new Set(["apiKey", "apiToken", "token", "password", "secret"]);

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.error ?? "error"));
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.byteLength !== right.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < left.byteLength; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

export function isAuthorized(req: Request): boolean {
  const expected = appToken();
  const cookie = cookieValue(req, APP_TOKEN_COOKIE);
  const header = req.headers.get(APP_TOKEN_HEADER);
  return (cookie !== null && timingSafeEqualString(cookie, expected)) ||
    (header !== null && timingSafeEqualString(header, expected));
}

export function isMaskedSecret(value: unknown): boolean {
  return value === undefined || value === null || value === "" || value === SECRET_MASK;
}

export function maskConfigSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_CONFIG_KEYS.has(key) && typeof value === "string" && value.length > 0) {
      out[key] = SECRET_MASK;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function mergeConfigSecrets(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...incoming };
  for (const key of SECRET_CONFIG_KEYS) {
    if (!(key in out) || isMaskedSecret(out[key])) {
      if (existing[key] !== undefined) out[key] = existing[key];
      else delete out[key];
    }
  }
  return out;
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new HttpError(413, { error: "payload_too_large" });
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, { error: "invalid_json" });
  }
}

export async function record(type: string, payload: unknown): Promise<void> {
  await appendEvent(type, payload);
  publish({ type, payload });
}
