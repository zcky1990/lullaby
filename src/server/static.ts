import { type Asset, ASSETS } from "../ui/assets.generated.ts";

const INDEX_PATH = "/index.html";
/** Aset hasil build Vite punya hash di nama file → aman di-cache selamanya. */
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
/** Aset publik tanpa hash (ikon, manifest, …) → boleh di-cache tapi wajib revalidasi. */
const REVALIDATE_CACHE = "no-cache";
/** Shell HTML tidak boleh di-cache: versi baru harus langsung terpakai. */
const NO_STORE = "no-store";
const HASHED_ASSET = /^\/assets\/.+-[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/i;

/**
 * `assets.generated.ts` lama belum punya field `compression`, jadi tipe lokal
 * ini dibuat toleran supaya `static.ts` tidak perlu ikut di-regenerate.
 */
type StoredAsset = Asset & { compression?: "gzip" };

interface Decoded {
  /** String untuk aset `utf8`, byte untuk `base64` (masih ter-gzip bila `compressed`). */
  body: string | Uint8Array<ArrayBuffer>;
  compressed: boolean;
  etag: string;
}

/** PERF-6: decode base64 hanya sekali per aset, bukan pada setiap request. */
const decodedCache = new Map<string, Decoded>();
const inflatedCache = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

function base64ToBytes(body: string): Uint8Array<ArrayBuffer> {
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** FNV-1a 32-bit — cukup untuk ETag aset, jauh lebih murah dari digest kripto. */
function hash(body: string | Uint8Array<ArrayBuffer>): string {
  let value = 0x811c9dc5;
  if (typeof body === "string") {
    for (let i = 0; i < body.length; i++) {
      value = Math.imul(value ^ body.charCodeAt(i), 0x01000193) >>> 0;
    }
  } else {
    for (let i = 0; i < body.length; i++) {
      value = Math.imul(value ^ body[i], 0x01000193) >>> 0;
    }
  }
  return value.toString(16).padStart(8, "0");
}

function decode(pathname: string, asset: StoredAsset): Decoded {
  const cached = decodedCache.get(pathname);
  if (cached) return cached;

  let entry: Decoded;
  if (asset.encoding === "base64") {
    const bytes = base64ToBytes(asset.body);
    entry = {
      body: bytes,
      compressed: asset.compression === "gzip",
      etag: `W/"${hash(bytes)}-${bytes.length}"`,
    };
  } else {
    entry = {
      body: asset.body,
      compressed: false,
      etag: `W/"${hash(asset.body)}-${asset.body.length}"`,
    };
  }

  decodedCache.set(pathname, entry);
  return entry;
}

function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function inflateOnce(
  pathname: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const cached = inflatedCache.get(pathname);
  if (cached) return cached;
  const loading = inflate(bytes).catch((error: unknown) => {
    // Jangan simpan kegagalan: request berikutnya boleh mencoba lagi.
    inflatedCache.delete(pathname);
    throw error;
  });
  inflatedCache.set(pathname, loading);
  return loading;
}

/** Body stream untuk klien tanpa dukungan gzip: dekompresi lazy, API tetap sync. */
function inflateStream(
  pathname: string,
  bytes: Uint8Array<ArrayBuffer>,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async start(controller) {
      try {
        controller.enqueue(await inflateOnce(pathname, bytes));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

function isHashedAsset(pathname: string): boolean {
  return HASHED_ASSET.test(pathname);
}

function cachePolicy(pathname: string): string {
  if (pathname === INDEX_PATH) return NO_STORE;
  if (isHashedAsset(pathname)) return IMMUTABLE_CACHE;
  return REVALIDATE_CACHE;
}

/**
 * Klien tanpa header `accept-encoding` (mis. `serveAsset(path)` tanpa request)
 * dianggap mendukung gzip — webview Chromium selalu mendukung.
 */
function acceptsGzip(req?: Request): boolean {
  const header = req?.headers.get("accept-encoding");
  if (header == null) return true;
  return header.split(",").some((part) => {
    const [token, ...params] = part.trim().toLowerCase().split(";");
    if (token !== "gzip") return false;
    return !params.some((param) => /^\s*q=0(\.0*)?\s*$/.test(param));
  });
}

function toResponse(pathname: string, asset: StoredAsset, req?: Request): Response {
  const decoded = decode(pathname, asset);
  const headers = new Headers({
    "content-type": asset.contentType,
    "cache-control": cachePolicy(pathname),
  });

  // Aset ber-hash tidak butuh ETag (immutable) dan shell HTML tidak di-cache.
  const validatable = pathname !== INDEX_PATH && !isHashedAsset(pathname);
  if (validatable) {
    headers.set("etag", decoded.etag);
    if (req?.headers.get("if-none-match") === decoded.etag) {
      return new Response(null, { status: 304, headers });
    }
  }

  if (decoded.compressed) {
    headers.set("vary", "accept-encoding");
    const bytes = decoded.body as Uint8Array<ArrayBuffer>;
    if (acceptsGzip(req)) {
      headers.set("content-encoding", "gzip");
      return new Response(bytes, { headers });
    }
    return new Response(inflateStream(pathname, bytes), { headers });
  }

  return new Response(decoded.body, { headers });
}

/**
 * `req` opsional supaya pemanggil lama (`serveAsset(pathname)`) tetap jalan.
 * Teruskan request dari router untuk mengaktifkan negosiasi `accept-encoding`
 * dan balasan `304` berbasis ETag.
 */
export function serveAsset(pathname: string, req?: Request): Response | null {
  const asset = ASSETS[pathname] as StoredAsset | undefined;
  if (asset) return toResponse(pathname, asset, req);

  const hasExtension = /\.[a-z0-9]+$/i.test(pathname);
  if (hasExtension) return new Response("Not found", { status: 404 });

  const index = ASSETS[INDEX_PATH] as StoredAsset | undefined;
  return index ? toResponse(INDEX_PATH, index, req) : null;
}
