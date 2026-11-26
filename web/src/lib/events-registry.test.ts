import { describe, expect, it, vi } from "vitest";
import {
  ALL_EVENT_TYPES,
  BACKOFF_DEFAULTS,
  backoffDelay,
  createEventRegistry,
  parseStreamEvent,
  type StreamEvent,
} from "./events-registry";

describe("createEventRegistry", () => {
  const event = (type: string): StreamEvent => ({ type });

  it("mengirim event hanya ke listener tipe yang cocok", () => {
    const registry = createEventRegistry();
    const chat: StreamEvent[] = [];
    const activity: StreamEvent[] = [];
    registry.subscribe("chat.step", (item) => chat.push(item));
    registry.subscribe("ticket.created", (item) => activity.push(item));

    registry.dispatch(event("chat.step"));
    registry.dispatch(event("ticket.created"));

    expect(chat).toEqual([{ type: "chat.step" }]);
    expect(activity).toEqual([{ type: "ticket.created" }]);
  });

  it("listener '*' menerima semua tipe event, termasuk saat tipe lain juga cocok", () => {
    const registry = createEventRegistry();
    const all: StreamEvent[] = [];
    const chat: StreamEvent[] = [];
    registry.subscribe(ALL_EVENT_TYPES, (item) => all.push(item));
    registry.subscribe("chat.step", (item) => chat.push(item));

    registry.dispatch(event("chat.step"));
    registry.dispatch(event("workflow.step.start"));

    expect(all.map((item) => item.type)).toEqual(["chat.step", "workflow.step.start"]);
    expect(chat.map((item) => item.type)).toEqual(["chat.step"]);
  });

  it("unsubscribe dan setEnabled(false) menghentikan pengiriman", () => {
    const registry = createEventRegistry();
    const received: string[] = [];
    const subscription = registry.subscribe("chat.step", (item) => received.push(item.type));
    const other = registry.subscribe("chat.step", (item) => received.push(`other:${item.type}`));

    other.setEnabled(false);
    registry.dispatch(event("chat.step"));
    expect(received).toEqual(["chat.step"]);
    expect(registry.listenerCount("chat.step")).toBe(1);

    subscription.unsubscribe();
    registry.dispatch(event("chat.step"));
    expect(received).toEqual(["chat.step"]);
    expect(registry.listenerCount()).toBe(0);
  });

  it("pause global (document hidden) membuang semua event", () => {
    const registry = createEventRegistry();
    const received: StreamEvent[] = [];
    registry.subscribe(ALL_EVENT_TYPES, (item) => received.push(item));

    registry.setEnabled(false);
    registry.dispatch(event("chat.step"));
    expect(received).toHaveLength(0);

    registry.setEnabled(true);
    registry.dispatch(event("chat.step"));
    expect(received).toHaveLength(1);
  });

  it("listener yang error tidak menghentikan listener lain", () => {
    const registry = createEventRegistry();
    const received: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    registry.subscribe("chat.step", () => {
      throw new Error("boom");
    });
    registry.subscribe("chat.step", (item) => received.push(item.type));

    registry.dispatch(event("chat.step"));

    expect(received).toEqual(["chat.step"]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("mengabaikan event tanpa tipe", () => {
    const registry = createEventRegistry();
    const received: StreamEvent[] = [];
    registry.subscribe(ALL_EVENT_TYPES, (item) => received.push(item));

    registry.dispatch({ type: "" });
    registry.dispatch({} as StreamEvent);

    expect(received).toHaveLength(0);
  });
});

describe("parseStreamEvent", () => {
  it("mem-parse payload JSON yang valid", () => {
    expect(parseStreamEvent('{"type":"chat.step","payload":{"id":"s1"}}')).toEqual({
      type: "chat.step",
      payload: { id: "s1" },
    });
  });

  it("mengembalikan null untuk payload rusak / tanpa tipe", () => {
    expect(parseStreamEvent("bukan json")).toBeNull();
    expect(parseStreamEvent("")).toBeNull();
    expect(parseStreamEvent(undefined)).toBeNull();
    expect(parseStreamEvent(42)).toBeNull();
    expect(parseStreamEvent('"teks"')).toBeNull();
    expect(parseStreamEvent('{"payload":{}}')).toBeNull();
    expect(parseStreamEvent('{"type":123}')).toBeNull();
  });
});

describe("backoffDelay", () => {
  const random = () => 0.5;

  it("mulai dari baseMs dan naik exponential", () => {
    expect(backoffDelay(0, { random })).toBe(1_000);
    expect(backoffDelay(1, { random })).toBe(2_000);
    expect(backoffDelay(2, { random })).toBe(4_000);
    expect(backoffDelay(3, { random })).toBe(8_000);
  });

  it("dibatasi maxMs supaya tidak menunggu terlalu lama", () => {
    expect(backoffDelay(10, { random })).toBe(BACKOFF_DEFAULTS.maxMs);
    expect(backoffDelay(99, { random, maxMs: 5_000 })).toBe(5_000);
  });

  it("jitter menjaga jeda tetap di sekitar nilai exponential", () => {
    const low = backoffDelay(1, { random: () => 0 });
    const high = backoffDelay(1, { random: () => 1 });
    expect(low).toBe(1_500);
    expect(high).toBe(2_500);
    expect(low).toBeLessThan(2_000);
    expect(high).toBeGreaterThan(2_000);
  });

  it("jitter bisa dimatikan dan attempt negatif diperlakukan sebagai 0", () => {
    expect(backoffDelay(2, { jitterRatio: 0 })).toBe(4_000);
    expect(backoffDelay(-3, { random })).toBe(1_000);
    expect(backoffDelay(Number.NaN, { random })).toBe(1_000);
  });
});
