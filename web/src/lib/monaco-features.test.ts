import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guard A1 (LOCAL-528B09) — audit registrasi fitur Monaco.
 *
 * `web/src/lib/monaco.ts` tidak lagi menyalin `features/register.all`: hanya
 * fitur yang benar-benar dipakai editor Lullaby yang didaftarkan. Test ini
 * menjaga tiga hal:
 *
 * 1. Fitur yang dibutuhkan editor + LSP tetap terdaftar (jangan hilang saat
 *    merapikan daftar).
 * 2. Fitur yang sudah diputuskan dibuang tidak kembali terdaftar tanpa sengaja.
 * 3. Setiap jalur impor menunjuk modul yang benar-benar ada di `monaco-editor`
 *    (salah tulis path = fitur hilang tanpa error saat build).
 */

const SOURCE = readFileSync(new URL("./monaco.ts", import.meta.url), "utf8");
const MONACO_ESM = new URL("../../node_modules/monaco-editor/esm/vs/", import.meta.url);

/** Import statis `import "…";` (bukan `import(…)` dinamis milik worker). */
const STATIC_IMPORT = /^\s*import\s+"([^"]+)";?$/gm;

const REGISTERED = [...SOURCE.matchAll(STATIC_IMPORT)].map((match) => match[1]);

/** Fitur editor yang dipakai produk — jangan dibuang (lihat komentar di monaco.ts). */
const REQUIRED_FEATURES = [
  "codicon", // ikon widget (find/suggest/peek)
  "codeEditor", // widget editor itu sendiri
  "find", // Cmd/Ctrl+F di dalam file
  "gotoError", // next/previous problem
  "gotoSymbol", // ctrl/cmd+klik definisi
  "referenceSearch", // find all references (LSP)
  "codeAction", // quick fix (LSP)
  "documentSymbols", // outline (LSP)
  "format", // format dokumen/range (LSP + JSON/CSS)
  "hover", // hover info (LSP)
  "links", // ctrl/cmd+klik URL
  "parameterHints", // signature help (LSP)
  "rename", // rename symbol (LSP)
  "snippet", // insert snippet dari completion
  "suggest", // completion widget
  "wordHighlighter", // highlight kemunculan kata
  "bracketMatching",
  "clipboard",
  "comment",
  "contextmenu",
  "cursorUndo",
  "folding",
  "inPlaceReplace",
  "indentation",
  "insertFinalNewLine",
  "linesOperations",
  "longLinesHelper",
  "multicursor",
  "readOnlyMessage",
  "wordOperations",
  "wordPartOperations",
];

/** Kontribusi yang belum punya wrapper `features/*/register` di monaco 0.57. */
const REQUIRED_CONTRIBUTIONS = [
  "monaco-editor/editor/browser/coreCommands",
  "monaco-editor/editor/common/standaloneStrings",
  "monaco-editor/editor/contrib/caretOperations/browser/caretOperations",
  "monaco-editor/editor/contrib/gotoError/browser/markerSelectionStatus",
  "monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands",
  "monaco-editor/editor/contrib/suggest/browser/suggestController",
];

/** Fitur yang diputuskan dibuang pada A1 beserta alasannya. */
const DROPPED: { id: string; reason: string }[] = [
  { id: "codelens", reason: "tidak ada provider codeLens (capability LSP tidak memintanya)" },
  { id: "linkedEditing", reason: "tidak ada provider linkedEditingRange" },
  { id: "semanticTokens", reason: "LSP tidak meminta semanticTokens; tsMode tanpa provider" },
  { id: "stickyScroll", reason: "opsi stickyScroll.enabled tidak pernah dinyalakan" },
  { id: "colorPicker", reason: "swatch warna CSS — trade-off diterima" },
  { id: "inlayHints", reason: "hint nama parameter TypeScript — trade-off diterima" },
  { id: "smartSelect", reason: "expand/shrink selection tidak dipakai UI" },
  { id: "unicodeHighlighter", reason: "hanya banner peringatan" },
  { id: "unusualLineTerminators", reason: "hanya prompt" },
  { id: "dropOrPasteInto", reason: "menu paste-as; paste biasa tetap lewat clipboard" },
  { id: "documentSemanticTokens", reason: "pendamping semanticTokens (lihat di atas)" },
  { id: "copyPasteContribution", reason: "pendamping dropOrPasteInto (lihat di atas)" },
];

function matchesSegment(specifier: string, id: string): boolean {
  return new RegExp(`(^|/)${id}($|/)`).test(specifier);
}

describe("A1: audit registrasi fitur Monaco", () => {
  it("mendaftarkan seluruh fitur yang dipakai produk", () => {
    const missing = REQUIRED_FEATURES.filter(
      (feature) => !REGISTERED.includes(`monaco-editor/features/${feature}/register`),
    );
    expect(missing).toEqual([]);
  });

  it("mempertahankan kontribusi yang dibutuhkan LSP dan editing inti", () => {
    const missing = REQUIRED_CONTRIBUTIONS.filter((specifier) => !REGISTERED.includes(specifier));
    expect(missing).toEqual([]);
  });

  it("tidak mendaftarkan lagi fitur yang sudah dibuang", () => {
    const offenders = DROPPED.filter(({ id }) => REGISTERED.some((spec) => matchesSegment(spec, id)))
      .map(({ id, reason }) => `${id} (${reason})`);
    expect(offenders).toEqual([]);
  });

  it("tidak kembali menyalin features/register.all", () => {
    expect(REGISTERED.filter((specifier) => specifier.includes("register.all"))).toEqual([]);
  });

  it("setiap jalur impor menunjuk modul yang ada di monaco-editor", () => {
    // `node_modules` belum terpasang (checkout bersih) → tidak ada yang bisa dicek.
    if (!existsSync(MONACO_ESM)) return;

    const broken = REGISTERED.map((specifier) => specifier.replace(/^monaco-editor\//, "")).filter(
      (relative) => !existsSync(new URL(`${relative}.js`, MONACO_ESM)),
    );
    expect(broken).toEqual([]);
  });
});
