/**
 * Hub tunggal untuk stream SSE `GET /api/events`.
 *
 * Satu hub = satu `EventSource` untuk seluruh aplikasi:
 *
 * - event di-parse sekali (`parseStreamEvent`) lalu didistribusikan lewat
 *   `EventRegistry` (lihat `events-registry.ts`);
 * - saat koneksi putus (server restart) hub reconnect dengan exponential
 *   backoff + jitter (`backoffDelay`), jadi tidak ada spam request;
 * - koneksi hanya ditutup setelah tidak ada konsumen selama
 *   `STREAM_IDLE_GRACE_MS` (aman untuk StrictMode/HMR);
 * - `setPaused(true)` (dipakai saat `document.hidden`) membuang event tanpa
 *   memutus koneksi, jadi jumlah request di Network tetap satu.
 *
 * `installSharedEventSourceBridge()` menyediakan masa transisi untuk konsumen
 * yang masih memanggil `new EventSource(EVENTS_URL)` langsung: panggilan itu
 * tidak membuka socket baru, tapi menempel ke hub yang sama.
 */
import {
  backoffDelay,
  createEventRegistry,
  parseStreamEvent,
  type EventRegistry,
} from "./events-registry";

export const EVENTS_URL = "/api/events";

/** Jeda sebelum koneksi ditutup saat konsumen terakhir lepas (StrictMode/HMR). */
export const STREAM_IDLE_GRACE_MS = 1_000;

export type EventStreamState = "idle" | "connecting" | "open" | "retrying";

export interface EventStreamStatus {
  state: EventStreamState;
  /** Jumlah percobaan reconnect berurutan yang sudah gagal. */
  attempt: number;
  /** Perkiraan jeda (ms) ke percobaan berikutnya saat `state === "retrying"`. */
  retryInMs?: number;
  /** Berapa konsumen yang sedang memakai hub (provider + klien legacy). */
  consumers: number;
  paused: boolean;
}

interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface EventStreamHubOptions {
  url?: string;
  registry?: EventRegistry;
  createSource?: (url: string) => EventSourceLike;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
  random?: () => number;
  idleGraceMs?: number;
}

/** Pesan mentah yang dikirim ke klien legacy (masih mem-parse sendiri). */
export type LegacyStreamMessage =
  | { type: "open" }
  | { type: "message"; data: string }
  | { type: "error" };

export class EventStreamHub {
  readonly url: string;
  readonly registry: EventRegistry;
  private readonly createSource: (url: string) => EventSourceLike;
  private readonly schedule: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly cancelTimer: (handle: TimerHandle) => void;
  private readonly random: (() => number) | undefined;
  private readonly idleGraceMs: number;
  private readonly statusListeners = new Set<(status: EventStreamStatus) => void>();
  private readonly legacyClients = new Set<(message: LegacyStreamMessage) => void>();
  private source: EventSourceLike | null = null;
  private retryTimer: TimerHandle | null = null;
  private idleTimer: TimerHandle | null = null;
  private status: EventStreamStatus;

  constructor(options: EventStreamHubOptions = {}) {
    this.url = options.url ?? EVENTS_URL;
    this.registry = options.registry ?? createEventRegistry();
    this.createSource = options.createSource ?? ((url) => new EventSource(url));
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelTimer = options.cancel ?? ((handle) => clearTimeout(handle));
    this.random = options.random;
    this.idleGraceMs = options.idleGraceMs ?? STREAM_IDLE_GRACE_MS;
    this.status = { state: "idle", attempt: 0, consumers: 0, paused: false };
  }

  getStatus(): EventStreamStatus {
    return this.status;
  }

  onStatusChange(listener: (status: EventStreamStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /** Tambah konsumen; koneksi dibuka saat konsumen pertama masuk. */
  acquire(): void {
    this.status = { ...this.status, consumers: this.status.consumers + 1 };
    if (this.idleTimer !== null) {
      this.cancelTimer(this.idleTimer);
      this.idleTimer = null;
    }
    this.emitStatus();
    if (this.source === null && this.retryTimer === null) this.connect();
  }

  /** Lepas konsumen; koneksi ditutup setelah grace period. */
  release(): void {
    const consumers = Math.max(0, this.status.consumers - 1);
    this.status = { ...this.status, consumers };
    this.emitStatus();
    if (consumers > 0 || this.idleTimer !== null) return;
    this.idleTimer = this.schedule(() => {
      this.idleTimer = null;
      if (this.status.consumers > 0) return;
      this.stop();
    }, this.idleGraceMs);
  }

  /** `true` = event dibuang (mis. tab tidak terlihat) tanpa memutus koneksi. */
  setPaused(paused: boolean): void {
    if (this.status.paused === paused) return;
    this.status = { ...this.status, paused };
    this.emitStatus();
  }

  isPaused(): boolean {
    return this.status.paused;
  }

  stop(): void {
    this.cancelRetry();
    this.closeSource();
    this.status = { ...this.status, state: "idle", attempt: 0, retryInMs: undefined };
    this.emitStatus();
  }

  /**
   * Tempelkan klien yang masih memakai API `EventSource` langsung ke hub ini.
   * Mengembalikan fungsi detach (idempoten).
   */
  attachLegacyClient(client: (message: LegacyStreamMessage) => void): () => void {
    this.legacyClients.add(client);
    this.acquire();
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      this.legacyClients.delete(client);
      this.release();
    };
  }

  private connect(): void {
    if (this.source !== null) return;
    this.status = { ...this.status, state: "connecting", retryInMs: undefined };
    this.emitStatus();
    const source = this.createSource(this.url);
    this.source = source;
    source.onopen = () => {
      this.status = { ...this.status, state: "open", attempt: 0, retryInMs: undefined };
      this.emitStatus();
      this.emitLegacy({ type: "open" });
    };
    source.onmessage = (event) => this.handleMessage(event?.data);
    source.onerror = () => this.handleError();
  }

  private handleMessage(data: unknown): void {
    const raw = typeof data === "string" ? data : "";
    if (raw.length === 0) return;
    // Tab tidak terlihat / subscriber di-pause: event dibuang, koneksi tetap.
    if (this.status.paused) return;
    this.emitLegacy({ type: "message", data: raw });
    const event = parseStreamEvent(raw);
    if (event) this.registry.dispatch(event);
  }

  private handleError(): void {
    this.closeSource();
    this.emitLegacy({ type: "error" });
    if (this.retryTimer !== null) return;
    if (this.status.consumers === 0) {
      this.status = { ...this.status, state: "idle", attempt: 0, retryInMs: undefined };
      this.emitStatus();
      return;
    }
    const attempt = this.status.attempt + 1;
    const delay = backoffDelay(attempt - 1, { random: this.random });
    this.retryTimer = this.schedule(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
    this.status = { ...this.status, state: "retrying", attempt, retryInMs: delay };
    this.emitStatus();
  }

  private closeSource(): void {
    const source = this.source;
    if (!source) return;
    this.source = null;
    source.onopen = null;
    source.onmessage = null;
    source.onerror = null;
    try {
      source.close();
    } catch {
      // ignore: koneksi memang sedang bermasalah
    }
  }

  private cancelRetry(): void {
    if (this.retryTimer === null) return;
    this.cancelTimer(this.retryTimer);
    this.retryTimer = null;
  }

  private emitLegacy(message: LegacyStreamMessage): void {
    for (const client of [...this.legacyClients]) {
      try {
        client(message);
      } catch (error) {
        console.error("[events] klien legacy gagal", error);
      }
    }
  }

  private emitStatus(): void {
    for (const listener of [...this.statusListeners]) {
      try {
        listener(this.status);
      } catch (error) {
        console.error("[events] status listener gagal", error);
      }
    }
  }
}

let sharedHub: EventStreamHub | null = null;

/** Hub yang dipakai bersama seluruh aplikasi (satu koneksi `/api/events`). */
export function getEventStreamHub(): EventStreamHub {
  if (!sharedHub) sharedHub = new EventStreamHub();
  return sharedHub;
}

function createMessageEvent(data: string): MessageEvent {
  if (typeof MessageEvent === "function") return new MessageEvent("message", { data });
  return { type: "message", data } as unknown as MessageEvent;
}

interface BridgeScope {
  EventSource?: typeof EventSource;
}

type LegacyHandler = (event: unknown) => void;

/**
 * Bridge kompatibilitas: mengganti `EventSource` pada `scope` dengan versi yang
 * menempel ke hub untuk URL `EVENTS_URL` (URL lain tetap memakai implementasi
 * native).
 *
 * Ini menjaga `new EventSource(EVENTS_URL)` di `App.tsx` (belum dimigrasikan ke
 * `useEventSubscription`, lihat LOCAL-E4113D) tidak membuka socket kedua.
 * Setelah konsumen itu pindah ke `useEventSubscription`, bridge ini bisa
 * dihapus.
 */
export function installSharedEventSourceBridge(
  hub: EventStreamHub = getEventStreamHub(),
  scope: BridgeScope = globalThis as unknown as BridgeScope,
): () => void {
  const Native = scope.EventSource;
  if (!Native) return () => {};
  if ((Native as unknown as { __lullabySharedHub?: boolean }).__lullabySharedHub) return () => {};

  class SharedEventSource {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    static readonly __lullabySharedHub = true;

    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSED = 2;
    readonly url: string;
    readonly withCredentials: boolean;
    onopen: LegacyHandler | null = null;
    onmessage: LegacyHandler | null = null;
    onerror: LegacyHandler | null = null;
    readyState = 1;

    private native: EventSource | null = null;
    private detach: (() => void) | null = null;
    private readonly listeners = new Map<string, Set<LegacyHandler>>();

    constructor(url: string, init?: EventSourceInit) {
      this.url = url;
      this.withCredentials = init?.withCredentials ?? false;
      if (url === hub.url) {
        this.detach = hub.attachLegacyClient((message) => {
          if (message.type === "message") {
            this.dispatch("message", createMessageEvent(message.data));
          } else {
            this.dispatch(message.type, { type: message.type });
          }
        });
        return;
      }
      const native = new Native(url, init);
      this.native = native;
      native.onopen = (event) => this.dispatch("open", event);
      native.onmessage = (event) => this.dispatch("message", event);
      native.onerror = (event) => this.dispatch("error", event);
    }

    addEventListener(type: string, listener: LegacyHandler): void {
      if (this.native) {
        this.native.addEventListener(type, listener as EventListener);
        return;
      }
      let bucket = this.listeners.get(type);
      if (!bucket) {
        bucket = new Set<LegacyHandler>();
        this.listeners.set(type, bucket);
      }
      bucket.add(listener);
    }

    removeEventListener(type: string, listener: LegacyHandler): void {
      if (this.native) {
        this.native.removeEventListener(type, listener as EventListener);
        return;
      }
      this.listeners.get(type)?.delete(listener);
    }

    close(): void {
      if (this.readyState === SharedEventSource.CLOSED) return;
      this.readyState = SharedEventSource.CLOSED;
      this.detach?.();
      this.detach = null;
      this.listeners.clear();
      this.native?.close();
      this.native = null;
    }

    private dispatch(type: string, event: unknown): void {
      const direct = type === "message"
        ? this.onmessage
        : type === "open"
        ? this.onopen
        : type === "error"
        ? this.onerror
        : null;
      try {
        direct?.(event);
      } catch (error) {
        console.error("[events] handler SSE gagal", error);
      }
      for (const listener of [...(this.listeners.get(type) ?? [])]) {
        try {
          listener(event);
        } catch (error) {
          console.error("[events] listener SSE gagal", error);
        }
      }
    }
  }

  const bridged = SharedEventSource as unknown as typeof EventSource;
  scope.EventSource = bridged;
  return () => {
    if (scope.EventSource === bridged) scope.EventSource = Native;
  };
}
