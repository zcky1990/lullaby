import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guard REL-1 (LOCAL-A34AD8).
 *
 * Dulu ada dua `new EventSource("/api/events")` (App.tsx untuk feed activity,
 * ChatSidebar.tsx untuk `chat.step`), jadi setiap event di-parse dua kali dan
 * satu pengguna memakan dua slot `MAX_SSE_CLIENTS`.
 *
 * Sekarang satu koneksi dipunyai `events-stream.ts` + `events-provider.tsx`,
 * konsumen berlangganan lewat `useEventSubscription`. Guard ini menjaga
 * invarian tersebut tetap ada saat file lain diubah.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const main = read("../main.tsx");
const app = read("../App.tsx");
const chatSidebar = read("../components/ChatSidebar.tsx");
const stream = read("./events-stream.ts");
const provider = read("./events-provider.tsx");

describe("REL-1: satu koneksi /api/events", () => {
  it("hanya events-stream.ts yang membuat EventSource", () => {
    expect(stream.match(/new EventSource\(/g) ?? []).toHaveLength(1);
    expect(chatSidebar).not.toContain("new EventSource(");
  });

  it("EventsProvider dipasang di main.tsx di atas App", () => {
    expect(main).toContain('from "@/lib/events-provider"');
    expect(main).toContain("<EventsProvider>");
    expect(main).toContain("</EventsProvider>");
    expect(main.indexOf("<EventsProvider>")).toBeLessThan(main.indexOf("<App />"));
  });

  it("ChatSidebar berlangganan chat.step dan di-pause saat panel ditutup", () => {
    expect(chatSidebar).toContain('useEventSubscription("chat.step"');
    expect(chatSidebar).toContain("!hidden");
  });

  it("App.tsx berlangganan lewat hook, bukan EventSource sendiri", () => {
    expect(app).not.toContain("new EventSource(");
    expect(app).toContain('useEventSubscription("*"');
    expect(main).not.toContain("installSharedEventSourceBridge");
  });

  it("provider mem-pause event saat tab tidak terlihat", () => {
    expect(provider).toContain("visibilitychange");
    expect(provider).toContain("setPaused");
  });

  it("registry listener dipakai untuk dispatch, bukan window CustomEvent", () => {
    expect(provider).toContain("registry.subscribe");
    expect(stream).toContain("registry.dispatch");
    expect(stream).toContain("backoffDelay");
  });
});
