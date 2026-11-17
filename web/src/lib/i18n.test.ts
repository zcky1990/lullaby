import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { messages } from "@/lib/i18n/messages";
import { interpolate } from "@/lib/i18n/translate";

/**
 * Guard i18n:
 * - setiap bahasa harus punya set key yang sama (tidak ada terjemahan hilang),
 * - setiap `t("…")` di komponen harus punya entri kamus.
 *
 * Kalau menambah teks UI: tambahkan key ke `messages/id/<domain>.ts` DAN
 * `messages/en/<domain>.ts`, lalu pakai `t("key")` di komponen.
 */
const SRC_DIR = fileURLToPath(new URL("../", import.meta.url));
const I18N_DIR = join(SRC_DIR, "lib", "i18n");
const USAGE_PATTERN = /\bt\(\s*"([^"${}]+)"/g;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (path === I18N_DIR || name === "docs") continue;
      sources(path, out);
      continue;
    }
    if (name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

function usedKeys(): Map<string, string> {
  const used = new Map<string, string>();
  for (const path of sources(SRC_DIR)) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(USAGE_PATTERN)) {
      const key = match[1];
      if (!used.has(key)) used.set(key, path.slice(SRC_DIR.length));
    }
  }
  return used;
}

describe("kamus i18n", () => {
  it("punya set key yang sama untuk id dan en", () => {
    const idKeys = Object.keys(messages.id).sort();
    const enKeys = Object.keys(messages.en).sort();
    expect(idKeys.filter((key) => !enKeys.includes(key))).toEqual([]);
    expect(enKeys.filter((key) => !idKeys.includes(key))).toEqual([]);
  });

  it("tidak menyimpan teks kosong", () => {
    const empty = Object.entries(messages).flatMap(([locale, dict]) =>
      Object.entries(dict)
        .filter(([, value]) => !value.trim())
        .map(([key]) => `${locale}:${key}`)
    );
    expect(empty).toEqual([]);
  });

  it("setiap t() di komponen punya entri di kedua bahasa", () => {
    const missing = [...usedKeys().entries()]
      .filter(([key]) => !messages.id[key] || !messages.en[key])
      .map(([key, file]) => `${key} (${file})`);
    expect(missing).toEqual([]);
  });
});

describe("interpolate", () => {
  it("mengganti placeholder dan membiarkan yang tidak dikenal", () => {
    expect(interpolate("{count} tiket", { count: 3 })).toBe("3 tiket");
    expect(interpolate("{a}/{b}", { a: "x" })).toBe("x/{b}");
    expect(interpolate("tanpa placeholder")).toBe("tanpa placeholder");
  });
});
