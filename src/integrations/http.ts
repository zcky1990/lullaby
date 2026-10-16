export interface TestResult {
  ok: boolean;
  status?: number;
  message: string;
  detail?: unknown;
  latencyMs: number;
}

export interface IntegrationContext {
  kind: string;
  mode: string;
  config: Record<string, unknown>;
  secret: string | null;
}

export async function request(
  url: string,
  init: RequestInit,
  timeoutMs = 15000,
): Promise<{ status: number; ok: boolean; text: string; headers: Headers }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

export function truncate(value: string, max = 400): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
