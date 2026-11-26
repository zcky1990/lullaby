import { describe, expect, it } from "vitest";
import { EventStreamHub, type EventStreamHubOptions } from "./events-stream";
import type { StreamEvent } from "./events-registry";

type TimerHandle = ReturnType<typeof setTimeout>;

class FakeSource {
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data?: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  closed = false;

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.({});
  }

  message(data: string): void {
    this.onmessage?.({ data });
  }

  fail(): void {
    this.onerror?.({});
  }
}

interface FakeTimer {
  handle: number;
  callback: () => void;
  delayMs: number;
  canceled: boolean;
}

function createHarness(overrides: Partial<EventStreamHubOptions> = {}) {
  const sources: FakeSource[] = [];
  const timers: FakeTimer[] = [];
  const hub = new EventStreamHub({
    createSource: () => {
      const source = new FakeSource();
      sources.push(source);
      return source;
    },
    schedule: (callback, delayMs) => {
      const handle = timers.length;
      timers.push({ handle, callback, delayMs, canceled: false });
      return handle as unknown as TimerHandle;
    },
    cancel: (handle) => {
      const timer = timers[handle as unknown as number];
      if (timer) timer.canceled = true;
    },
    random: () => 0.5,
    ...overrides,
  });
  const runTimer = (index: number) => {
    const timer = timers[index];
    if (!timer) throw new Error(`timer ${index} tidak ada`);
    timer.callback();
  };
  return { hub, sources, timers, runTimer };
}

describe("EventStreamHub", () => {
  it("membuka tepat satu koneksi meski banyak konsumen", () => {
    const { hub, sources } = createHarness();

    hub.acquire();
    hub.acquire();

    expect(sources).toHaveLength(1);
    expect(hub.getStatus().consumers).toBe(2);
  });

  it("mem-parse event sekali lalu meneruskannya ke registry", () => {
    const { hub, sources } = createHarness();
    const received: StreamEvent[] = [];
    hub.registry.subscribe("chat.step", (event) => received.push(event));
    hub.acquire();

    sources[0].message(JSON.stringify({ type: "chat.step", payload: { id: "step-1" } }));
    sources[0].message("bukan json");

    expect(received).toEqual([{ type: "chat.step", payload: { id: "step-1" } }]);
  });

  it("pause membuang event tanpa memutus koneksi", () => {
    const { hub, sources } = createHarness();
    const received: StreamEvent[] = [];
    hub.registry.subscribe("chat.step", (event) => received.push(event));
    hub.acquire();

    hub.setPaused(true);
    sources[0].message(JSON.stringify({ type: "chat.step" }));
    expect(received).toHaveLength(0);
    expect(sources[0].closed).toBe(false);

    hub.setPaused(false);
    sources[0].message(JSON.stringify({ type: "chat.step" }));
    expect(received).toHaveLength(1);
  });

  it("reconnect dengan exponential backoff setelah server putus", () => {
    const { hub, sources, timers, runTimer } = createHarness();
    hub.acquire();
    expect(sources).toHaveLength(1);

    sources[0].fail();
    expect(sources[0].closed).toBe(true);
    // Tidak langsung membuka koneksi baru (tidak spam request).
    expect(sources).toHaveLength(1);
    expect(hub.getStatus().state).toBe("retrying");
    expect(hub.getStatus().attempt).toBe(1);
    expect(timers[0].delayMs).toBe(1_000);

    runTimer(0);
    expect(sources).toHaveLength(2);
    expect(hub.getStatus().state).toBe("connecting");

    sources[1].open();
    expect(hub.getStatus().state).toBe("open");
    expect(hub.getStatus().attempt).toBe(0);

    sources[1].fail();
    expect(timers[1].delayMs).toBe(1_000);
    runTimer(1);
    sources[2].fail();
    // Gagal berurutan tanpa sempat open: jeda naik exponential.
    expect(timers[2].delayMs).toBe(2_000);
    runTimer(2);
    sources[3].fail();
    expect(timers[3].delayMs).toBe(4_000);
    expect(sources).toHaveLength(4);
  });

  it("koneksi ditutup setelah grace period saat konsumen terakhir lepas", () => {
    const { hub, sources, timers, runTimer } = createHarness();
    hub.acquire();
    hub.release();

    expect(sources[0].closed).toBe(false);
    expect(timers[0].delayMs).toBe(1_000);

    runTimer(0);
    expect(sources[0].closed).toBe(true);
    expect(hub.getStatus().state).toBe("idle");
  });

  it("acquire ulang membatalkan penutupan (aman untuk StrictMode/HMR)", () => {
    const { hub, sources, timers } = createHarness();
    hub.acquire();
    hub.release();
    hub.acquire();

    expect(timers[0].canceled).toBe(true);
    expect(sources).toHaveLength(1);
    expect(sources[0].closed).toBe(false);
  });
});
