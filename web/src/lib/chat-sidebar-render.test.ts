import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guard PERF-2 (jalur terpanas aplikasi).
 *
 * `ChatSidebar` dulu merender `entries.map(...)` langsung di JSX induk, jadi
 * setiap ketikan composer / event `chat.step` ikut me-render ulang seluruh
 * transkrip dan menjalankan ulang `MarkdownView` (±159 KB) untuk tiap pesan
 * assistant.
 *
 * Test ini menjaga kontrak performanya:
 * 1. `ChatSidebar` tidak lagi memanggil `MarkdownView` di dalam `.map()` induk —
 *    transkrip dirender oleh `ChatMessageList` (`web/src/components/chat/`).
 * 2. Item pesan di-`memo` dan menerima props primitif + referensi stabil.
 * 3. `chat.step` di-throttle per frame (`requestAnimationFrame` +
 *    `startTransition`), tidak set-state per token.
 * 4. Auto-scroll hanya mengikuti dasar transkrip kalau pengguna memang di dasar.
 */
const sidebar = readFileSync(
  new URL("../components/ChatSidebar.tsx", import.meta.url),
  "utf8",
);
const messageList = readFileSync(
  new URL("../components/chat/ChatMessageList.tsx", import.meta.url),
  "utf8",
);

/** Isi callback `visible.map((entry) => ( ... ))` di dalam `ChatMessageList`. */
function mapCallbackBody(source: string): string {
  const start = source.indexOf("visible.map((entry) => (");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("))}", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("PERF-2: render streaming ChatSidebar", () => {
  it("ChatSidebar tidak merender pesan/MarkdownView sendiri", () => {
    // Transkrip dipindah ke komponen terpisah.
    expect(sidebar).toContain('from "@/components/chat/ChatMessageList"');
    expect(sidebar).toContain("<ChatMessageList");
    expect(sidebar).not.toContain("MarkdownView");
    expect(sidebar).not.toContain("entries.map(");
    expect(sidebar).not.toContain("steps.map(");
  });

  it("item pesan di-memo dan tidak menjalankan MarkdownView di map induk", () => {
    expect(messageList).toContain("export const ChatMessageItem = memo(");
    expect(messageList).toContain("export const ChatMessageList = memo(");
    // MarkdownView hanya dipakai di dalam item, bukan di callback map.
    expect(messageList).toContain("MarkdownView");
    expect(mapCallbackBody(messageList)).not.toContain("MarkdownView");
    expect(mapCallbackBody(messageList)).toContain("<ChatMessageItem");
    expect(mapCallbackBody(messageList)).toContain("content={entry.content}");
    expect(mapCallbackBody(messageList)).toContain("onOpenFile={onOpenFile}");
  });

  it("props item berupa nilai primitif/referensi stabil", () => {
    const propsStart = messageList.indexOf("interface ChatMessageItemProps {");
    expect(propsStart).toBeGreaterThan(-1);
    const props = messageList.slice(propsStart, messageList.indexOf("}", propsStart));
    for (const primitive of ["role: ", "content: string", "fontFamily: ", "fontSize: number"]) {
      expect(props).toContain(primitive);
    }
    // Handler stabil dari induk (`useCallback`), bukan closure baru per render.
    expect(props).toContain("onOpenFile: (path: string) => void");
    expect(sidebar).toContain("const openChangedFile = useCallback(");
  });

  it("event chat.step di-buffer lalu di-flush sekali per frame", () => {
    expect(sidebar).toContain("stepBufferRef");
    expect(sidebar).toContain("requestAnimationFrame(flushSteps)");
    expect(sidebar).toContain("startTransition(");
    // `setSteps` tidak lagi dipanggil langsung dari mergeStep.
    const mergeStart = sidebar.indexOf("const mergeStep = useCallback(");
    expect(mergeStart).toBeGreaterThan(-1);
    const mergeBody = sidebar.slice(mergeStart, sidebar.indexOf("}, [flushSteps]);", mergeStart));
    expect(mergeBody).toContain("stepBufferRef.current.set(step.id, step)");
    expect(mergeBody).not.toContain("setSteps(");
  });

  it("auto-scroll tidak melawan saat pengguna membaca history", () => {
    expect(messageList).toContain("stickToBottomRef");
    expect(messageList).toContain("BOTTOM_SLACK_PX");
    expect(messageList).toContain("stickToBottomRef.current = distance <= BOTTOM_SLACK_PX");
    // Efek scroll utama hanya bergantung pada daftar pesan (bukan steps/token).
    expect(messageList).toMatch(/\}, \[entries\]\);/);
    expect(messageList).not.toMatch(/\}, \[entries, sending, pending, steps\]\);/);
  });

  it("sesi panjang tetap ringan (containment + windowing)", () => {
    expect(messageList).toContain("content-visibility:auto");
    expect(messageList).toContain("contain-intrinsic-size:auto_120px");
    expect(messageList).toContain("WINDOW_INITIAL");
    expect(messageList).toContain("WINDOW_STEP");
    expect(messageList).toContain("slice(hidden)");
  });
});
