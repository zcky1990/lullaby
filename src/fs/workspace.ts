import { dirname, resolve, sep } from "node:path";

const IGNORED = new Set([".git", "node_modules", ".DS_Store"]);
const MAX_ENTRIES = 1000;
const MAX_FILE_BYTES = 200_000;

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
  const target = resolve(rootAbs, rel && rel.length > 0 ? rel : ".");
  if (target === rootAbs) return target;
  if (!target.startsWith(rootAbs + sep)) return null;
  return target;
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
