import { useEffect, useSyncExternalStore } from "react";
import {
  activateTicketBoard,
  applyLayoutMode,
  type LayoutMode,
  readLayoutMode,
  subscribeLayoutMode,
} from "@/lib/layout-mode";
import { requestChatOpen } from "@/lib/chat-drag";

/**
 * Reads the persisted layout and applies its side effects. Mounted from the
 * window toolbar (always visible), so a persisted focus layout is restored on
 * reload even though the shell itself does not know about the mode.
 *
 * The side effects are deferred one tick so listeners registered during the same
 * commit (chat toggle in `WindowToolbar`) are already attached.
 */
export function useLayoutMode(): LayoutMode {
  const mode = useSyncExternalStore<LayoutMode>(
    subscribeLayoutMode,
    readLayoutMode,
    () => "standard",
  );

  useEffect(() => {
    applyLayoutMode(mode);
    if (mode !== "focus") return;
    const timer = setTimeout(() => {
      requestChatOpen();
      activateTicketBoard();
    }, 0);
    return () => clearTimeout(timer);
  }, [mode]);

  return mode;
}
