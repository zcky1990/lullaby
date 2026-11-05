import { describe, expect, it } from "vitest";
import {
  CHAT_DOCUMENT_MIME,
  CHAT_TICKET_MIME,
  isChatDragType,
  parseChatDragPayload,
  readChatDragData,
  setChatDragData,
} from "./chat-drag";

function fakeDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    effectAllowed: "none",
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string) => store.get(type) ?? "",
    get types() {
      return [...store.keys()];
    },
  } as unknown as DataTransfer;
}

describe("chat drag payload", () => {
  it("round-trips a local document", () => {
    const dataTransfer = fakeDataTransfer();
    setChatDragData(dataTransfer, {
      kind: "document",
      source: "local",
      path: "notes/plan.md",
      title: "Plan",
    });

    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(dataTransfer.types).toContain(CHAT_DOCUMENT_MIME);
    expect(readChatDragData(dataTransfer)).toEqual({
      kind: "document",
      source: "local",
      path: "notes/plan.md",
      title: "Plan",
    });
  });

  it("round-trips a remote document", () => {
    const dataTransfer = fakeDataTransfer();
    setChatDragData(dataTransfer, {
      kind: "document",
      source: "notion",
      id: "page-1",
      title: "Spec",
    });

    expect(readChatDragData(dataTransfer)).toEqual({
      kind: "document",
      source: "notion",
      id: "page-1",
      title: "Spec",
    });
  });

  it("round-trips a ticket", () => {
    const dataTransfer = fakeDataTransfer();
    setChatDragData(dataTransfer, {
      kind: "ticket",
      key: "LOCAL-1",
      title: "Perbaiki drag",
      localId: "abc",
      source: "local",
    });

    expect(dataTransfer.types).toContain(CHAT_TICKET_MIME);
    expect(dataTransfer.getData("text/plain")).toBe("LOCAL-1 Perbaiki drag");
    expect(readChatDragData(dataTransfer)).toEqual({
      kind: "ticket",
      key: "LOCAL-1",
      title: "Perbaiki drag",
      localId: "abc",
      source: "local",
    });
  });

  it("detects chat drag types from dragover types", () => {
    expect(isChatDragType([CHAT_DOCUMENT_MIME])).toBe(true);
    expect(isChatDragType([CHAT_TICKET_MIME])).toBe(true);
    expect(isChatDragType(["Files", "text/plain"])).toBe(false);
  });

  it("rejects broken or incomplete payloads", () => {
    expect(parseChatDragPayload("")).toBeNull();
    expect(parseChatDragPayload("bukan json")).toBeNull();
    // dokumen lokal tanpa path
    expect(
      parseChatDragPayload(JSON.stringify({ kind: "document", source: "local", title: "x" })),
    ).toBeNull();
    // sumber tidak dikenal
    expect(
      parseChatDragPayload(
        JSON.stringify({ kind: "document", source: "gitlab", id: "1", title: "x" }),
      ),
    ).toBeNull();
    // tiket tanpa key
    expect(parseChatDragPayload(JSON.stringify({ kind: "ticket", title: "x" }))).toBeNull();
    // judul kosong
    expect(
      parseChatDragPayload(JSON.stringify({ kind: "ticket", key: "A-1", title: "  " })),
    ).toBeNull();
    expect(parseChatDragPayload(JSON.stringify({ kind: "lain", title: "x" }))).toBeNull();
  });

  it("ignores drops that carry no chat payload", () => {
    const dataTransfer = fakeDataTransfer();
    dataTransfer.setData("text/plain", "halo");
    expect(readChatDragData(dataTransfer)).toBeNull();
  });
});
