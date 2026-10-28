import { dirname, resolve, sep } from "node:path";

const IGNORED = new Set([".git", "node_modules", ".DS_Store"]);
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "dist",
  "build",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  ".turbo",
  ".parcel-cache",
]);
const MAX_ENTRIES = 1000;
const MAX_FILE_BYTES = 200_000;
const MAX_INDEX_FILES = 5000;
const MAX_INDEX_DEPTH = 12;
const MAX_FIND_FILES = 3000;
const MAX_FIND_MATCHES = 200;
const MAX_FIND_PREVIEW = 240;
const MAX_FIND_BYTES = 8_000_000;

export interface WorkspaceEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

export interface DirectoryListing {
  entries: WorkspaceEntry[];
  truncated: boolean;
}

export interface FileReadResult {
  content: string;
  size: number;
  truncated: boolean;
  binary: boolean;
}

export function resolveWithin(root: string, rel: string): string | null {
  const rootAbs = resolve(root);
  let realRoot: string;
  try {
    realRoot = Deno.realPathSync(rootAbs);
  } catch {
    return null;
  }

  const target = resolve(rootAbs, rel && rel.length > 0 ? rel : ".");
  if (target !== rootAbs && !target.startsWith(rootAbs + sep)) return null;

  let probe = target;
  while (true) {
    try {
      const realProbe = Deno.realPathSync(probe);
      if (realProbe === realRoot || realProbe.startsWith(realRoot + sep)) return target;
      return null;
    } catch {
      const parent = dirname(probe);
      if (parent === probe) return null;
      probe = parent;
    }
  }
}

function joinChild(dir: string, name: string): string {
  return `${dir}${sep}${name}`;
}

export async function listDirectory(root: string, rel: string): Promise<DirectoryListing> {
  const dir = resolveWithin(root, rel);
  if (!dir) throw new Error("Path di luar workspace.");

  const stat = await Deno.stat(dir).catch(() => null);
  if (!stat?.isDirectory) throw new Error("Direktori tidak ditemukan.");

  const entries: WorkspaceEntry[] = [];
  let truncated = false;

  for await (const entry of Deno.readDir(dir)) {
    if (IGNORED.has(entry.name)) continue;
    if (entries.length >= MAX_ENTRIES) {
      truncated = true;
      break;
    }
    const item: WorkspaceEntry = {
      name: entry.name,
      path: rel ? `${rel}/${entry.name}` : entry.name,
      type: entry.isDirectory ? "dir" : "file",
    };
    if (entry.isFile) {
      try {
        item.size = (await Deno.stat(joinChild(dir, entry.name))).size;
      } catch {
        // ignore unreadable entries
      }
    }
    entries.push(item);
  }

  entries.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1
  );
  return { entries, truncated };
}

export async function readWorkspaceFile(root: string, rel: string): Promise<FileReadResult> {
  const file = resolveWithin(root, rel);
  if (!file) throw new Error("Path di luar workspace.");

  const stat = await Deno.stat(file).catch(() => null);
  if (!stat?.isFile) throw new Error("File tidak ditemukan.");

  const bytes = await Deno.readFile(file);
  const truncated = bytes.length > MAX_FILE_BYTES;
  const slice = bytes.subarray(0, MAX_FILE_BYTES);
  const binary = slice.includes(0);
  return {
    content: binary ? "" : new TextDecoder().decode(slice),
    size: stat.size,
    truncated,
    binary,
  };
}

export interface FileRawResult {
  bytes: Uint8Array;
  size: number;
}

export async function readWorkspaceFileRaw(root: string, rel: string): Promise<FileRawResult> {
  const file = resolveWithin(root, rel);
  if (!file) throw new Error("Path di luar workspace.");

  const stat = await Deno.stat(file).catch(() => null);
  if (!stat?.isFile) throw new Error("File tidak ditemukan.");

  return { bytes: await Deno.readFile(file), size: stat.size };
}

export async function writeWorkspaceFile(
  root: string,
  rel: string,
  content: string,
): Promise<void> {
  const file = resolveWithin(root, rel);
  if (!file) throw new Error("Path di luar workspace.");
  await Deno.mkdir(dirname(file), { recursive: true });
  await Deno.writeTextFile(file, content);
}

export interface WorkspaceFileIndex {
  files: string[];
  truncated: boolean;
}

export async function listWorkspaceFiles(
  root: string,
  limit = MAX_INDEX_FILES,
): Promise<WorkspaceFileIndex> {
  const files: string[] = [];
  let truncated = false;

  const walk = async (rel: string, depth: number): Promise<void> => {
    if (truncated || depth > MAX_INDEX_DEPTH) return;
    const dir = resolveWithin(root, rel);
    if (!dir) return;
    const entries: Deno.DirEntry[] = [];
    try {
      for await (const entry of Deno.readDir(dir)) entries.push(entry);
    } catch {
      return;
    }
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (truncated) return;
      if (entry.isSymlink) continue;
      const entryPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(entryPath, depth + 1);
        continue;
      }
      if (!entry.isFile) continue;
      if (IGNORED.has(entry.name)) continue;
      files.push(entryPath);
      if (files.length >= limit) {
        truncated = true;
        return;
      }
    }
  };

  await walk("", 0);
  return { files, truncated };
}

export interface WorkspaceFindMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface WorkspaceFindResult {
  matches: WorkspaceFindMatch[];
  scanned: number;
  truncated: boolean;
  error?: string;
}

export async function findInWorkspace(
  root: string,
  query: string,
  options: { caseSensitive?: boolean; regex?: boolean } = {},
): Promise<WorkspaceFindResult> {
  const raw = query.trim();
  if (!raw) return { matches: [], scanned: 0, truncated: false };
  if (raw.length > 300) {
    return {
      matches: [],
      scanned: 0,
      truncated: false,
      error: "Query terlalu panjang (maks 300).",
    };
  }

  let regex: RegExp | null = null;
  let literal = raw.toLowerCase();
  if (options.regex) {
    try {
      regex = new RegExp(raw, options.caseSensitive ? "" : "i");
    } catch (error) {
      return {
        matches: [],
        scanned: 0,
        truncated: false,
        error: `Regex tidak valid: ${(error as Error).message}`,
      };
    }
  } else if (!options.caseSensitive) {
    literal = raw.toLowerCase();
  }

  const index = await listWorkspaceFiles(root, MAX_FIND_FILES);
  const files = index.files;
  const matches: WorkspaceFindMatch[] = [];
  let scanned = 0;
  let scannedBytes = 0;
  let truncated = index.truncated;

  for (const path of files) {
    if (scanned >= MAX_FIND_FILES) {
      truncated = true;
      break;
    }
    let file;
    try {
      file = await readWorkspaceFile(root, path);
    } catch {
      continue;
    }
    scanned += 1;
    scannedBytes += file.size;
    if (file.binary || !file.content) {
      if (scannedBytes >= MAX_FIND_BYTES) truncated = true;
      if (truncated) break;
      continue;
    }
    const lines = file.content.split(/\r?\n/);
    for (let indexLine = 0; indexLine < lines.length; indexLine++) {
      const line = lines[indexLine];
      let column = -1;
      if (regex) {
        const match = regex.exec(line);
        if (match) column = match.index;
      } else {
        const haystack = options.caseSensitive ? line : line.toLowerCase();
        const needle = options.caseSensitive ? raw : literal;
        column = haystack.indexOf(needle);
      }
      if (column < 0) continue;
      matches.push({
        path,
        line: indexLine + 1,
        column: column + 1,
        preview: line.trim().slice(0, MAX_FIND_PREVIEW),
      });
      if (matches.length >= MAX_FIND_MATCHES) {
        truncated = true;
        return { matches, scanned, truncated };
      }
    }
    if (scannedBytes >= MAX_FIND_BYTES) {
      truncated = true;
      break;
    }
  }

  return { matches, scanned, truncated };
}
