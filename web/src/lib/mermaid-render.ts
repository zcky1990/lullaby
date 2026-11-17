/**
 * Renderer Mermaid (PERF-4).
 *
 * Modul ini adalah SATU-SATUNYA tempat `mermaid` diimpor, dan impornya dinamis
 * (`import("mermaid")`) supaya Vite memecahnya ke chunk terpisah dari komponen.
 * Konsekuensinya:
 * - `Mermaid.tsx` jadi chunk kecil; dokumen yang diagramnya sudah ada di cache SVG
 *   tidak perlu mengunduh chunk mermaid (±618 KB) sama sekali.
 * - `mermaid@12` sendiri memuat setiap renderer diagram lewat dynamic import
 *   (`mermaid.core.mjs` → `await import("./chunks/mermaid.core/<x>Diagram-*.mjs")`),
 *   jadi hanya tipe diagram yang benar-benar dipakai yang di-fetch.
 */

type MermaidApi = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidApi> | null = null;

/** Muat (sekali) dan inisialisasi pustaka mermaid. */
function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((module) => module.default);
  }
  return mermaidPromise;
}

function themeName(theme: string): "dark" | "default" {
  return theme === "dark" ? "dark" : "default";
}

/**
 * Render satu diagram menjadi string SVG.
 *
 * `mermaid.initialize()` dipanggil per render karena tema ikut berubah; mermaid
 * menyimpan konfigurasi global sehingga opsi ini tidak bisa di-set sekali saja.
 */
export async function renderMermaidSvg(
  chart: string,
  theme: string,
  id: string,
): Promise<string> {
  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: themeName(theme),
  });
  const { svg } = await mermaid.render(id, chart);
  return svg;
}
