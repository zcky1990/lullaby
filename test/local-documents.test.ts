import { equal } from "node:assert/strict";
import { join } from "node:path";
import { listLocalDocuments } from "../src/fs/documents.ts";

async function withDocsRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir();
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("listLocalDocuments mengambil judul dari heading di awal file", async () => {
  await withDocsRoot(async (root) => {
    await Deno.writeTextFile(join(root, "a.md"), "# Judul Pertama\n\nisi\n");
    await Deno.mkdir(join(root, "nested"));
    await Deno.writeTextFile(join(root, "nested", "b.md"), "# Judul Kedua\n\nisi\n");

    const docs = await listLocalDocuments(root);
    const byPath = new Map(docs.map((doc) => [doc.path, doc.title]));

    equal(byPath.get("a.md"), "Judul Pertama");
    equal(byPath.get("nested/b.md"), "Judul Kedua");
  });
});

Deno.test("listLocalDocuments memakai nama file bila heading di luar 4 KB pertama", async () => {
  await withDocsRoot(async (root) => {
    // Judul dibaca dari potongan awal file saja (hemat I/O saat polling daftar).
    const filler = "x".repeat(5_000);
    await Deno.writeTextFile(join(root, "long.md"), `${filler}\n\n# Judul Jauh\n`);

    const docs = await listLocalDocuments(root);
    equal(docs.length, 1);
    equal(docs[0].title, "long");
  });
});

Deno.test("listLocalDocuments melewati non-markdown dan dotfile", async () => {
  await withDocsRoot(async (root) => {
    await Deno.writeTextFile(join(root, "doc.md"), "# Doc\n");
    await Deno.writeTextFile(join(root, "notes.txt"), "# Not markdown\n");
    await Deno.writeTextFile(join(root, ".hidden.md"), "# Hidden\n");

    const docs = await listLocalDocuments(root);
    equal(docs.map((doc) => doc.path).join(","), "doc.md");
  });
});
