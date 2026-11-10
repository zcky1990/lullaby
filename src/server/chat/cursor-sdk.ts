/**
 * On Deno the SDK picks `connect-web` (fetch), which cannot carry the local
 * agent bidi stream ("The fetch API does not support streaming request
 * bodies"). Hiding the `Deno` global from the SDK runtime check while RPC is
 * in flight makes it use `connect-node` over `node:http2`, which works on
 * Deno 2.9 with SDK 1.3.1 (verified end to end, including `AgentService/Run`).
 *
 * Do NOT force `useHttp1ForAgent: true`: the SDK's HTTP/1.1 path (`node:https`)
 * fails on Deno with `write EPERM`.
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
  if (error instanceof CursorPhaseTimeoutError) return error;
  if (/timeout|timed out|stalled|hang/i.test(message)) {
    return new Error(
      `${message} Koneksi ke server Cursor lambat atau terputus; coba lagi beberapa saat lagi.`,
    );
  }
  return error instanceof Error ? error : new Error(message);
}

export class CursorPhaseTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CursorPhaseTimeoutError";
  }
}

export function cursorCancellationError(): Error {
  const error = new Error("Chat dihentikan.");
  error.name = "AbortError";
  return error;
}

export function isCursorCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export interface CursorPhaseOptions<T> {
  timeoutMs: number;
  timeoutMessage: string;
  signal?: AbortSignal;
  /** Called when the phase was abandoned (timeout/abort) but its work finished later. */
  onLate?: (value: T) => void | Promise<void>;
}

/**
 * Bound one SDK phase by a deadline and the chat abort signal. The SDK calls
 * have no timeout of their own, so a stalled connection would otherwise hang
 * the chat with Stop doing nothing.
 */
export async function runCursorPhase<T>(
  work: () => Promise<T>,
  options: CursorPhaseOptions<T>,
): Promise<T> {
  const { timeoutMs, timeoutMessage, signal, onLate } = options;
  if (signal?.aborted) throw cursorCancellationError();

  let abandoned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const pending = work();
  pending.then(
    (value) => {
      if (!abandoned || !onLate) return;
      Promise.resolve()
        .then(() => onLate(value))
        .catch(() => {});
    },
    () => {},
  );

  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new CursorPhaseTimeoutError(timeoutMessage)), timeoutMs);
      }),
      new Promise<never>((_resolve, reject) => {
        if (!signal) return;
        onAbort = () => reject(cursorCancellationError());
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } catch (error) {
    abandoned = true;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

let transportDepth = 0;
let nativeGetOwnPropertyDescriptor: typeof Object.getOwnPropertyDescriptor | null = null;

function installDenoHiding(): void {
  if (transportDepth === 0) {
    nativeGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const descriptor = Object.getOwnPropertyDescriptor;
    Object.getOwnPropertyDescriptor = ((target: object, prop: PropertyKey) => {
      if (target === globalThis && prop === "Deno") return undefined;
      return descriptor.call(Object, target, prop);
    }) as typeof Object.getOwnPropertyDescriptor;
  }
  transportDepth += 1;
}

function uninstallDenoHiding(): void {
  transportDepth -= 1;
  if (transportDepth > 0) return;
  if (nativeGetOwnPropertyDescriptor) {
    Object.getOwnPropertyDescriptor = nativeGetOwnPropertyDescriptor;
  }
  nativeGetOwnPropertyDescriptor = null;
}

/** Run Cursor SDK work with Node-like Connect transport on Deno. */
export async function withCursorConnectTransport<T>(fn: () => Promise<T>): Promise<T> {
  if (!isDenoRuntime()) return await fn();

  installDenoHiding();
  try {
    return await fn();
  } catch (error) {
    throw rewriteCursorTransportError(error);
  } finally {
    uninstallDenoHiding();
  }
}
