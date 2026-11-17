import { describe, expect, it } from "vitest";
import {
  clearMermaidCache,
  MERMAID_CACHE_LIMITS,
  mermaidCacheKey,
  readCachedMermaidSvg,
  rewriteSvgIds,
  trimMermaidCache,
  writeCachedMermaidSvg,
  type MermaidCacheStorage,
} from "./mermaid-svg-cache";

/** Storage in-memory yang meniru subset `Storage` yang dipakai cache. */
function memoryStorage(): MermaidCacheStorage & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    get length() {
      return raw.size;
    },
    key(index) {
      return [...raw.keys()][index] ?? null;
    },
    getItem(key) {
      return raw.get(key) ?? null;
    },
    setItem(key, value) {
      raw.set(key, value);
    },
    removeItem(key) {
      raw.delete(key);
    },
  };
}

function svgOf(size: number): string {
  return `<svg>${"x".repeat(Math.max(0, size - 11))}</svg>`;
}

function totalBytes(storage: MermaidCacheStorage): number {
  let total = 0;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    total += (storage.getItem(key) ?? "").length;
  }
  return total;
}

describe("key cache mermaid", () => {
  it("stabil untuk input yang sama dan berbeda per tema/source/versi", () => {
    const chart = "flowchart TB\n A-->B";
    const base = mermaidCacheKey(chart, "default");
    expect(mermaidCacheKey(chart, "default")).toBe(base);
    expect(mermaidCacheKey(chart, "dark")).not.toBe(base);
    expect(mermaidCacheKey(chart, "default", "v2")).not.toBe(base);
    expect(mermaidCacheKey("flowchart TB\n A-->C", "default")).not.toBe(base);
  });

  it("tidak membocorkan source diagram di key", () => {
    const key = mermaidCacheKey("flowchart TB\n Rahasia-->B", "default");
    expect(key).not.toContain("Rahasia");
    expect(key).toMatch(/^lullaby:mermaid-svg:[0-9a-f]{16}$/);
  });
});

describe("cache SVG mermaid", () => {
  it("mengembalikan null saat kosong, lalu mengembalikan svg yang disimpan", () => {
    const storage = memoryStorage();
    const chart = "flowchart TB\n A-->B";

    expect(readCachedMermaidSvg(chart, "default", storage)).toBeNull();

    writeCachedMermaidSvg(chart, "default", { id: "mermaid-abc", svg: "<svg/>" }, storage);
    expect(readCachedMermaidSvg(chart, "default", storage)).toEqual({
      id: "mermaid-abc",
      svg: "<svg/>",
    });
    // Tema lain tidak memakai entri ini.
    expect(readCachedMermaidSvg(chart, "dark", storage)).toBeNull();
  });

  it("mengabaikan entri rusak dan source kosong", () => {
    const storage = memoryStorage();
    storage.setItem(mermaidCacheKey("flowchart TB\n A-->B", "default"), "{bukan json");
    expect(readCachedMermaidSvg("flowchart TB\n A-->B", "default", storage)).toBeNull();

    writeCachedMermaidSvg("   ", "default", { id: "id", svg: "<svg/>" }, storage);
    expect(storage.length).toBe(1); // hanya entri rusak di atas
  });

  it("tidak menyimpan diagram yang lebih besar dari batas per entri", () => {
    const storage = memoryStorage();
    const big = svgOf(MERMAID_CACHE_LIMITS.maxEntryBytes + 1);
    writeCachedMermaidSvg("flowchart TB\n A-->B", "default", { id: "big", svg: big }, storage);
    expect(readCachedMermaidSvg("flowchart TB\n A-->B", "default", storage)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("mengevakuasi entri tertua saat jumlah entri melewati batas", () => {
    const storage = memoryStorage();
    const charts = Array.from(
      { length: MERMAID_CACHE_LIMITS.maxEntries + 5 },
      (_, index) => `flowchart TB\n A-->B${index}`,
    );

    for (const [index, chart] of charts.entries()) {
      writeCachedMermaidSvg(chart, "default", { id: `id-${index}`, svg: svgOf(512) }, storage);
    }

    expect(storage.length).toBeLessThanOrEqual(MERMAID_CACHE_LIMITS.maxEntries);
    // Yang terbaru masih ada, yang paling awal sudah dibuang.
    expect(readCachedMermaidSvg(charts[charts.length - 1]!, "default", storage)).not.toBeNull();
    expect(readCachedMermaidSvg(charts[0]!, "default", storage)).toBeNull();
  });

  it("menjaga total ukuran di bawah batas", () => {
    const storage = memoryStorage();
    for (let index = 0; index < 30; index += 1) {
      writeCachedMermaidSvg(
        `flowchart TB\n A-->B${index}`,
        "default",
        { id: `id-${index}`, svg: svgOf(100_000) },
        storage,
      );
    }
    expect(totalBytes(storage)).toBeLessThanOrEqual(MERMAID_CACHE_LIMITS.maxTotalBytes);
  });

  it("tetap menyimpan walau setItem sempat gagal karena kuota", () => {
    const base = memoryStorage();
    let failNext = false;
    const storage: MermaidCacheStorage = {
      get length() {
        return base.length;
      },
      key: (index) => base.key(index),
      getItem: (key) => base.getItem(key),
      removeItem: (key) => base.removeItem(key),
      setItem: (key, value) => {
        if (failNext) {
          failNext = false;
          throw new Error("QuotaExceededError");
        }
        base.setItem(key, value);
      },
    };

    const first = "flowchart TB\n A-->B1";
    const second = "flowchart TB\n A-->B2";
    writeCachedMermaidSvg(first, "default", { id: "id-1", svg: "<svg/>" }, storage);

    failNext = true;
    writeCachedMermaidSvg(second, "default", { id: "id-2", svg: "<svg/>" }, storage);

    expect(readCachedMermaidSvg(second, "default", storage)).not.toBeNull();
    // Entri lama dievakuasi saat retry setelah gagal.
    expect(readCachedMermaidSvg(first, "default", storage)).toBeNull();
  });

  it("aman tanpa storage dan bisa dibersihkan", () => {
    expect(readCachedMermaidSvg("flowchart TB\n A-->B", "default", null)).toBeNull();
    expect(() =>
      writeCachedMermaidSvg("flowchart TB\n A-->B", "default", { id: "id", svg: "<svg/>" }, null)
    ).not.toThrow();
    expect(() => trimMermaidCache(null)).not.toThrow();
    expect(() => clearMermaidCache(null)).not.toThrow();

    const storage = memoryStorage();
    writeCachedMermaidSvg("flowchart TB\n A-->B", "default", { id: "id", svg: "<svg/>" }, storage);
    clearMermaidCache(storage);
    expect(storage.length).toBe(0);
  });
});

describe("rewriteSvgIds", () => {
  it("mengganti semua id internal ke id instance baru", () => {
    const svg =
      '<svg id="mermaid-old"><style>#mermaid-old .node{fill:red}</style>' +
      '<marker id="mermaid-old_flowchart-v2-pointEnd"/></svg>';
    const rewritten = rewriteSvgIds(svg, "mermaid-old", "mermaid-new");
    expect(rewritten).not.toContain("mermaid-old");
    expect(rewritten).toContain('id="mermaid-new"');
    expect(rewritten).toContain("#mermaid-new .node");
    expect(rewritten).toContain('id="mermaid-new_flowchart-v2-pointEnd"');
  });

  it("tidak mengubah apa pun bila id sama atau kosong", () => {
    expect(rewriteSvgIds('<svg id="a"/>', "a", "a")).toBe('<svg id="a"/>');
    expect(rewriteSvgIds('<svg id="a"/>', "", "b")).toBe('<svg id="a"/>');
    expect(rewriteSvgIds("", "a", "b")).toBe("");
  });
});
