/**
 * Dokumen lokal hidup di disk, jadi isinya bisa berubah tanpa lewat UI: editor
 * eksternal, `git pull`, atau agent chat yang menulis file ke document workspace.
 * Panel Documents memakai polling ringan selagi terlihat supaya daftar tidak basi.
 *
 * Interval sengaja tidak terlalu rapat: setiap tick menaikkan state di App (dan
 * ikut me-render ulang panel lain), jadi 10 detik cukup responsif tanpa jadi beban.
 */
export const DOCS_POLL_INTERVAL_MS = 10_000;

export interface LocalDocsPollGate {
  /** Panel benar-benar sedang tampil (window tidak di-minimize / tab tidak hidden). */
  visible: boolean;
  /** Sumber dokumen = local dan project aktif. */
  enabled: boolean;
  /** Jangan menumpuk request saat refresh sebelumnya belum selesai. */
  loading: boolean;
}

export function shouldPollLocalDocs(gate: LocalDocsPollGate): boolean {
  return gate.enabled && gate.visible && !gate.loading;
}
