/**
 * Deno cannot run Cursor local-agent HTTP/2 bidi over `connect-web` fetch
 * ("The fetch API does not support streaming request bodies").
 *
 * Prefer the Node `connect-node` / `node:http2` transport by hiding the `Deno`
 * global from the SDK runtime check while RPC is in flight.
 *
 * Do NOT force `useHttp1ForAgent: true` for local agents — HTTP/1.1 cannot
 * carry the bidi stream the local runtime needs, and `send()`/`wait()` hang
 * until our timeout (see Cursor forum reports).
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
    // Explicitly clear any previous HTTP/1.1 force so local agents use HTTP/2.
    if (isDenoRuntime()) {
      sdk.configureCursorSdk({
        local: { useHttp1ForAgent: null },
      });
    }
  }
  return sdk;
}

export function rewriteCursorTransportError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch API does not support streaming request bodies/i.test(message)) {
    return new Error(
      "Cursor local agent membutuhkan HTTP/2 streaming. " +
        "App mencoba transport Node (node:http2); restart app lalu coba lagi, " +
        "atau gunakan cloud agent (id bc-…).",
    );
  }
  if (/timeout|timed out|stalled|hang/i.test(message)) {
    return new Error(
      `${message} Local Cursor agent di Deno bisa hang jika transport HTTP/2 gagal. ` +
        "Coba pesan lebih pendek, restart app, atau gunakan provider LLM biasa / cloud agent.",
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
