/**
 * Listener registry + helper backoff untuk satu stream `GET /api/events`.
 *
 * Latar belakang (REL-1): dulu `App.tsx` (feed activity) dan
 * `ChatSidebar.tsx` (`chat.step`) masing-masing membuka
 * `new EventSource("/api/events")`. Setiap koneksi mem-parse SELURUH event,
 * server membatasi 20 klien (`MAX_SSE_CLIENTS` di `src/server/sse.ts`), dan
 * tidak ada strategi reconnect.
 *
 * Sekarang satu koneksi dipunyai `events-stream.ts` dan di-share lewat
 * `events-provider.tsx`. Event di-parse sekali di hub, lalu didistribusikan ke
 * listener yang terdaftar di registry ini (per tipe event, atau `"*"` untuk
 * semua tipe). Modul ini murni (tanpa DOM/React) supaya mudah diuji.
 */

/** Tipe semu untuk berlangganan semua event. */
export const ALL_EVENT_TYPES = "*";

/** Event SSE yang sudah di-parse. Server selalu mengirim objek dengan `type`. */
export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

export type StreamEventListener = (event: StreamEvent) => void;

export interface StreamSubscription {
  readonly enabled: boolean;
  /** Pause/resume tanpa melepas listener (dipakai saat panel chat ditutup). */
  setEnabled(enabled: boolean): void;
  unsubscribe(): void;
}

export interface EventRegistry {
  subscribe(
    type: string,
    listener: StreamEventListener,
    options?: { enabled?: boolean },
  ): StreamSubscription;
  /** Kirim satu event ke listener yang cocok. No-op saat registry di-pause. */
  dispatch(event: StreamEvent): void;
  /** Pause global (mis. `document.hidden`): semua event dibuang. */
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  listenerCount(type?: string): number;
  clear(): void;
}

interface Entry {
  listener: StreamEventListener;
  enabled: boolean;
}

/**
 * Registry listener. Listener `"*"` menerima semua tipe event, listener tipe
 * spesifik hanya menerima tipe tersebut. Listener yang melempar error tidak
 * menghentikan listener lain.
 */
export function createEventRegistry(): EventRegistry {
  const buckets = new Map<string, Set<Entry>>();
  let enabled = true;

  const matches = (bucket: Set<Entry> | undefined, targets: Set<Entry>) => {
    if (!bucket) return;
    for (const entry of bucket) {
      if (entry.enabled) targets.add(entry);
    }
  };

  return {
    subscribe(type, listener, options) {
      const entry: Entry = { listener, enabled: options?.enabled ?? true };
      let bucket = buckets.get(type);
      if (!bucket) {
        bucket = new Set<Entry>();
        buckets.set(type, bucket);
      }
      bucket.add(entry);
      return {
        get enabled(): boolean {
          return entry.enabled;
        },
        setEnabled: (next: boolean) => {
          entry.enabled = next;
        },
        unsubscribe: () => {
          const current = buckets.get(type);
          if (!current) return;
          current.delete(entry);
          if (current.size === 0) buckets.delete(type);
        },
      };
    },
    dispatch(event) {
      if (!enabled) return;
      if (!event || typeof event.type !== "string" || event.type.length === 0) return;
      const targets = new Set<Entry>();
      matches(buckets.get(event.type), targets);
      if (event.type !== ALL_EVENT_TYPES) matches(buckets.get(ALL_EVENT_TYPES), targets);
      for (const entry of targets) {
        try {
          entry.listener(event);
        } catch (error) {
          console.error("[events] listener gagal", error);
        }
      }
    },
    setEnabled: (next) => {
      enabled = next;
    },
    isEnabled: () => enabled,
    listenerCount(type) {
      const bucketsToCount = type ? [buckets.get(type)] : [...buckets.values()];
      let total = 0;
      for (const bucket of bucketsToCount) {
        if (!bucket) continue;
        for (const entry of bucket) {
          if (entry.enabled) total += 1;
        }
      }
      return total;
    },
    clear: () => {
      buckets.clear();
    },
  };
}

/**
 * Parse payload SSE sekali untuk semua konsumen. Mengembalikan `null` untuk
 * payload rusak / tanpa `type` supaya tidak perlu `try/catch` di tiap pemakai.
 */
export function parseStreamEvent(data: unknown): StreamEvent | null {
  if (typeof data !== "string" || data.length === 0) return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const type = (parsed as { type?: unknown }).type;
    if (typeof type !== "string" || type.length === 0) return null;
    return parsed as StreamEvent;
  } catch {
    return null;
  }
}

export interface BackoffOptions {
  /** Jeda percobaan pertama. */
  baseMs?: number;
  /** Batas atas jeda. */
  maxMs?: number;
  /** Pengali exponential. */
  factor?: number;
  /** 0.25 = jeda acak ±25% supaya klien tidak reconnect serentak. */
  jitterRatio?: number;
  random?: () => number;
}

export const BACKOFF_DEFAULTS = {
  baseMs: 1_000,
  maxMs: 30_000,
  factor: 2,
  jitterRatio: 0.25,
} as const;

/**
 * Jeda reconnect exponential + jitter untuk percobaan ke-`attempt` (0-based).
 *
 * attempt 0 → ±1 dtk, 1 → ±2 dtk, 2 → ±4 dtk, … dibatasi `maxMs` (30 dtk),
 * jadi server yang mati tidak dibanjiri request.
 */
export function backoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const baseMs = Math.max(1, options.baseMs ?? BACKOFF_DEFAULTS.baseMs);
  const maxMs = Math.max(baseMs, options.maxMs ?? BACKOFF_DEFAULTS.maxMs);
  const factor = Math.max(1, options.factor ?? BACKOFF_DEFAULTS.factor);
  const jitterRatio = Math.min(1, Math.max(0, options.jitterRatio ?? BACKOFF_DEFAULTS.jitterRatio));
  const random = options.random ?? Math.random;
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const raw = Math.min(maxMs, baseMs * Math.pow(factor, safeAttempt));
  if (jitterRatio === 0) return Math.round(raw);
  const spread = raw * jitterRatio;
  const jittered = raw - spread + random() * spread * 2;
  return Math.round(Math.min(maxMs, Math.max(0, jittered)));
}
