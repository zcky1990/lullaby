import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activateTicketBoard,
  installLayoutShortcut,
  LAYOUT_SHORTCUT,
  normalizeLayoutMode,
  readLayoutMode,
  setLayoutMode,
  subscribeLayoutMode,
  toggleLayoutMode,
} from "@/lib/layout-mode";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.layout;
  document.body.innerHTML = "";
});

describe("normalizeLayoutMode", () => {
  it("falls back to standard for unknown values", () => {
    expect(normalizeLayoutMode(null)).toBe("standard");
    expect(normalizeLayoutMode("")).toBe("standard");
    expect(normalizeLayoutMode("kanban")).toBe("standard");
    expect(normalizeLayoutMode(" FOCUS ")).toBe("focus");
  });
});

describe("layout state", () => {
  it("persists the mode, applies it to the document, and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLayoutMode(listener);
    expect(readLayoutMode()).toBe("standard");

    setLayoutMode("focus");
    expect(localStorage.getItem("rnd.layout:v1")).toBe("focus");
    expect(document.documentElement.dataset.layout).toBe("focus");
    expect(readLayoutMode()).toBe("focus");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setLayoutMode("standard");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("toggles between standard and focus", () => {
    expect(toggleLayoutMode()).toBe("focus");
    expect(document.documentElement.dataset.layout).toBe("focus");
    expect(toggleLayoutMode()).toBe("standard");
    expect(document.documentElement.dataset.layout).toBe("standard");
  });
});

describe("activateTicketBoard", () => {
  it("clicks the ticket activity-bar item", () => {
    const click = vi.fn();
    const nav = document.createElement("nav");
    const button = document.createElement("button");
    button.setAttribute("aria-label", "Ticket");
    button.addEventListener("click", click);
    nav.append(button);
    document.body.append(nav);

    expect(activateTicketBoard(document)).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("reports false when the item is missing", () => {
    expect(activateTicketBoard(document)).toBe(false);
  });
});

describe("installLayoutShortcut", () => {
  it("toggles the layout on Cmd/Ctrl+Shift+F and swallows the event", () => {
    const uninstall = installLayoutShortcut();
    const later = vi.fn();
    window.addEventListener("keydown", later, { capture: true });
    const event = new KeyboardEvent("keydown", {
      key: "f",
      metaKey: true,
      shiftKey: true,
      cancelable: true,
    });

    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(later).not.toHaveBeenCalled();
    expect(readLayoutMode()).toBe("focus");

    window.removeEventListener("keydown", later, { capture: true });
    uninstall();
    expect(LAYOUT_SHORTCUT).toBe("Cmd/Ctrl+Shift+F");
  });

  it("ignores other shortcuts", () => {
    const uninstall = installLayoutShortcut();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", metaKey: true, cancelable: true }),
    );
    expect(readLayoutMode()).toBe("standard");
    uninstall();
  });
});
