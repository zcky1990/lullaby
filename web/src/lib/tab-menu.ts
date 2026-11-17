export type TabMenuAction = "close-others" | "close-after" | "close-before" | "close-all";

export interface TabMenuRequest {
  action: TabMenuAction;
  id?: string;
}

const TAB_MENU_EVENT = "rnd:tab-menu";

/** Context menu tab tidak memegang state tab; aksi diteruskan ke `useEditorTabs` lewat event. */
export function requestTabMenuAction(action: TabMenuAction, id?: string) {
  window.dispatchEvent(
    new CustomEvent<TabMenuRequest>(TAB_MENU_EVENT, { detail: { action, id } }),
  );
}

export function subscribeTabMenuActions(handler: (request: TabMenuRequest) => void) {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<TabMenuRequest>).detail;
    if (detail?.action) handler(detail);
  };
  window.addEventListener(TAB_MENU_EVENT, listener);
  return () => window.removeEventListener(TAB_MENU_EVENT, listener);
}
