import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  type EventRegistry,
  type StreamEventListener,
  type StreamSubscription,
} from "@/lib/events-registry";
import {
  getEventStreamHub,
  type EventStreamHub,
  type EventStreamStatus,
} from "@/lib/events-stream";

interface EventsContextValue {
  registry: EventRegistry;
  hub: EventStreamHub;
  status: EventStreamStatus;
}

const EventsContext = createContext<EventsContextValue | null>(null);

/**
 * Satu-satunya pemilik koneksi `GET /api/events`.
 *
 * Provider ini membuka koneksi sekali untuk seluruh aplikasi, mem-pause
 * pengiriman event saat tab tidak terlihat (`document.hidden`), dan membiarkan
 * hub melakukan reconnect backoff. Pasang di `main.tsx` di atas `App`.
 */
export function EventsProvider({ children }: { children: ReactNode }) {
  const hub = useMemo(() => getEventStreamHub(), []);
  const [status, setStatus] = useState<EventStreamStatus>(() => hub.getStatus());

  useEffect(() => {
    setStatus(hub.getStatus());
    const unsubscribe = hub.onStatusChange(setStatus);
    const syncVisibility = () => {
      hub.setPaused(document.visibilityState === "hidden" || document.hidden);
    };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    hub.acquire();
    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      unsubscribe();
      hub.release();
    };
  }, [hub]);

  const value = useMemo<EventsContextValue>(
    () => ({ registry: hub.registry, hub, status }),
    [hub, status],
  );

  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>;
}

export function useEvents(): EventsContextValue {
  const value = useContext(EventsContext);
  if (!value) throw new Error("useEvents harus dipakai di dalam <EventsProvider>.");
  return value;
}

/** Status koneksi stream (open / retrying + jeda backoff berikutnya). */
export function useEventStreamStatus(): EventStreamStatus {
  return useEvents().status;
}

/**
 * Berlangganan satu tipe event (`"*"` untuk semua tipe).
 *
 * `enabled === false` mem-pause langganan tanpa melepas listener — dipakai
 * `ChatSidebar` saat panel ditutup (`hidden` prop), jadi event `chat.step`
 * tidak diproses sampai panel dibuka lagi.
 */
export function useEventSubscription(
  type: string,
  listener: StreamEventListener,
  enabled = true,
): void {
  const { registry } = useEvents();
  const listenerRef = useRef(listener);
  listenerRef.current = listener;
  const subscriptionRef = useRef<StreamSubscription | null>(null);

  useEffect(() => {
    const subscription = registry.subscribe(type, (event) => listenerRef.current(event));
    subscriptionRef.current = subscription;
    return () => {
      subscription.unsubscribe();
      subscriptionRef.current = null;
    };
  }, [registry, type]);

  useEffect(() => {
    subscriptionRef.current?.setEnabled(enabled);
  }, [enabled]);
}
