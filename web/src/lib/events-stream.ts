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
 * Konsumen (`App`, `ChatSidebar`) berlangganan lewat `useEventSubscription`
 * di `events-provider.tsx`, jadi tidak ada modul UI yang membuat `EventSource`
 * sendiri.
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
  /** Berapa konsumen yang sedang memakai hub (provider). */
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

export class EventStreamHub {
  readonly url: string;
  readonly registry: EventRegistry;
  private readonly createSource: (url: string) => EventSourceLike;
  private readonly schedule: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly cancelTimer: (handle: TimerHandle) => void;
  private readonly random: (() => number) | undefined;
  private readonly idleGraceMs: number;
  private readonly statusListeners = new Set<(status: EventStreamStatus) => void>();
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

  private connect(): void {
    if (this.source !== null) return;
    this.status = { ...this.status, state: "connecting", retryInMs: undefined };
    this.emitStatus();
    const source = this.createSource(this.url);
    this.source = source;
    source.onopen = () => {
      this.status = { ...this.status, state: "open", attempt: 0, retryInMs: undefined };
      this.emitStatus();
    };
    source.onmessage = (event) => this.handleMessage(event?.data);
    source.onerror = () => this.handleError();
  }

  private handleMessage(data: unknown): void {
    const raw = typeof data === "string" ? data : "";
    if (raw.length === 0) return;
    // Tab tidak terlihat / subscriber di-pause: event dibuang, koneksi tetap.
    if (this.status.paused) return;
    const event = parseStreamEvent(raw);
    if (event) this.registry.dispatch(event);
  }

  private handleError(): void {
    this.closeSource();
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
