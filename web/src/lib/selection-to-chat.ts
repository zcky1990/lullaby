export interface SelectionSnapshot {
  text: string;
  /** Prefer this provider when the editor has focus. */
  focused?: boolean;
  sourceLabel?: string;
}

type SelectionProvider = () => SelectionSnapshot | null;

const providers = new Set<SelectionProvider>();

export function registerSelectionProvider(provider: SelectionProvider): () => void {
  providers.add(provider);
  return () => {
    providers.delete(provider);
  };
}

/** Skip Cmd+L when focus is already in chat/terminal/other dialogs. */
export function shouldIgnoreAddToChatShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("[data-add-to-chat-dialog]")) return true;
  if (target.closest(".chat-composer-input")) return true;
  if (target.closest(".xterm")) return true;
  if (target.closest("[data-terminal-find]")) return true;
  if (target.closest(".monaco-editor")) return false;
  const dialog = target.closest('[data-slot="dialog-content"]');
  if (dialog) return true;
  return false;
}

/**
 * Read the current editor/preview selection.
 * Monaco and markdown register providers; DOM selection is the fallback.
 */
export function readEditorSelection(): SelectionSnapshot | null {
  let fallback: SelectionSnapshot | null = null;
  for (const provider of providers) {
    try {
      const snap = provider();
      const text = snap?.text.trim() ?? "";
      if (!text) continue;
      const next = { ...snap!, text };
      if (next.focused) return next;
      if (!fallback) fallback = next;
    } catch {
      // ignore broken provider
    }
  }
  if (fallback) return fallback;

  const text = window.getSelection()?.toString().trim() ?? "";
  if (!text) return null;
  if (shouldIgnoreAddToChatShortcut(document.activeElement)) return null;
  return { text };
}
