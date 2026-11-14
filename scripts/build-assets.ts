const DIST = new URL("../web/dist/", import.meta.url);
const OUT = new URL("../src/ui/assets.generated.ts", import.meta.url);

/**
 * Guard PERF-1: aset biner disimpan sebagai base64 (+33%) di dalam binary, jadi satu file
 * besar langsung membengkakkan build. Batas ini menangkap kasus seperti favicon 1,5 MB.
 * JS/CSS/HTML/SVG/JSON tidak ikut dihitung karena disimpan sebagai teks (tanpa inflasi).
 */
const MAX_BINARY_ASSET_BYTES = 500 * 1024;

/** Pengecualian guard: isi route-nya dan tulis alasannya. Contoh: "/contoh-besar.bin". */
const SIZE_GUARD_EXEMPT = new Set<string>([]);

/**
 * PERF-5: aset disimpan gzip + base64 di dalam binary supaya teks (JS/CSS/HTML/JSON/SVG)
 * turun ~3–4×. Hasil gzip hanya dipakai bila benar-benar mengecil — PNG/WebP/WOFF2 sudah
 * terkompresi, jadi keduanya disimpan apa adanya.
 */
const MIN_COMPRESSION_RATIO = 0.9;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
};

const TEXT_EXTENSIONS = new Set([".html", ".js", ".mjs", ".css", ".json", ".map", ".svg", ".txt"]);

const INDEX_PATH = "/index.html";

interface Entry {
  route: string;
  abs: string;
}

interface StoredAsset {
  contentType: string;
  encoding: "utf8" | "base64";
  compression?: "gzip";
  body: string;
}

async function walk(dirUrl: URL, route: string, out: Entry[]): Promise<Entry[]> {
  for await (const entry of Deno.readDir(dirUrl)) {
    const childRoute = `${route}/${entry.name}`.replace(/\/+/g, "/");
    const childUrl = new URL(`${entry.name}${entry.isDirectory ? "/" : ""}`, dirUrl);
    if (entry.isDirectory) {
      await walk(childUrl, childRoute, out);
    } else {
      out.push({ route: childRoute, abs: childUrl.pathname });
    }
  }
  return out;
}

function extensionOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? "" : path.slice(idx).toLowerCase();
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function sourceHint(route: string): string {
  return route.startsWith("/assets/")
    ? "hasil build Vite — perkecil di sumbernya"
    : `sumber: web/public${route}`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function findOversizedBinaries(
  entries: Entry[],
): Promise<{ route: string; size: number }[]> {
  const found: { route: string; size: number }[] = [];
  for (const entry of entries) {
    if (TEXT_EXTENSIONS.has(extensionOf(entry.route))) continue;
    if (SIZE_GUARD_EXEMPT.has(entry.route)) continue;
    const { size } = await Deno.stat(entry.abs);
    if (size > MAX_BINARY_ASSET_BYTES) found.push({ route: entry.route, size });
  }
  return found.sort((a, b) => b.size - a.size);
}

const entries = await walk(DIST, "", []);

const oversized = await findOversizedBinaries(entries);
if (oversized.length > 0) {
  const list = oversized
    .map((item) => `  ${item.route} — ${formatBytes(item.size)} (${sourceHint(item.route)})`)
    .join("\n");
  const message = [
    `Aset biner > ${formatBytes(MAX_BINARY_ASSET_BYTES)} akan ter-embed base64 (+33%):`,
    list,
    "",
    "Perbaiki dengan cara: kompres atau ganti format asetnya (mis. PNG → WebP), hapus bila",
    "tidak dipakai, atau — bila memang disengaja — tambahkan route-nya ke SIZE_GUARD_EXEMPT",
    "beserta alasan di scripts/build-assets.ts.",
    "Bila angka ini berasal dari web/dist yang basi: jalankan `npm --prefix web run build`",
    "(emptyOutDir) lalu ulangi.",
    "Untuk menurunkan error ini menjadi peringatan: RND_ASSETS_SIZE_GUARD=warn.",
  ].join("\n");

  if (Deno.env.get("RND_ASSETS_SIZE_GUARD") === "warn") {
    console.warn(`\n${message}\n`);
  } else {
    throw new Error(message);
  }
}

const encoder = new TextEncoder();
const assets: Record<string, StoredAsset> = {};
/** Ukuran asli semua aset yang di-embed (sebelum gzip/base64). */
let rawBytes = 0;
/** Ukuran isi `body` yang benar-benar ditulis ke assets.generated.ts. */
let storedBytes = 0;

for (const entry of entries) {
  if (entry.route === INDEX_PATH) continue;

  const ext = extensionOf(entry.route);
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const isText = TEXT_EXTENSIONS.has(ext);
  const source = isText
    ? encoder.encode(await Deno.readTextFile(entry.abs))
    : await Deno.readFile(entry.abs);
  rawBytes += source.length;

  const compressed = await gzipBytes(source);
  if (compressed.length <= source.length * MIN_COMPRESSION_RATIO) {
    const body = toBase64(compressed);
    storedBytes += body.length;
    assets[entry.route] = { contentType, encoding: "base64", compression: "gzip", body };
  } else if (isText) {
    const body = new TextDecoder().decode(source);
    storedBytes += body.length;
    assets[entry.route] = { contentType, encoding: "utf8", body };
  } else {
    const body = toBase64(source);
    storedBytes += body.length;
    assets[entry.route] = { contentType, encoding: "base64", body };
  }
}

// Shell HTML dibiarkan sebagai teks: ukurannya kecil dan `static.ts` bisa
// menyajikannya tanpa dekompresi.
const indexHtml = await Deno.readTextFile(new URL("index.html", DIST));
rawBytes += encoder.encode(indexHtml).length;
storedBytes += indexHtml.length;
assets[INDEX_PATH] = {
  contentType: "text/html; charset=utf-8",
  encoding: "utf8",
  body: indexHtml,
};

const lines = [
  "// AUTO-GENERATED by scripts/build-assets.ts. Do not edit by hand.",
  "export interface Asset {",
  "  contentType: string;",
  '  encoding: "utf8" | "base64";',
  '  /** Ada bila `body` (base64) berisi byte gzip — lihat src/server/static.ts. */',
  '  compression?: "gzip";',
  "  body: string;",
  "}",
  "",
  "export const ASSETS: Record<string, Asset> = {",
];

for (const [route, asset] of Object.entries(assets)) {
  const compression = asset.compression
    ? `, compression: ${JSON.stringify(asset.compression)}`
    : "";
  lines.push(
    `  ${JSON.stringify(route)}: { contentType: ${JSON.stringify(asset.contentType)}, encoding: ${
      JSON.stringify(asset.encoding)
    }${compression}, body: ${JSON.stringify(asset.body)} },`,
  );
}

lines.push("};", "");

await Deno.writeTextFile(OUT, lines.join("\n"));
console.log(
  `Wrote ${Object.keys(assets).length} assets (${formatBytes(rawBytes)} mentah → ` +
    `${formatBytes(storedBytes)} tersimpan sebagai teks/base64) to src/ui/assets.generated.ts`,
);
