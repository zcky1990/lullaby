import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LANGUAGE_BY_EXTENSION,
  LANGUAGE_IDS_WITHOUT_DEFINITION,
  MONACO_LANGUAGE_IDS,
  languageForPath,
} from "./monaco-languages";

/**
 * Guard PERF-2.
 *
 * `web/src/lib/monaco.ts` pernah memakai `import * as monaco from "monaco-editor"`
 * sehingga ~90 modul bahasa (abap, apex, azcli, solidity, …) ikut ke
 * `web/dist/assets` padahal `languages.ts` hanya memakai ~25 id. Test ini
 * menjaga tiga hal:
 *
 * 1. Editor diimpor dari inti (`editor/editor.api`), bukan paket penuh.
 * 2. Setiap id di `LANGUAGE_BY_EXTENSION` ikut terdaftar di `MONACO_LANGUAGE_IDS`.
 * 3. Setiap id di `MONACO_LANGUAGE_IDS` benar-benar punya import registrasi.
 */

const LIB_DIR = new URL("./", import.meta.url); // web/src/lib/
const SRC_DIR = new URL("../", import.meta.url); // web/src/

function readLib(file: string): string {
  return readFileSync(new URL(file, LIB_DIR), "utf8");
}

function readSrc(file: string): string {
  return readFileSync(new URL(file, SRC_DIR), "utf8");
}

/** Import nilai (bukan `import type`) dari paket `monaco-editor` penuh. */
function valueImportsOfFullMonaco(source: string): string[] {
  const offenders: string[] = [];
  for (const match of source.matchAll(/from\s+["']monaco-editor["']/g)) {
    const start = source.lastIndexOf("import", match.index);
    if (start < 0) continue;
    const clause = source.slice(start + "import".length, match.index).trim();
    if (!clause.startsWith("type ")) offenders.push(clause.replaceAll(/\s+/g, " "));
  }
  return offenders;
}

function sourceFiles(): string[] {
  return readdirSync(SRC_DIR, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx"))
    .map((entry) => entry.replaceAll("\\", "/"));
}

/** Id → folder definisi di `monaco-editor` (cpp mendaftarkan "c" + "cpp"). */
const DEFINITION_FOLDER_BY_ID: Record<string, string> = { c: "cpp" };

describe("registrasi bahasa Monaco", () => {
  it("mengimpor inti editor, bukan paket monaco-editor penuh", () => {
    const source = readLib("monaco.ts");
    expect(valueImportsOfFullMonaco(source)).toEqual([]);
    expect(source).toContain('"monaco-editor/editor/editor.api"');
  });

  it("tidak ada modul lain yang mengimpor paket monaco-editor penuh", () => {
    const offenders = sourceFiles().filter(
      (file) => file !== "lib/monaco.ts" && valueImportsOfFullMonaco(readSrc(file)).length > 0,
    );
    expect(offenders).toEqual([]);
  });

  it("setiap id di LANGUAGE_BY_EXTENSION ikut terdaftar", () => {
    const known = new Set<string>([
      ...MONACO_LANGUAGE_IDS,
      ...LANGUAGE_IDS_WITHOUT_DEFINITION,
    ]);
    const missing = [...new Set(Object.values(LANGUAGE_BY_EXTENSION))].filter(
      (id) => !known.has(id),
    );
    expect(missing).toEqual([]);
  });

  it("setiap id terdaftar punya import registrasi di monaco.ts", () => {
    const source = readLib("monaco.ts");
    const missing = MONACO_LANGUAGE_IDS.filter((id) => {
      if (id === "plaintext") return false; // bawaan editor, tanpa registrasi
      const folder = DEFINITION_FOLDER_BY_ID[id] ?? id;
      const pattern = `"monaco-editor/languages/(definitions|features)/${folder}/register"`;
      return !new RegExp(pattern).test(source);
    });
    expect(missing).toEqual([]);
  });

  it("memetakan path ke id bahasa", () => {
    expect(languageForPath("src/app.tsx")).toBe("typescript");
    expect(languageForPath("deep/nested/file.py")).toBe("python");
    expect(languageForPath("Dockerfile")).toBe("dockerfile");
    expect(languageForPath("Makefile")).toBe("makefile");
    expect(languageForPath("catatan.md")).toBe("markdown");
    expect(languageForPath("berkas.tidak-dikenal")).toBe("plaintext");
    expect(languageForPath("tanpa-ekstensi")).toBe("plaintext");
  });
});
