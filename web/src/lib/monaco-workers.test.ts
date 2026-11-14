import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isMonacoTypeScriptServiceEnabled,
  setMonacoTypeScriptServiceEnabled,
  subscribeMonacoSettings,
} from "./monaco-settings";

/**
 * Guard PERF-3.
 *
 * Dulu kelima worker editor diimpor statis (`import tsWorker from "…?worker"`)
 * sehingga `ts.worker` (±7 MB) selalu terdaftar dan `tsMode` selalu ikut
 * bundle, walau proyek hanya berisi Markdown. Sekarang:
 *
 * 1. Worker hanya dimuat lewat `import("…?worker")` di dalam `getWorker`.
 * 2. Layanan TypeScript didaftarkan kondisional via `ensureMonacoReady()`.
 */
const SOURCE = readFileSync(new URL("./monaco.ts", import.meta.url), "utf8");

const EXPECTED_WORKERS = [
  "monaco-editor/editor/editor.worker?worker",
  "monaco-editor/language/json/json.worker?worker",
  "monaco-editor/language/css/css.worker?worker",
  "monaco-editor/language/html/html.worker?worker",
  "monaco-editor/language/typescript/ts.worker?worker",
];

const STATIC_TYPE_SCRIPT_FEATURE =
  /^\s*import\s+"monaco-editor\/languages\/features\/typescript\/register"/m;

describe("worker editor Monaco", () => {
  it("tidak mengimpor modul ?worker secara statis", () => {
    const offenders = SOURCE.split("\n")
      .filter((line) => line.includes("?worker"))
      .filter((line) => /^\s*import\b(?!\s*\()/.test(line));
    expect(offenders).toEqual([]);
  });

  it("memuat setiap worker lewat dynamic import", () => {
    const loaded = [...SOURCE.matchAll(/import\("([^"]*\?worker)"\)/g)].map((match) => match[1]);
    expect(loaded).toEqual(EXPECTED_WORKERS);
  });

  it("mengizinkan getWorker mengembalikan Promise", () => {
    expect(SOURCE).toContain("Worker | Promise<Worker>");
  });

  it("mendaftarkan layanan TypeScript hanya lewat ensureMonacoReady", () => {
    expect(STATIC_TYPE_SCRIPT_FEATURE.test(SOURCE)).toBe(false);
    expect(SOURCE).toContain('import("monaco-editor/languages/features/typescript/register")');
    expect(SOURCE).toContain("export function ensureMonacoReady");
  });
});

describe("preferensi TypeScript service", () => {
  it("default aktif dan bisa dimatikan lewat localStorage", () => {
    localStorage.clear();
    expect(isMonacoTypeScriptServiceEnabled()).toBe(true);

    setMonacoTypeScriptServiceEnabled(false);
    expect(isMonacoTypeScriptServiceEnabled()).toBe(false);

    setMonacoTypeScriptServiceEnabled(true);
    expect(isMonacoTypeScriptServiceEnabled()).toBe(true);
    localStorage.clear();
  });

  it("memberi tahu subscriber saat nilai berubah", () => {
    localStorage.clear();
    let calls = 0;
    const unsubscribe = subscribeMonacoSettings(() => {
      calls += 1;
    });

    setMonacoTypeScriptServiceEnabled(false);
    setMonacoTypeScriptServiceEnabled(false); // nilai sama → tidak ada notifikasi
    unsubscribe();
    setMonacoTypeScriptServiceEnabled(true);

    expect(calls).toBe(1);
    localStorage.clear();
  });
});
