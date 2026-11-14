/**
 * Deep-work ("focus") layout: the shell keeps only the tab area (Kanban) and the
 * chat sidebar. State lives in localStorage like the other UI shell prefs
 * (panel width, zoom) and is applied through `data-layout` on `<html>`; the
 * chrome itself is hidden by `web/src/focus-layout.css`.
 */

export type LayoutMode = "standard" | "focus";

const STORAGE_KEY = "rnd.layout:v1";
const CHANGE_EVENT = "rnd:layout-change";
const TICKET_BUTTON_SELECTOR = 'nav button[aria-label="Ticket"]';

export function normalizeLayoutMode(raw: string | null | undefined): LayoutMode {
  return raw?.trim().toLowerCase() === "focus" ? "focus" : "standard";
}

export function readLayoutMode(): LayoutMode {
  try {
    return normalizeLayoutMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "standard";
  }
}

export function applyLayoutMode(mode: LayoutMode): void {
  try {
    document.documentElement.dataset.layout = mode;
  } catch {
    // ignore environments without a DOM
  }
}

export function setLayoutMode(mode: LayoutMode): LayoutMode {
  const next = normalizeLayoutMode(mode);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore storage errors
  }
  applyLayoutMode(next);
  try {
    window.dispatchEvent(new CustomEvent<LayoutMode>(CHANGE_EVENT, { detail: next }));
  } catch {
    // ignore missing window (tests)
  }
  return next;
}

export function toggleLayoutMode(): LayoutMode {
  return setLayoutMode(readLayoutMode() === "focus" ? "standard" : "focus");
}

export function subscribeLayoutMode(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

/**
 * Focus layout is built around the ticket board. The activity-bar item is the
 * public way to open it (`App.onMenuChange` → `openSingleton`), so reuse the
 * same click path instead of reaching into shell state.
 */
export function activateTicketBoard(doc: Document = document): boolean {
  const button = doc.querySelector<HTMLElement>(TICKET_BUTTON_SELECTOR);
  if (!button) return false;
  button.click();
  return true;
}

/** Deep-work layout. `Cmd/Ctrl+Shift+F` is reserved for workspace Find. */
export const LAYOUT_SHORTCUT = "Cmd/Ctrl+Shift+D";

/**
 * `Cmd/Ctrl+Shift+D` toggles the deep-work layout. Registered before React mounts.
 */
export function installLayoutShortcut(): () => void {
  const handler = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return;
    if (event.key.toLowerCase() !== "d") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    toggleLayoutMode();
  };
  window.addEventListener("keydown", handler, { capture: true });
  return () => window.removeEventListener("keydown", handler, { capture: true });
}
