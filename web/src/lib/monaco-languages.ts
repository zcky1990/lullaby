/**
 * Satu sumber kebenaran pemetaan path → id bahasa Monaco.
 *
 * Modul ini **tidak boleh** mengimpor `monaco-editor` (baik nilai maupun efek
 * samping): `@/lib/languages` dipakai di shell aplikasi dan test, jadi harus
 * tetap ringan. Registrasi tokenizer-nya ada di `@/lib/monaco`.
 *
 * PERF-2: `@/lib/monaco` hanya mendaftarkan id di `MONACO_LANGUAGE_IDS`.
 * Sebelumnya `import * as monaco from "monaco-editor"` membawa ~90 modul bahasa
 * (abap, apex, azcli, solidity, …) ke `web/dist/assets`. `monaco-languages.test.ts`
 * menjaga peta ekstensi, daftar id, dan import registrasi tidak drift lagi.
 */

/** Id bahasa bawaan Monaco untuk file tanpa pemetaan (tidak perlu registrasi). */
export const PLAINTEXT_LANGUAGE = "plaintext";

/** Ekstensi (dan nama file khusus) → id bahasa Monaco. */
export const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sql: "sql",
  lua: "lua",
  xml: "xml",
  toml: "ini",
  ini: "ini",
  dockerfile: "dockerfile",
  env: "ini",
};

/**
 * Id yang dipakai `languageForPath` tetapi **tidak** punya definisi bahasa di
 * `monaco-editor` 0.57 (tidak ada `languages/definitions/makefile`).
 *
 * Id-nya tetap dipertahankan karena juga dipakai sebagai `languageId` LSP
 * (`lib/lsp.ts`), sementara Monaco merendernya sebagai plaintext.
 */
export const LANGUAGE_IDS_WITHOUT_DEFINITION = ["makefile"] as const;

/**
 * Id bahasa yang benar-benar di-bundle. Urutan mengikuti blok import di
 * `@/lib/monaco`; setiap id di sini wajib punya import registrasi di sana
 * (dijaga oleh `monaco-languages.test.ts`).
 */
export const MONACO_LANGUAGE_IDS = [
  "typescript",
  "javascript",
  "json",
  "css",
  "scss",
  "less",
  "html",
  "markdown",
  "yaml",
  "python",
  "ruby",
  "go",
  "rust",
  "java",
  "kotlin",
  "c",
  "cpp",
  "csharp",
  "php",
  "shell",
  "sql",
  "lua",
  "xml",
  "ini",
  "dockerfile",
  PLAINTEXT_LANGUAGE,
] as const;

/** Id bahasa Monaco yang didukung editor (lihat `MONACO_LANGUAGE_IDS`). */
export type MonacoLanguageId = (typeof MONACO_LANGUAGE_IDS)[number];

export function languageForPath(path: string): string {
  const name = path.split("/").pop() ?? path;
  if (name === "Dockerfile") return "dockerfile";
  if (name === "Makefile") return "makefile";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return LANGUAGE_BY_EXTENSION[ext] ?? PLAINTEXT_LANGUAGE;
}
