import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guard PERF-4.
 *
 * Dulu `MarkdownView` mengimpor `Mermaid` secara statis sehingga chunk mermaid
 * (±618 KB) + renderer diagram ikut terunduh untuk setiap dokumen Markdown, walau
 * tidak ada blok diagram. Sekarang:
 *
 * 1. `MarkdownView` memakai `lazy(() => import("@/components/Mermaid"))` +
 *    `<Suspense>` hanya di blok `language-mermaid`.
 * 2. `Mermaid.tsx` tidak mengimpor `mermaid` sama sekali — cache SVG dicek lebih
 *    dulu, dan impor berat ada di `lib/mermaid-render.ts` lewat `import("mermaid")`.
 * 3. `mermaid@12` memuat setiap renderer diagram lewat dynamic import, jadi hanya
 *    tipe diagram yang dipakai yang di-fetch (test terakhir di-skip bila
 *    `node_modules` belum terpasang).
 */
const COMPONENT_URL = new URL("../components/Mermaid.tsx", import.meta.url);
const VIEW_URL = new URL("../components/MarkdownView.tsx", import.meta.url);
const RENDERER_URL = new URL("./mermaid-render.ts", import.meta.url);
const CORE_URL = new URL("../../node_modules/mermaid/dist/mermaid.core.mjs", import.meta.url);

const componentSource = readFileSync(COMPONENT_URL, "utf8");
const viewSource = readFileSync(VIEW_URL, "utf8");
const rendererSource = readFileSync(RENDERER_URL, "utf8");
const coreSource = existsSync(CORE_URL) ? readFileSync(CORE_URL, "utf8") : null;

describe("PERF-4: mermaid dimuat lazy", () => {
  it("komponen Mermaid tidak mengimpor mermaid secara statis", () => {
    expect(componentSource).not.toMatch(/from\s+["']mermaid["']/);
    expect(componentSource).not.toMatch(/^\s*import\s+["']mermaid["']/m);
  });

  it("MarkdownView mengambil komponen Mermaid lewat lazy + Suspense", () => {
    expect(viewSource).toMatch(
      /lazy\(\(\)\s*=>\s*\n?\s*import\(["']@\/components\/Mermaid["']\)/,
    );
    expect(viewSource).toContain("<Suspense");
    expect(viewSource).toContain("Skeleton");
    // Tidak boleh kembali ke impor statis komponen.
    expect(viewSource).not.toMatch(/^import\s+Mermaid\s+from/m);
  });

  it("impor berat mermaid hanya lewat dynamic import di lib/mermaid-render", () => {
    expect(rendererSource).toContain('import("mermaid")');
    expect(rendererSource).not.toMatch(/^\s*import\s+mermaid\s+from/m);
  });

  it("komponen memakai cache SVG sebelum memanggil renderer", () => {
    expect(componentSource).toContain("readCachedMermaidSvg");
    expect(componentSource).toContain("writeCachedMermaidSvg");
    expect(componentSource).toContain("rewriteSvgIds");
  });

  it("mermaid memuat setiap renderer diagram lewat dynamic import", () => {
    // `node_modules` belum terpasang (checkout bersih) → tidak ada yang bisa dicek.
    if (!coreSource) return;

    const dynamicLoaders = [
      ...coreSource.matchAll(/await import\("(\.\/chunks\/mermaid\.core\/[^"]+)"\)/g),
    ].map((match) => match[1]);
    // v12 mendaftarkan ±37 diagram, semuanya sebagai chunk terpisah.
    expect(dynamicLoaders.length).toBeGreaterThanOrEqual(30);

    const staticRendererImports = coreSource
      .split("\n")
      .filter((line) => /^import\b/.test(line))
      .filter((line) => /from\s+"\.\/chunks\/mermaid\.core\/\S*[Dd]iagram/.test(line));
    expect(staticRendererImports).toEqual([]);
  });
});
