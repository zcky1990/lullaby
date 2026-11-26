/**
 * Codemod REL-1 lanjutan (LOCAL-E4113D): migrasi `App.tsx` ke
 * `useEventSubscription` + hapus bridge `EventSource`.
 *
 * Kenapa memakai script, bukan edit langsung?
 * `read_file` memotong berkas > ±50.000 karakter, sedangkan `write_file`
 * menimpa seluruh isi berkas. `web/src/App.tsx` ±69 KB sehingga ekornya
 * (`DocumentTab`, `TicketTab`, `SettingsTab`) tidak pernah terbaca utuh dari
 * chat; menulis ulang berkas dari chat akan menghapus komponen tersebut.
 * Script ini membaca/menulis berkas secara utuh di runtime (tanpa batas tool)
 * dan hanya melakukan penggantian teks terverifikasi, jadi ekor berkas dijamin
 * utuh.
 *
 * Yang diubah:
 *   1. `web/src/App.tsx` — impor `useEventSubscription` disisipkan setelah blok
 *      import terakhir, dan effect feed activity yang memanggil
 *      `new EventSource("/api/events")` + `JSON.parse` sendiri diganti
 *      `useEventSubscription("*", ...)`.
 *   2. `web/src/main.tsx` — `installSharedEventSourceBridge()` dihapus (tidak
 *      ada lagi konsumen legacy yang perlu dialihkan).
 *   3. `web/src/lib/events-stream.ts` — lapisan kompatibilitas dihapus:
 *      `SharedEventSource`, `installSharedEventSourceBridge`,
 *      `createMessageEvent`, `attachLegacyClient`, `LegacyStreamMessage`,
 *      `emitLegacy`. Hub tetap satu-satunya pemilik `new EventSource`.
 *   4. `web/src/lib/events-stream.test.ts` — test bridge dihapus, test hub
 *      disesuaikan (tanpa klien legacy).
 *   5. `web/src/lib/events-provider.test.ts` — guard REL-1 diperbarui:
 *      `App.tsx` tidak boleh lagi memuat `new EventSource(`, dan satu-satunya
 *      `new EventSource(` tetap di `events-stream.ts`.
 *
 * Keamanan:
 *   - setiap rule menyatakan jumlah kemunculan yang diharapkan (`expect`,
 *     default 1); kalau berbeda, target DIBATALKAN (tidak menebak),
 *   - `App.tsx` tidak dibaca dari chat, jadi dua rule-nya sengaja tidak
 *     bergantung pada teks yang ditebak: impor disisipkan relatif terhadap blok
 *     import terakhir, dan effect punya fallback regex (`alt`) yang tetap
 *     mensyaratkan `const source = new EventSource("/api/events");`,
 *   - rule yang tidak menemukan teksnya dilaporkan sebagai info (bukan fatal)
 *     supaya aman dijalankan ulang; kebenaran hasil dijaga guard di bawah,
 *   - `mustInclude` / `mustExclude` / `patterns` memeriksa hasil transformasi
 *     (ekor App.tsx wajib utuh, simbol yang dihapus tidak boleh tersisa,
 *     `new EventSource(` cuma boleh ada sekali di `events-stream.ts`),
 *   - penulisan atomik (`*.rel1.tmp` → rename),
 *   - di akhir, hasil transformasi seluruh `web/src` dipindai untuk memastikan
 *     tidak ada referensi ke simbol yang dihapus,
 *   - default = dry-run, tidak menyentuh berkas.
 *
 * Pemakaian:
 *   deno task rel1:codemod            # dry-run + laporan
 *   deno task rel1:codemod --write    # terapkan
 *
 * Setelah `--write`:
 *   npm --prefix web run test && npm --prefix web run typecheck
 */

interface Rule {
  /** Nama rule untuk laporan. */
  label: string;
  /** Potongan teks sumber yang harus ada (persis). */
  find?: string;
  /** Alternatif: regex. Flag `g` ditambahkan otomatis saat menghitung. */
  re?: RegExp;
  /**
   * Fallback yang dipakai hanya bila `find` tidak ditemukan (mis. indentasi
   * atau spasi berbeda). Dipakai supaya rule tetap ketat tapi tidak rapuh.
   */
  alt?: RegExp;
  /** Pengganti; untuk regex boleh memakai `$1`, `$2`, … */
  replace: string;
  /** Jumlah kemunculan yang diharapkan. Default 1. */
  expect?: number;
  /** Kalau berkas sudah memuat penanda ini, rule dianggap sudah diterapkan. */
  skipIf?: string;
}

interface ImportRule {
  label: string;
  /** Baris import yang disisipkan setelah blok import terakhir. */
  snippet: string;
  /** Kalau berkas sudah memuat penanda ini, rule dianggap sudah diterapkan. */
  skipIf: string;
}

interface Pattern {
  re: RegExp;
  count: number;
  note: string;
}

interface Target {
  label: string;
  url: URL;
  importRules?: ImportRule[];
  rules: Rule[];
  /** Wajib ada setelah transformasi (mis. anchor ekor App.tsx). */
  mustInclude: string[];
  /** Wajib hilang setelah transformasi. */
  mustExclude: string[];
  patterns?: Pattern[];
}

interface ApplyReport {
  applied: number;
  skipped: number;
  missing: number;
  problems: string[];
}

// --- App.tsx ---------------------------------------------------------------

const APP_IMPORT_RULE: ImportRule = {
  label: "impor useEventSubscription",
  snippet: 'import { useEventSubscription } from "@/lib/events-provider";',
  skipIf: '"@/lib/events-provider"',
};

const APP_EFFECT_FIND = `  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as ActivityEvent;
        if (event.type.startsWith("workflow.step.") || event.type === "chat.step") return;
        setActivity((current) => [event, ...current].slice(0, 50));
      } catch {
        // ignore malformed events
      }
    };
    return () => source.close();
  }, []);`;

/** Fallback: effect yang sama walau isi/indentasi internalnya sedikit beda. */
const APP_EFFECT_ALT =
  / {2}useEffect\(\(\) => \{\n {4}const source = new EventSource\("\/api\/events"\);\n[\s\S]*?\n {2}\}, \[\]\);/;

const APP_EFFECT_REPLACE = `  useEventSubscription("*", (event) => {
    if (event.type === "hello") return;
    if (event.type.startsWith("workflow.step.") || event.type === "chat.step") return;
    setActivity((current) => [event as unknown as ActivityEvent, ...current].slice(0, 50));
  });`;

const APP_RULES: Rule[] = [
  {
    label: "effect EventSource -> useEventSubscription",
    find: APP_EFFECT_FIND,
    alt: APP_EFFECT_ALT,
    replace: APP_EFFECT_REPLACE,
    skipIf: 'useEventSubscription("*"',
  },
];

// --- main.tsx --------------------------------------------------------------

const MAIN_BRIDGE_CALL = "// REL-1: satu koneksi `GET /api/events` untuk seluruh aplikasi. Bridge dipasang\n" +
  "// sebelum render supaya `new EventSource(\"/api/events\")` milik konsumen lama\n" +
  "// menempel ke hub (tidak membuka socket kedua).\n" +
  "installSharedEventSourceBridge();\n\n";

const MAIN_RULES: Rule[] = [
  {
    label: "impor installSharedEventSourceBridge dihapus",
    find: 'import { installSharedEventSourceBridge } from "@/lib/events-stream";\n',
    replace: "",
  },
  {
    label: "panggilan installSharedEventSourceBridge dihapus",
    find: MAIN_BRIDGE_CALL,
    replace: "",
  },
];

// --- events-stream.ts ------------------------------------------------------

const STREAM_HEADER_FIND =
  " * `installSharedEventSourceBridge()` menyediakan masa transisi untuk konsumen\n" +
  " * yang masih memanggil `new EventSource(EVENTS_URL)` langsung: panggilan itu\n" +
  " * tidak membuka socket baru, tapi menempel ke hub yang sama.";

const STREAM_HEADER_REPLACE =
  " * Konsumen (`App`, `ChatSidebar`) berlangganan lewat `useEventSubscription`\n" +
  " * di `events-provider.tsx`, jadi tidak ada modul UI yang membuat `EventSource`\n" +
  " * sendiri.";

const STREAM_LEGACY_MESSAGE = `/** Pesan mentah yang dikirim ke klien legacy (masih mem-parse sendiri). */
export type LegacyStreamMessage =
  | { type: "open" }
  | { type: "message"; data: string }
  | { type: "error" };

`;

const STREAM_ATTACH_FIND = `  /**
   * Tempelkan klien yang masih memakai API \`EventSource\` langsung ke hub ini.
   * Mengembalikan fungsi detach (idempoten).
   */
  attachLegacyClient(client: (message: LegacyStreamMessage) => void): () => void {
    this.legacyClients.add(client);
    this.acquire();
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      this.legacyClients.delete(client);
      this.release();
    };
  }

`;

const STREAM_EMIT_FIND = `  private emitLegacy(message: LegacyStreamMessage): void {
    for (const client of [...this.legacyClients]) {
      try {
        client(message);
      } catch (error) {
        console.error("[events] klien legacy gagal", error);
      }
    }
  }

`;

const STREAM_RULES: Rule[] = [
  {
    label: "doc header: bridge dihapus",
    find: STREAM_HEADER_FIND,
    replace: STREAM_HEADER_REPLACE,
    skipIf: "`useEventSubscription`",
  },
  {
    label: "tipe LegacyStreamMessage dihapus",
    find: STREAM_LEGACY_MESSAGE,
    replace: "",
  },
  {
    label: "field legacyClients dihapus",
    find: "  private readonly legacyClients = new Set<(message: LegacyStreamMessage) => void>();\n",
    replace: "",
  },
  {
    label: "method attachLegacyClient dihapus",
    find: STREAM_ATTACH_FIND,
    replace: "",
  },
  {
    label: "emitLegacy({ open }) dihapus",
    find: '      this.emitLegacy({ type: "open" });\n',
    replace: "",
  },
  {
    label: "emitLegacy({ message }) dihapus",
    find: '    this.emitLegacy({ type: "message", data: raw });\n',
    replace: "",
  },
  {
    label: "emitLegacy({ error }) dihapus",
    find: '    this.emitLegacy({ type: "error" });\n',
    replace: "",
  },
  {
    label: "method emitLegacy dihapus",
    find: STREAM_EMIT_FIND,
    replace: "",
  },
  {
    label: "komentar consumers diperbarui",
    find: "  /** Berapa konsumen yang sedang memakai hub (provider + klien legacy). */",
    replace: "  /** Berapa konsumen yang sedang memakai hub (provider). */",
    skipIf: "  /** Berapa konsumen yang sedang memakai hub (provider). */",
  },
  {
    label: "bridge di akhir berkas dihapus",
    // Non-global: penggantian memakai regex apa adanya (ganti kemunculan
    // pertama = potong sampai akhir berkas).
    re: /\nfunction createMessageEvent\(data: string\): MessageEvent \{[\s\S]*$/,
    replace: "",
  },
];

// --- events-stream.test.ts -------------------------------------------------

const TEST_IMPORT_FIND = `import {
  EventStreamHub,
  installSharedEventSourceBridge,
  type EventStreamHubOptions,
} from "./events-stream";`;

const TEST_IMPORT_REPLACE =
  `import { EventStreamHub, type EventStreamHubOptions } from "./events-stream";`;

const TEST_ACQUIRE_FIND = `    hub.acquire();
    hub.acquire();
    const detach = hub.attachLegacyClient(() => {});
    detach();

`;

const TEST_ACQUIRE_REPLACE = `    hub.acquire();
    hub.acquire();

`;

const TEST_PARSE_FIND = `  it("mem-parse event sekali untuk registry dan meneruskan data mentah ke klien legacy", () => {
    const { hub, sources } = createHarness();
    const received: StreamEvent[] = [];
    const legacy: string[] = [];
    hub.registry.subscribe("chat.step", (event) => received.push(event));
    hub.attachLegacyClient((message) => {
      if (message.type === "message") legacy.push(message.data);
    });

    const payload = JSON.stringify({ type: "chat.step", payload: { id: "step-1" } });
    sources[0].message(payload);
    sources[0].message("bukan json");

    expect(received).toEqual([{ type: "chat.step", payload: { id: "step-1" } }]);
    expect(legacy).toEqual([payload, "bukan json"]);
  });`;

const TEST_PARSE_REPLACE = `  it("mem-parse event sekali lalu meneruskannya ke registry", () => {
    const { hub, sources } = createHarness();
    const received: StreamEvent[] = [];
    hub.registry.subscribe("chat.step", (event) => received.push(event));
    hub.acquire();

    sources[0].message(JSON.stringify({ type: "chat.step", payload: { id: "step-1" } }));
    sources[0].message("bukan json");

    expect(received).toEqual([{ type: "chat.step", payload: { id: "step-1" } }]);
  });`;

const TEST_RULES: Rule[] = [
  {
    label: "impor installSharedEventSourceBridge dihapus",
    find: TEST_IMPORT_FIND,
    replace: TEST_IMPORT_REPLACE,
    skipIf: 'import { EventStreamHub, type EventStreamHubOptions } from "./events-stream";',
  },
  {
    label: "test satu koneksi tanpa klien legacy",
    find: TEST_ACQUIRE_FIND,
    replace: TEST_ACQUIRE_REPLACE,
  },
  {
    label: "test parse tanpa klien legacy",
    find: TEST_PARSE_FIND,
    replace: TEST_PARSE_REPLACE,
    skipIf: 'it("mem-parse event sekali lalu meneruskannya ke registry"',
  },
  {
    label: "blok test bridge dihapus",
    // Non-global: potong dari deklarasi tipe legacy sampai akhir berkas.
    re: /\ntype LegacyClientLike = \{[\s\S]*$/,
    replace: "",
  },
];

// --- events-provider.test.ts ----------------------------------------------

const PROVIDER_LEGACY_TEST_FIND = `  it("konsumen legacy (App.tsx) tetap satu koneksi lewat bridge", () => {
    // App.tsx belum dimigrasikan ke hook; bridge di main.tsx mengalihkan
    // \`new EventSource("/api/events")\` ke hub supaya tidak ada socket kedua.
    expect(app).toContain('new EventSource("/api/events")');
    expect(main).toContain("installSharedEventSourceBridge()");
  });`;

const PROVIDER_LEGACY_TEST_REPLACE = `  it("App.tsx berlangganan lewat hook, bukan EventSource sendiri", () => {
    expect(app).not.toContain("new EventSource(");
    expect(app).toContain('useEventSubscription("*"');
    expect(main).not.toContain("installSharedEventSourceBridge");
  });`;

const PROVIDER_RULES: Rule[] = [
  {
    label: "guard App.tsx: tanpa EventSource sendiri",
    find: PROVIDER_LEGACY_TEST_FIND,
    replace: PROVIDER_LEGACY_TEST_REPLACE,
    skipIf: 'it("App.tsx berlangganan lewat hook, bukan EventSource sendiri"',
  },
];

// --- target ----------------------------------------------------------------

const TARGETS: Target[] = [
  {
    label: "web/src/App.tsx",
    url: new URL("../web/src/App.tsx", import.meta.url),
    importRules: [APP_IMPORT_RULE],
    rules: APP_RULES,
    mustInclude: [
      'import { useEventSubscription } from "@/lib/events-provider";',
      'useEventSubscription("*"',
      "export default function App()",
      "function DocumentTab(",
      "function TicketTab(",
      "function SettingsTab(",
    ],
    mustExclude: ["new EventSource(", "JSON.parse(message.data)"],
  },
  {
    label: "web/src/main.tsx",
    url: new URL("../web/src/main.tsx", import.meta.url),
    rules: MAIN_RULES,
    mustInclude: ["<EventsProvider>", "<App />"],
    mustExclude: ["installSharedEventSourceBridge", "Bridge dipasang"],
  },
  {
    label: "web/src/lib/events-stream.ts",
    url: new URL("../web/src/lib/events-stream.ts", import.meta.url),
    rules: STREAM_RULES,
    mustInclude: [
      "export const EVENTS_URL",
      "export class EventStreamHub",
      "getEventStreamHub",
      "backoffDelay",
      "registry.dispatch",
    ],
    mustExclude: [
      "installSharedEventSourceBridge",
      "attachLegacyClient",
      "LegacyStreamMessage",
      "emitLegacy",
      "SharedEventSource",
      "createMessageEvent",
      "legacyClients",
    ],
    patterns: [{ re: /new EventSource\(/g, count: 1, note: "jumlah new EventSource" }],
  },
  {
    label: "web/src/lib/events-stream.test.ts",
    url: new URL("../web/src/lib/events-stream.test.ts", import.meta.url),
    rules: TEST_RULES,
    mustInclude: ['describe("EventStreamHub"', "hub.acquire()"],
    mustExclude: ["installSharedEventSourceBridge", "attachLegacyClient", "LegacyClientLike"],
  },
  {
    label: "web/src/lib/events-provider.test.ts",
    url: new URL("../web/src/lib/events-provider.test.ts", import.meta.url),
    rules: PROVIDER_RULES,
    mustInclude: ['expect(app).not.toContain("new EventSource(")'],
    mustExclude: ["installSharedEventSourceBridge()"],
  },
];

/** Simbol yang harus hilang dari `web/src` setelah migrasi (dipindai di akhir). */
const REMOVED_SYMBOLS = [
  "installSharedEventSourceBridge(",
  "attachLegacyClient(",
  "LegacyStreamMessage",
  "emitLegacy(",
  "SharedEventSource",
  "createMessageEvent(",
];

/**
 * `String.prototype.matchAll` melempar TypeError bila regex tidak memakai flag
 * `g` ("matchAll called with a non-global RegExp argument"). Rule di berkas ini
 * sengaja non-global karena memakai `[\s\S]*$` (sekali cocok sampai akhir
 * berkas), jadi flag `g` hanya ditambahkan untuk perhitungan.
 */
function globalize(re: RegExp): RegExp {
  return re.global ? re : new RegExp(re.source, `${re.flags}g`);
}

function countOf(source: string, re: RegExp | undefined, find: string | undefined): number {
  if (re) return [...source.matchAll(globalize(re))].length;
  return source.split(find ?? "").length - 1;
}

/** Sisipkan `snippet` setelah statement `import` terakhir (top-level). */
function insertAfterLastImport(source: string, snippet: string): string | null {
  const re = /^import[\s\S]*?;/gm;
  let end = -1;
  for (const match of source.matchAll(re)) {
    end = (match.index ?? 0) + match[0].length;
  }
  if (end < 0) return null;
  return `${source.slice(0, end)}\n${snippet}${source.slice(end)}`;
}

function applyImportRules(source: string, rules: ImportRule[], report: ApplyReport): string {
  let out = source;
  for (const rule of rules) {
    if (out.includes(rule.skipIf)) {
      report.skipped += 1;
      continue;
    }
    const next = insertAfterLastImport(out, rule.snippet);
    if (next === null) {
      report.problems.push(`${rule.label}: tidak menemukan statement import untuk dijadikan anchor`);
      continue;
    }
    out = next;
    report.applied += 1;
  }
  return out;
}

function applyRules(source: string, rules: Rule[], report: ApplyReport): string {
  let out = source;
  for (const rule of rules) {
    if (rule.skipIf && out.includes(rule.skipIf)) {
      report.skipped += 1;
      continue;
    }
    const expected = rule.expect ?? 1;
    let matcher = rule.re;
    let found = countOf(out, matcher, rule.find);
    if (found === 0 && !matcher && rule.alt) {
      matcher = rule.alt;
      found = countOf(out, matcher, rule.find);
      if (found > 0) console.log(`   - ${rule.label}: memakai fallback regex`);
    }
    if (found === 0) {
      // Teks tidak ditemukan = kemungkinan sudah diterapkan (aman dijalankan
      // ulang). Kebenaran hasil tetap dijaga guard target.
      if (rule.replace === "") report.skipped += 1;
      else report.missing += 1;
      continue;
    }
    if (found !== expected) {
      report.problems.push(`${rule.label}: diharapkan ${expected}x, ditemukan ${found}x`);
      continue;
    }
    // Regex dipakai apa adanya (non-global = ganti kemunculan pertama) supaya
    // pola `[\s\S]*$` tidak berubah perilaku; penghitungan di atas yang
    // memakai versi `global`.
    out = matcher
      ? out.replace(matcher, rule.replace)
      : out.split(rule.find ?? "").join(rule.replace);
    report.applied += 1;
  }
  return out;
}

function verify(source: string, target: Target): string[] {
  const problems: string[] = [];
  for (const item of target.mustInclude) {
    if (!source.includes(item)) problems.push(`hasil harus memuat ${JSON.stringify(item)}`);
  }
  for (const item of target.mustExclude) {
    if (source.includes(item)) problems.push(`hasil masih memuat ${JSON.stringify(item)}`);
  }
  for (const pattern of target.patterns ?? []) {
    const found = [...source.matchAll(globalize(pattern.re))].length;
    if (found !== pattern.count) {
      problems.push(`${pattern.note}: diharapkan ${pattern.count}, ditemukan ${found}`);
    }
  }
  return problems;
}

function kb(text: string): string {
  return `${(new TextEncoder().encode(text).length / 1024).toFixed(1)} KB`;
}

/**
 * Pindai `web/src` memakai hasil transformasi (bukan isi disk) supaya laporan
 * dry-run sama dengan hasil setelah `--write`.
 */
async function scanLeftovers(root: URL, planned: Map<string, string>): Promise<string[]> {
  const hits: string[] = [];
  const stack: URL[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) break;
    for await (const entry of Deno.readDir(dir)) {
      const child = new URL(`${entry.name}${entry.isDirectory ? "/" : ""}`, dir);
      if (entry.isDirectory) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        stack.push(child);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const source = planned.get(child.pathname) ?? await Deno.readTextFile(child);
      const relative = child.pathname.slice(root.pathname.length);
      for (const symbol of REMOVED_SYMBOLS) {
        if (source.includes(symbol)) hits.push(`${relative}: ${symbol}`);
      }
    }
  }
  return hits.sort();
}

async function main() {
  const write = Deno.args.includes("--write");
  console.log(write ? "mode: WRITE\n" : "mode: dry-run (pakai --write untuk menerapkan)\n");

  const planned = new Map<string, string>();
  let fatal = 0;

  for (const target of TARGETS) {
    const original = await Deno.readTextFile(target.url);
    const report: ApplyReport = { applied: 0, skipped: 0, missing: 0, problems: [] };
    console.log(`== ${target.label}`);
    const withImports = applyImportRules(original, target.importRules ?? [], report);
    const next = applyRules(withImports, target.rules, report);
    const problems = [...report.problems, ...verify(next, target)];

    console.log(`   ukuran: ${kb(original)} -> ${kb(next)}`);
    console.log(
      `   rule: ${report.applied} diterapkan, ${report.skipped} dilewati, ` +
        `${report.missing} tidak ditemukan`,
    );
    for (const problem of problems) console.log(`   ! ${problem}`);

    if (problems.length > 0) {
      fatal += problems.length;
      planned.set(target.url.pathname, original);
      console.log(`   DIBATALKAN: ${target.label} tidak ditulis.\n`);
      continue;
    }

    planned.set(target.url.pathname, next);
    if (next === original) {
      console.log("   tidak ada perubahan.\n");
      continue;
    }
    if (!write) {
      console.log("   (dry-run) belum ditulis.\n");
      continue;
    }

    const tmp = `${target.url.pathname}.rel1.tmp`;
    await Deno.writeTextFile(tmp, next);
    await Deno.rename(tmp, target.url.pathname);
    console.log(`   ditulis: ${target.label}\n`);
  }

  const leftovers = await scanLeftovers(new URL("../web/src/", import.meta.url), planned);
  console.log("== sisa referensi ke simbol yang dihapus (setelah transformasi)");
  if (leftovers.length === 0) {
    console.log("   bersih.\n");
  } else {
    for (const hit of leftovers) console.log(`   ! ${hit}`);
    console.log("");
    fatal += leftovers.length;
  }

  if (!write) {
    console.log(`dry-run selesai (${fatal} masalah).`);
    console.log("terapkan dengan: deno task rel1:codemod --write\n");
    return;
  }

  if (fatal > 0) {
    console.log(`selesai dengan ${fatal} masalah — tinjau laporan di atas.`);
    return;
  }

  console.log("selesai. Lanjutkan dengan:");
  console.log("  npm --prefix web run test");
  console.log("  npm --prefix web run typecheck");
}

if (import.meta.main) await main();
