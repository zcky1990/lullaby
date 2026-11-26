import { useEffect, useRef } from "react";
import { DOCS_POLL_INTERVAL_MS, shouldPollLocalDocs } from "@/lib/docs-poll";

export interface LocalDocsAutoRefreshOptions {
  /** Polling hanya jalan saat panel local aktif (dan project sudah dipilih). */
  enabled: boolean;
  /** Request sebelumnya masih berjalan. */
  loading: boolean;
  onRefresh: () => void;
  intervalMs?: number;
}

/**
 * Menjaga daftar dokumen lokal tetap segar saat panel Documents terbuka.
 *
 * File `.md` di document workspace bisa ditambah dari luar UI (editor, `git pull`,
 * atau agent chat), dan server tidak mem-push perubahan itu. Tanpa polling, daftar
 * baru berubah setelah user menekan tombol refresh atau berpindah menu.
 */
export function useLocalDocsAutoRefresh({
  enabled,
  loading,
  onRefresh,
  intervalMs = DOCS_POLL_INTERVAL_MS,
}: LocalDocsAutoRefreshOptions): void {
  const onRefreshRef = useRef(onRefresh);
  const loadingRef = useRef(loading);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
    loadingRef.current = loading;
  }, [onRefresh, loading]);

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (
        !shouldPollLocalDocs({
          visible: typeof document === "undefined" || document.visibilityState === "visible",
          enabled,
          loading: loadingRef.current,
        })
      ) {
        return;
      }
      onRefreshRef.current();
    };
    const timer = setInterval(tick, intervalMs);
    // Kembali fokus ke app = momen paling mungkin file berubah di luar app.
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled, intervalMs]);
}
