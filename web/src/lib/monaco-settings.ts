/**
 * Preferensi Monaco yang harus terbaca **sebelum** editor dibuat.
 *
 * `MonacoEnvironment.getWorker` memilih worker saat model dibuka dan
 * `languages/features/typescript` didaftarkan sebelum editor pertama
 * di-mount, jadi nilainya tidak bisa menunggu round-trip `ui_preferences`.
 * Karena itu preferensi ini disimpan di `localStorage` (per mesin / per
 * webview), dengan modul ini sebagai satu-satunya pembaca/penulisnya.
 *
 * Perubahan berlaku untuk editor yang dimuat setelahnya (muat ulang app).
 */
const STORAGE_KEY = "rnd.monacoTypeScriptService:v1";

type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * Default: aktif (perilaku lama). Nilai `off` berarti layanan TypeScript
 * bawaan Monaco — beserta `ts.worker` ±7 MB — tidak pernah dimuat.
 */
export function isMonacoTypeScriptServiceEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    // localStorage tidak tersedia: pakai default yang aman (fitur tetap ada).
    return true;
  }
}

export function setMonacoTypeScriptServiceEnabled(enabled: boolean): void {
  const previous = isMonacoTypeScriptServiceEnabled();
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // ignore — nilai tetap berlaku untuk sesi ini lewat listener di bawah
  }
  if (previous === enabled) return;
  for (const listener of [...listeners]) listener();
}

/** Kontrak `useSyncExternalStore` supaya UI ikut berubah saat opsi di-toggle. */
export function subscribeMonacoSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
