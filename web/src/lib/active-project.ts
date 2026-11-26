/**
 * Project aktif (dibaca dari localStorage).
 *
 * `App.tsx` menyimpan project terpilih di `rnd.activeProjectId:v1`. Panel yang
 * dirender di luar shell (mis. Doc Studio dari `ActivityBar`) butuh id yang sama
 * tanpa harus menambah prop di shell.
 */
export const ACTIVE_PROJECT_KEY = "rnd.activeProjectId:v1";

export function readActiveProjectId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}
