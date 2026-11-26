import { basename, dirname, join } from "node:path";
import { resolveWithin } from "./workspace.ts";

const IGNORED = new Set([".git", "node_modules", ".DS_Store"]);
const MAX_DOCUMENTS = 500;
const MAX_CONTENT_BYTES = 500_000;
/** Cukup untuk heading `# Judul` di awal file tanpa membaca seluruh dokumen. */
const TITLE_HEAD_BYTES = 4_000;

export interface LocalDocEntry {
  path: string;
  title: string;
}

export interface LocalDocFile extends LocalDocEntry {
  content: string;
}

export function slugifyDocumentTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "document";
}

function titleFromContent(rel: string, content: string): string {
  const match = /^#\s+(.+)$/m.exec(content.slice(0, TITLE_HEAD_BYTES));
  if (match) return match[1].trim();
  return basename(rel).replace(/\.md$/i, "");
}

/**
 * Baca potongan awal file saja. Listing dokumen lokal membaca ratusan file untuk
 * mengambil judul; membaca semuanya penuh mahal dan memblokir polling daftar.
 */
async function readDocumentHead(abs: string, limit = TITLE_HEAD_BYTES): Promise<string> {
  const file = await Deno.open(abs, { read: true });
  try {
    const buffer = new Uint8Array(limit);
    const read = await file.read(buffer);
    return read ? new TextDecoder().decode(buffer.subarray(0, read)) : "";
  } finally {
    try {
      file.close();
    } catch {
      // ignore
    }
  }
}

async function pathExists(root: string, rel: string): Promise<boolean> {
  const abs = resolveWithin(root, rel);
  if (!abs) return false;
  const stat = await Deno.stat(abs).catch(() => null);
  return !!stat?.isFile;
}

export async function listLocalDocuments(root: string): Promise<LocalDocEntry[]> {
  const entries: LocalDocEntry[] = [];

  const walk = async (dir: string, rel: string): Promise<void> => {
    for await (const entry of Deno.readDir(dir)) {
      if (entries.length >= MAX_DOCUMENTS) return;
      if (IGNORED.has(entry.name) || entry.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        await walk(join(dir, entry.name), childRel);
        continue;
      }
      if (!entry.isFile || !entry.name.toLowerCase().endsWith(".md")) continue;
      let title = entry.name.replace(/\.md$/i, "");
      try {
        title = titleFromContent(childRel, await readDocumentHead(join(dir, entry.name)));
      } catch {
        // keep filename as title
      }
      entries.push({ path: childRel, title });
    }
  };

  await walk(root, "");
  entries.sort((a, b) => a.title.localeCompare(b.title) || a.path.localeCompare(b.path));
  return entries;
}

export async function readLocalDocument(root: string, rel: string): Promise<LocalDocFile> {
  const abs = resolveWithin(root, rel);
  if (!abs) throw new Error("Path di luar document workspace.");
  const stat = await Deno.stat(abs).catch(() => null);
  if (!stat?.isFile) throw new Error("Dokumen tidak ditemukan.");
  if (stat.size > MAX_CONTENT_BYTES) throw new Error("Dokumen terlalu besar (maks 500 KB).");
  const content = await Deno.readTextFile(abs);
  return { path: rel, title: titleFromContent(rel, content), content };
}

export async function createLocalDocument(root: string, title: string): Promise<LocalDocFile> {
  const clean = title.trim() || "Dokumen";
  const slug = slugifyDocumentTitle(clean);
  let rel = `${slug}.md`;
  let index = 2;
  while (await pathExists(root, rel)) {
    rel = `${slug}-${index}.md`;
    index++;
  }
  const abs = resolveWithin(root, rel);
  if (!abs) throw new Error("Path di luar document workspace.");
  await Deno.mkdir(dirname(abs), { recursive: true });
  await Deno.writeTextFile(abs, `# ${clean}\n\n`);
  return await readLocalDocument(root, rel);
}

export interface UpdateLocalDocumentInput {
  title?: string;
  content?: string;
}

export async function updateLocalDocument(
  root: string,
  rel: string,
  input: UpdateLocalDocumentInput,
): Promise<LocalDocFile> {
  const current = resolveWithin(root, rel);
  if (!current) throw new Error("Path di luar document workspace.");
  const stat = await Deno.stat(current).catch(() => null);
  if (!stat?.isFile) throw new Error("Dokumen tidak ditemukan.");

  let nextRel = rel;
  if (input.title?.trim()) {
    const slug = slugifyDocumentTitle(input.title.trim());
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : "";
    let target = `${dir}${slug}.md`;
    let index = 2;
    while (target !== rel && await pathExists(root, target)) {
      target = `${dir}${slug}-${index}.md`;
      index++;
    }
    if (target !== rel) {
      const targetAbs = resolveWithin(root, target);
      if (!targetAbs) throw new Error("Path di luar document workspace.");
      await Deno.mkdir(dirname(targetAbs), { recursive: true });
      await Deno.rename(current, targetAbs);
      nextRel = target;
    }
  }

  if (input.content !== undefined) {
    const target = resolveWithin(root, nextRel);
    if (!target) throw new Error("Path di luar document workspace.");
    await Deno.writeTextFile(target, input.content.slice(0, MAX_CONTENT_BYTES));
  }
  return await readLocalDocument(root, nextRel);
}
