/**
 * Cache SVG Mermaid (PERF-4 langkah 3).
 *
 * Diagram di dokumen biasanya statis: sekali dirender, hasilnya selalu sama untuk
 * `chart` + tema yang sama. Tanpa cache, setiap buka dokumen (atau setiap restart
 * aplikasi) memaksa mengunduh ulang chunk `mermaid` (±618 KB) + renderer diagramnya.
 *
 * Cache disimpan di `localStorage` dengan key hasil hash (`versi + tema + source`),
 * sehingga:
 * - source diagram tidak ikut terbaca di key (hanya hash 16 heksadesimal),
 * - upgrade mermaid / perubahan tema otomatis tidak memakai entri lama
 *   (bump `MERMAID_CACHE_VERSION` saat upgrade mermaid),
 * - lookup tetap sinkron, jadi komponen bisa memutuskan untuk TIDAK mengimpor
 *   mermaid sama sekali bila cache kena.
 *
 * Batas ukuran menjaga `localStorage` (±5 MB) tidak penuh: entri terbesar dibuang
 * (tidak di-cache) dan entri tertua dievakuasi lebih dulu.
 */

/** Naikkan saat upgrade `mermaid` atau saat opsi `initialize()` berubah. */
export const MERMAID_CACHE_VERSION = "v1";

const KEY_PREFIX = "lullaby:mermaid-svg:";

export const MERMAID_CACHE_LIMITS = {
  /** Entri lebih besar dari ini tidak di-cache (diagram raksasa tetap dirender). */
  maxEntryBytes: 256 * 1024,
  /** Total ukuran semua entri. */
  maxTotalBytes: 2 * 1024 * 1024,
  maxEntries: 40,
} as const;

/** Subset `Storage` yang dipakai cache — cukup untuk di-fake di test. */
export interface MermaidCacheStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CachedMermaidSvg {
  /** id SVG saat dirender; dipakai untuk menulis ulang id per instance. */
  id: string;
  svg: string;
}

interface CacheEntry extends CachedMermaidSvg {
  ts: number;
  bytes: number;
}

/**
 * Hash 64-bit (FNV-1a + djb2) dari versi, tema, dan source diagram.
 * Dipakai sebagai key penyimpanan sekaligus deteksi tabrakan yang murah.
 */
export function mermaidCacheKey(
  chart: string,
  theme: string,
  version: string = MERMAID_CACHE_VERSION,
): string {
  const input = `${version}\u0000${theme}\u0000${chart}`;
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    fnv = Math.imul(fnv ^ code, 0x01000193) >>> 0;
    djb = (Math.imul(djb, 33) + code) >>> 0;
  }
  const hash = `${fnv.toString(16).padStart(8, "0")}${djb.toString(16).padStart(8, "0")}`;
  return `${KEY_PREFIX}${hash}`;
}

/**
 * Id SVG mermaid dipakai sebagai prefix semua id internal (`#<id> .node`,
 * `<id>_flowchart-v2-pointEnd`, ...). Saat SVG diambil dari cache, id lama
 * ditulis ulang agar dua instance diagram yang sama di satu halaman tidak
 * bertabrakan.
 */
export function rewriteSvgIds(svg: string, fromId: string, toId: string): string {
  if (!svg || !fromId || fromId === toId) return svg;
  return svg.split(fromId).join(toId);
}

function defaultStorage(): MermaidCacheStorage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    // Mode privat / storage diblokir.
    return null;
  }
}

function safeRemove(storage: MermaidCacheStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // abaikan
  }
}

function listEntries(
  storage: MermaidCacheStorage,
): Array<{ key: string; ts: number; bytes: number }> {
  const entries: Array<{ key: string; ts: number; bytes: number }> = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith(KEY_PREFIX)) continue;
    let ts = 0;
    let bytes = 0;
    try {
      const raw = storage.getItem(key);
      const parsed = raw ? (JSON.parse(raw) as Partial<CacheEntry>) : undefined;
      if (parsed) {
        ts = typeof parsed.ts === "number" ? parsed.ts : 0;
        bytes = typeof parsed.bytes === "number" ? parsed.bytes : (parsed.svg?.length ?? 0);
      }
    } catch {
      // entri rusak: tetap dihitung supaya ikut dievakuasi
    }
    entries.push({ key, ts, bytes });
  }
  // Terlama lebih dulu (ts, lalu urutan penyimpanan).
  return entries.sort((a, b) => a.ts - b.ts);
}

/** Buang entri tertua sampai jumlah/ukuran total kembali di bawah batas. */
export function trimMermaidCache(storage: MermaidCacheStorage | null = defaultStorage()): void {
  if (!storage) return;
  const entries = listEntries(storage);
  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  let count = entries.length;
  for (const entry of entries) {
    if (count <= MERMAID_CACHE_LIMITS.maxEntries && total <= MERMAID_CACHE_LIMITS.maxTotalBytes) {
      break;
    }
    safeRemove(storage, entry.key);
    total -= entry.bytes;
    count -= 1;
  }
}

/** Ambil SVG dari cache. `null` bila belum ada / entri rusak. */
export function readCachedMermaidSvg(
  chart: string,
  theme: string,
  storage: MermaidCacheStorage | null = defaultStorage(),
): CachedMermaidSvg | null {
  if (!storage || !chart.trim()) return null;
  try {
    const raw = storage.getItem(mermaidCacheKey(chart, theme));
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<CacheEntry>;
    if (typeof entry.id !== "string" || !entry.id) return null;
    if (typeof entry.svg !== "string" || !entry.svg) return null;
    return { id: entry.id, svg: entry.svg };
  } catch {
    return null;
  }
}

/** Simpan SVG hasil render. Gagal menyimpan bukan error fatal. */
export function writeCachedMermaidSvg(
  chart: string,
  theme: string,
  entry: CachedMermaidSvg,
  storage: MermaidCacheStorage | null = defaultStorage(),
): void {
  if (!storage || !chart.trim() || !entry.id || !entry.svg) return;
  const key = mermaidCacheKey(chart, theme);
  const bytes = entry.svg.length;
  if (bytes > MERMAID_CACHE_LIMITS.maxEntryBytes) {
    safeRemove(storage, key);
    return;
  }
  const record: CacheEntry = { id: entry.id, svg: entry.svg, ts: Date.now(), bytes };
  try {
    storage.setItem(key, JSON.stringify(record));
  } catch {
    // Kuota penuh: evakuasi separuh entri tertua lalu coba sekali lagi.
    const evicted = Math.ceil(MERMAID_CACHE_LIMITS.maxEntries / 2);
    for (const old of listEntries(storage).slice(0, evicted)) {
      safeRemove(storage, old.key);
    }
    try {
      storage.setItem(key, JSON.stringify(record));
    } catch {
      return;
    }
  }
  trimMermaidCache(storage);
}

/** Hapus semua entri cache (dipakai test + pembersihan manual bila perlu). */
export function clearMermaidCache(storage: MermaidCacheStorage | null = defaultStorage()): void {
  if (!storage) return;
  for (const entry of listEntries(storage)) safeRemove(storage, entry.key);
}
