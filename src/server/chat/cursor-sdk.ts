/**
 * Deno cannot run Cursor local-agent bidi streams over fetch (`connect-web`):
 * "The fetch API does not support streaming request bodies".
 *
 * Mitigations:
 * 1. Force HTTP/1.1 + SSE for local agents (`useHttp1ForAgent`).
 * 2. Prefer the Node `connect-node` / `node:http2` transport by hiding the
 *    `Deno` global from the SDK's runtime check while RPC is in flight.
 */

type CursorSdk = typeof import("@cursor/sdk");

let sdkPromise: Promise<CursorSdk> | null = null;
let configured = false;

function isDenoRuntime(): boolean {
  return typeof Deno !== "undefined";
}

export async function loadCursorSdk(): Promise<CursorSdk> {
  if (!sdkPromise) {
    sdkPromise = import("@cursor/sdk");
  }
  const sdk = await sdkPromise;
  if (!configured) {
    configured = true;
    if (isDenoRuntime()) {
      sdk.configureCursorSdk({
        local: { useHttp1ForAgent: true },
      });
    }
  }
  return sdk;
}

export function rewriteCursorTransportError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch API does not support streaming request bodies/i.test(message)) {
    return new Error(
      "Cursor local agent membutuhkan HTTP streaming yang tidak didukung Deno fetch. " +
        "Coba lagi (app memaksa HTTP/1.1 SSE / Node transport); " +
        "atau gunakan cloud agent (id bc-…).",
    );
  }
  return error instanceof Error ? error : new Error(message);
}

/** Run Cursor SDK work with Node-like Connect transport on Deno. */
export async function withCursorConnectTransport<T>(fn: () => Promise<T>): Promise<T> {
  if (!isDenoRuntime()) return await fn();

  const original = Object.getOwnPropertyDescriptor;
  Object.getOwnPropertyDescriptor = ((target: object, prop: PropertyKey) => {
    if (target === globalThis && prop === "Deno") return undefined;
    return original.call(Object, target, prop);
  }) as typeof Object.getOwnPropertyDescriptor;

  try {
    return await fn();
  } catch (error) {
    throw rewriteCursorTransportError(error);
  } finally {
    Object.getOwnPropertyDescriptor = original;
  }
}
