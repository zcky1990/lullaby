import { loader } from "@monaco-editor/react";
// PERF-2: impor inti editor saja. `import * as monaco from "monaco-editor"`
// menarik ~90 modul bahasa + `esm/external/monaco-lsp-client` (±140 KB) ke
// bundle. Daftar bahasa yang dipakai ada di `./monaco-languages`.
import * as monaco from "monaco-editor/editor/editor.api";
import { isMonacoTypeScriptServiceEnabled } from "./monaco-settings";

// ---------------------------------------------------------------------------
// Kontribusi editor (find, suggest, hover, peek, dst).
// `editor.api` hanya berisi API; fitur UI harus didaftarkan satu per satu.
// Modul bahasa tidak diimpor di sini — lihat blok "definisi bahasa" di bawah.
//
// A1 (LOCAL-528B09) — daftar ini hasil audit pemakaian produk, bukan salinan
// `features/register.all`. Yang **sengaja tidak** didaftarkan:
//   codelens · linkedEditing · semanticTokens
//       → tidak ada provider: `lib/lsp.ts` tidak meminta
//         codeLens/linkedEditingRange/semanticTokens, dan `tsMode` tidak
//         mendaftarkan provider semantic token.
//   stickyScroll      → opsi `stickyScroll.enabled` tidak pernah dinyalakan.
//   colorPicker       → swatch/picker warna CSS (trade-off diterima: token
//                       warna tetap disorot, hanya UI picker yang hilang).
//   inlayHints        → hint nama parameter TypeScript.
//   smartSelect       → expand/shrink selection.
//   unicodeHighlighter · unusualLineTerminators → hanya banner/prompt.
//   dropOrPasteInto   → menu "paste as"/preview drop; Cmd+V biasa tetap
//                       ditangani `clipboard`.
// Guard: `web/src/lib/monaco-features.test.ts`.
// ---------------------------------------------------------------------------
import "monaco-editor/features/codicon/register"; // font codicon (ikon widget)
import "monaco-editor/features/codeEditor/register"; // code editor widget
// Navigasi & pencarian
import "monaco-editor/features/find/register";
import "monaco-editor/features/gotoError/register";
import "monaco-editor/features/gotoSymbol/register";
import "monaco-editor/features/referenceSearch/register";
// IntelliSense dari language server
import "monaco-editor/features/codeAction/register";
import "monaco-editor/features/documentSymbols/register";
import "monaco-editor/features/format/register";
import "monaco-editor/features/hover/register";
import "monaco-editor/features/links/register";
import "monaco-editor/features/parameterHints/register";
import "monaco-editor/features/rename/register";
import "monaco-editor/features/snippet/register";
import "monaco-editor/features/suggest/register";
import "monaco-editor/features/wordHighlighter/register";
// Editing
import "monaco-editor/features/bracketMatching/register";
import "monaco-editor/features/clipboard/register";
import "monaco-editor/features/comment/register";
import "monaco-editor/features/contextmenu/register";
import "monaco-editor/features/cursorUndo/register";
import "monaco-editor/features/folding/register";
import "monaco-editor/features/inPlaceReplace/register";
import "monaco-editor/features/indentation/register";
import "monaco-editor/features/insertFinalNewLine/register";
import "monaco-editor/features/linesOperations/register";
import "monaco-editor/features/longLinesHelper/register";
import "monaco-editor/features/multicursor/register";
import "monaco-editor/features/readOnlyMessage/register";
import "monaco-editor/features/wordOperations/register";
import "monaco-editor/features/wordPartOperations/register";

// Kontribusi yang belum punya wrapper `features/*/register` di monaco 0.57.
import "monaco-editor/editor/browser/coreCommands";
import "monaco-editor/editor/common/standaloneStrings";
import "monaco-editor/editor/contrib/caretOperations/browser/caretOperations";
import "monaco-editor/editor/contrib/gotoError/browser/markerSelectionStatus";
import "monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands";
import "monaco-editor/editor/contrib/suggest/browser/suggestController";

// ---------------------------------------------------------------------------
// Layanan bahasa bawaan Monaco (diagnostics/format CSS, HTML, JSON).
// TypeScript/JavaScript sengaja **tidak** di sini: lihat `ensureMonacoReady()`
// (PERF-3) supaya `tsMode` + `ts.worker` hanya dimuat bila opsi editor aktif.
// ---------------------------------------------------------------------------
import "monaco-editor/languages/features/css/register";
import "monaco-editor/languages/features/html/register";
import "monaco-editor/languages/features/json/register";

// ---------------------------------------------------------------------------
// Definisi (tokenizer) hanya untuk id di `MONACO_LANGUAGE_IDS`.
// Menambah bahasa = tambah id di `./monaco-languages` + satu baris di sini.
// `json` disediakan oleh `languages/features/json` dan `plaintext` bawaan
// editor, jadi keduanya tidak punya baris di sini.
// ---------------------------------------------------------------------------
import "monaco-editor/languages/definitions/typescript/register";
import "monaco-editor/languages/definitions/javascript/register";
import "monaco-editor/languages/definitions/css/register";
import "monaco-editor/languages/definitions/scss/register";
import "monaco-editor/languages/definitions/less/register";
import "monaco-editor/languages/definitions/html/register";
import "monaco-editor/languages/definitions/markdown/register";
import "monaco-editor/languages/definitions/yaml/register";
import "monaco-editor/languages/definitions/python/register";
import "monaco-editor/languages/definitions/ruby/register";
import "monaco-editor/languages/definitions/go/register";
import "monaco-editor/languages/definitions/rust/register";
import "monaco-editor/languages/definitions/java/register";
import "monaco-editor/languages/definitions/kotlin/register";
import "monaco-editor/languages/definitions/cpp/register"; // mendaftarkan "c" + "cpp"
import "monaco-editor/languages/definitions/csharp/register";
import "monaco-editor/languages/definitions/php/register";
import "monaco-editor/languages/definitions/shell/register";
import "monaco-editor/languages/definitions/sql/register";
import "monaco-editor/languages/definitions/lua/register";
import "monaco-editor/languages/definitions/xml/register";
import "monaco-editor/languages/definitions/ini/register";
import "monaco-editor/languages/definitions/dockerfile/register";

// ---------------------------------------------------------------------------
// PERF-3 — worker dimuat sesuai kebutuhan.
//
// Dulu kelima worker diimpor statis (`import tsWorker from "…?worker"`),
// sehingga wrapper-nya ikut ke chunk editor dan `ts.worker` (±7 MB) selalu
// terdaftar walau proyek hanya berisi Markdown. `getWorker` boleh
// mengembalikan Promise, jadi tiap worker kini di-`import()` saat bahasa itu
// benar-benar dipakai dan hasilnya di-memoize per jenis.
// ---------------------------------------------------------------------------
type WorkerConstructor = new () => Worker;

/** Modul `?worker` milik Vite: default export = konstruktor Worker (chunk lazy). */
const WORKER_LOADERS = {
  editor: async () => (await import("monaco-editor/editor/editor.worker?worker")).default,
  json: async () => (await import("monaco-editor/language/json/json.worker?worker")).default,
  css: async () => (await import("monaco-editor/language/css/css.worker?worker")).default,
  html: async () => (await import("monaco-editor/language/html/html.worker?worker")).default,
  typescript: async () =>
    (await import("monaco-editor/language/typescript/ts.worker?worker")).default,
} satisfies Record<string, () => Promise<WorkerConstructor>>;

type WorkerKind = keyof typeof WORKER_LOADERS;

function workerKindOf(label: string): WorkerKind {
  switch (label) {
    case "json":
      return "json";
    case "css":
    case "scss":
    case "less":
      return "css";
    case "html":
    case "handlebars":
    case "razor":
      return "html";
    case "typescript":
    case "javascript":
      // Tanpa layanan TypeScript, protokol TS tidak pernah dipakai, jadi
      // jangan pernah mengunduh ts.worker.
      return isMonacoTypeScriptServiceEnabled() ? "typescript" : "editor";
    default:
      return "editor";
  }
}

const workerConstructors = new Map<WorkerKind, Promise<WorkerConstructor>>();

function workerConstructorOf(kind: WorkerKind): Promise<WorkerConstructor> {
  const cached = workerConstructors.get(kind);
  if (cached) return cached;
  const loading = WORKER_LOADERS[kind]().catch((error: unknown) => {
    // Jangan menyimpan kegagalan impor: percobaan berikutnya boleh mengulang.
    workerConstructors.delete(kind);
    throw error;
  });
  workerConstructors.set(kind, loading);
  return loading;
}

async function createWorker(label: string): Promise<Worker> {
  const WorkerConstructor = await workerConstructorOf(workerKindOf(label));
  return new WorkerConstructor();
}

interface MonacoWorkerEnvironment {
  getWorker: (workerId: string, label: string) => Worker | Promise<Worker>;
}

(self as unknown as { MonacoEnvironment: MonacoWorkerEnvironment }).MonacoEnvironment = {
  getWorker: (_workerId: string, label: string) => createWorker(label),
};

let typeScriptFeature: Promise<void> | null = null;

/**
 * PERF-3 — daftarkan layanan TypeScript bawaan Monaco bila opsi editor aktif.
 *
 * `languages/features/typescript/register` mendaftarkan **service** (IntelliSense,
 * diagnostics, rename) — bukan tokenizer-nya, yang tetap datang dari
 * `languages/definitions/typescript`. Tanpa modul ini `tsMode` tidak pernah
 * dimuat dan `ts.worker` tidak pernah di-fetch; highlighting tetap jalan, dan
 * IntelliSense tetap tersedia lewat language server (LSP) bila diaktifkan.
 *
 * Panggil (dan tunggu) sebelum editor pertama di-mount, karena model yang
 * dibuat sebelum fitur terdaftar tidak akan mendapat layanan ini.
 */
export function ensureMonacoReady(): Promise<void> {
  if (!isMonacoTypeScriptServiceEnabled()) return Promise.resolve();
  typeScriptFeature ??= import("monaco-editor/languages/features/typescript/register").then(
    () => undefined,
  );
  return typeScriptFeature;
}

loader.config({ monaco });
