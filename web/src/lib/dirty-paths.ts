/**
 * Helper penanda "belum disimpan" untuk explorer.
 *
 * Tab editor (`kind: "file"`) menyimpan `dirty` selama isi Monaco berbeda dengan disk.
 * Explorer perlu tahu path mana yang dirty agar bisa menebalkan nama file, jadi tab
 * diringkas menjadi `Set<path>` yang sudah dinormalkan.
 *
 * Karena daftar tab dikelola `useEditorTabs` (bukan explorer), ringkasannya juga
 * dipublikasikan lewat store kecil di bawah agar `FileTreePanel` bisa berlangganan
 * tanpa harus mengoper prop dari `App.tsx`.
 */

/** Samakan separator (Windows) dan buang prefix `./` / spasi. */
export function normalizeDirtyPath(path: string | null | undefined): string {
  return String(path ?? "")
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .trim();
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}

interface DirtyTabLike {
  kind: string;
  title: string;
  ref?: string;
  dirty?: boolean;
}

/** Kumpulan path file yang punya tab editor dengan perubahan belum disimpan. */
export function collectDirtyPaths(
  tabs: readonly DirtyTabLike[] | null | undefined,
): Set<string> {
  const paths = new Set<string>();
  for (const tab of tabs ?? []) {
    if (!tab || tab.kind !== "file" || !tab.dirty) continue;
    const key = normalizeDirtyPath(tab.ref ?? tab.title);
    if (key) paths.add(key);
  }
  return paths;
}

/**
 * Apakah `path` (dari explorer / quick open / find) sedang dirty.
 * Path relatif dan absolut dibandingkan lewat suffix agar tetap cocok bila satu sisi
 * menyimpan path absolut (mis. `tab.ref` hasil open dari chat).
 */
export function isDirtyPath(
  dirtyPaths: ReadonlySet<string> | null | undefined,
  path: string | null | undefined,
): boolean {
  if (!dirtyPaths || dirtyPaths.size === 0) return false;
  const key = normalizeDirtyPath(path);
  if (!key) return false;
  if (dirtyPaths.has(key)) return true;

  const absolute = isAbsolutePath(key);
  for (const dirty of dirtyPaths) {
    if (isAbsolutePath(dirty) === absolute) continue;
    const longer = absolute ? key : dirty;
    const shorter = absolute ? dirty : key;
    if (longer.endsWith(`/${shorter}`)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Penentuan flag `dirty` dari patch tab
 * ------------------------------------------------------------------ */

export interface DirtyPatchLike {
  content?: string;
  dirty?: boolean;
  loading?: boolean;
}

export interface DirtyResolution {
  /** `undefined` = flag `dirty` tab tidak diubah. */
  dirty?: boolean;
  /** Baseline baru untuk tab ini; `undefined` = baseline tidak berubah. */
  baseline?: string;
}

/**
 * Tentukan flag `dirty` sebuah tab file dari patch yang masuk.
 *
 * - patch tanpa `content` (mis. `{ loading: true }`) → flag tidak diubah;
 * - `content` tanpa `dirty` eksplisit → isi berasal dari disk (open/reload), baseline
 *   diperbarui dan tab dianggap tersimpan;
 * - `dirty: true` (dari Monaco `onChange`) → bandingkan dengan baseline supaya perubahan
 *   programatik yang isinya sama tidak menandai file sebagai belum disimpan;
 * - `dirty: false` (setelah simpan) → baseline mengikuti isi terbaru.
 */
export function resolveDirtyFlag(
  patch: DirtyPatchLike,
  baseline: string | undefined,
): DirtyResolution {
  if (patch.content === undefined) return { dirty: patch.dirty };
  if (patch.dirty === undefined && patch.loading !== true) {
    return { dirty: false, baseline: patch.content };
  }
  if (patch.dirty === true) {
    return { dirty: baseline === undefined ? true : baseline !== patch.content };
  }
  if (patch.dirty === false) {
    return { dirty: false, baseline: patch.content };
  }
  return { dirty: patch.dirty };
}

/* ------------------------------------------------------------------ *
 * Store ringan (dipakai `useDirtyPaths`)
 * ------------------------------------------------------------------ */

type DirtyPathsListener = () => void;

const EMPTY_DIRTY_PATHS: ReadonlySet<string> = new Set();
let snapshot: ReadonlySet<string> = EMPTY_DIRTY_PATHS;
const listeners = new Set<DirtyPathsListener>();

function samePaths(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

/** Publikasikan ringkasan tab dirty; no-op bila isinya sama (menghindari re-render). */
export function publishDirtyPaths(paths: ReadonlySet<string> | null | undefined): void {
  const next = paths ?? EMPTY_DIRTY_PATHS;
  if (samePaths(snapshot, next)) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Snapshot stabil untuk `useSyncExternalStore`. */
export function getDirtyPathsSnapshot(): ReadonlySet<string> {
  return snapshot;
}

export function subscribeDirtyPaths(listener: DirtyPathsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Dipakai test dan saat project diganti. */
export function resetDirtyPaths(): void {
  publishDirtyPaths(EMPTY_DIRTY_PATHS);
}
