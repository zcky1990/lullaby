/**
 * Codemod i18n untuk dua berkas UI terbesar yang belum bisa dikonversi:
 *
 *   - web/src/App.tsx                    (domain `app`)
 *   - web/src/components/ChatSidebar.tsx (domain `chat`)
 *
 * Kenapa memakai script, bukan edit langsung?
 * `read_file` memotong berkas > ±50.000 karakter, sedangkan `write_file` menimpa
 * seluruh isi berkas. Untuk App.tsx (±71 KB) dan ChatSidebar (±60 KB) ekor
 * berkas tidak pernah terbaca, jadi menulis ulang berkas dari chat akan
 * menghapus komponennya. Script ini membaca/menulis berkas secara utuh di
 * runtime (tanpa batas tool) dan hanya melakukan penggantian teks terverifikasi,
 * sehingga ekor berkas dijamin utuh.
 *
 * Keamanan:
 *   - setiap rule menyatakan berapa kali ia harus cocok (`expect`, default 1);
 *     bila jumlah kemunculan berbeda, rule DILEWATI dan dilaporkan (tidak menebak),
 *   - blok wajib ("anchor": `function DocumentTab(`, `function TicketTab(`,
 *     `function SettingsTab(`, penutup aside, …) diperiksa sesudah transformasi;
 *     kalau hilang, penulisan berkas dibatalkan,
 *   - penulisan atomik (`*.i18n.tmp` → rename),
 *   - default = dry-run, tidak menyentuh berkas.
 *
 * Pemakaian:
 *   deno task i18n:codemod              # dry-run + laporan
 *   deno task i18n:codemod --write      # terapkan
 *   deno task i18n:codemod --inventory  # hanya daftar teks hardcoded
 *
 * Setelah `--write`, jalankan guard kamus:
 *   cd web && npx vitest run src/lib/i18n.test.ts
 */

interface Rule {
  /** Potongan teks sumber yang harus ada (persis, termasuk indentasi bila ikut ditulis). */
  find?: string;
  /** Alternatif: regex dengan flag `g` (dan `m` bila memakai `^`/`$`). */
  re?: RegExp;
  /** Pengganti; untuk regex boleh memakai `$1`, `$2`, … */
  replace: string;
  /** Jumlah kemunculan yang diharapkan. Default 1. */
  expect?: number;
}

interface Target {
  label: string;
  url: URL;
  rules: Rule[];
  anchors: string[];
  structural?: (source: string, notes: string[]) => string;
}

const APP_RULES: Rule[] = [
  // --- impor -------------------------------------------------------------
  {
    find: 'import { WorkspacePanel } from "@/components/WorkspacePanel";',
    replace:
      'import { WorkspaceOverview } from "@/components/WorkspaceOverview";\nimport { WorkspacePanel } from "@/components/WorkspacePanel";',
  },
  {
    find: 'import { cn } from "@/lib/utils";',
    replace:
      'import { cn } from "@/lib/utils";\nimport { useI18n, type Translator } from "@/lib/i18n";',
  },

  // --- hook --------------------------------------------------------------
  {
    find: "export default function App() {\n",
    replace: "export default function App() {\n  const { t } = useI18n();\n",
  },
  {
    find: "function Empty({ text }: { text: string }) {\n  return (",
    replace: "function Empty({ text }: { text: string }) {\n  const { t } = useI18n();\n  return (",
  },

  // --- Empty state -------------------------------------------------------
  {
    find: 'text="Pilih atau buat project di panel kiri."',
    replace: 'text={t("app.empty.pickProject")}',
  },
  {
    find: 'text="Tidak ada perubahan yang menunggu review."',
    replace: 'text={t("app.empty.review")}',
  },
  {
    find: 'text="Buka menu dari activity bar di kiri."',
    replace: 'text={t("app.empty.openMenu")}',
  },
  {
    find: "<EmptyTitle>Kosong</EmptyTitle>",
    replace: '<EmptyTitle>{t("app.empty.title")}</EmptyTitle>',
  },

  // --- judul tab dari onMenuChange / renderTab ---------------------------
  {
    find: 'openSingleton("global", "Global Settings")',
    replace: 'openSingleton("global", t("app.tab.global"))',
  },
  {
    find: 'openSingleton("workspace", "Workspace")',
    replace: 'openSingleton("workspace", t("app.tab.workspace"))',
  },
  {
    find: 'openSingleton("ticket", "Ticket Board")',
    replace: 'openSingleton("ticket", t("app.tab.ticketBoard"))',
    expect: 2,
  },
  {
    find: 'openSingleton("settings", "Project Settings")',
    replace: 'openSingleton("settings", t("app.tab.settings"))',
    expect: 2,
  },
  {
    find: 'openSingleton("git", "Git")',
    replace: 'openSingleton("git", t("app.tab.git"))',
  },
  {
    find: 'openSingleton("workflow", "Workflows")',
    replace: 'openSingleton("workflow", t("app.tab.workflow"))',
  },
  {
    find: 'openSingleton("cron", "Cron")',
    replace: 'openSingleton("cron", t("app.tab.cron"))',
  },
  {
    find: 'title: "Workflow Docs",',
    replace: 'title: t("app.tab.workflowDocs"),',
  },
  {
    find: 'title: "Cron Docs",',
    replace: 'title: t("app.tab.cronDocs"),',
  },
  {
    find: 'title: "Workspace",',
    replace: 'title: t("app.tab.workspace"),',
  },
  {
    find: "title: `Review changes (${detail.changes.length})`,",
    replace: 'title: t("app.review.changesTitle", { count: detail.changes.length }),',
    expect: 2,
  },

  // --- pesan error -------------------------------------------------------
  {
    find: 'throw new Error("Pilih project dulu.")',
    replace: 'throw new Error(t("app.document.pickProjectFirst"))',
  },
  {
    find: 'throw new Error("Belum ada project.")',
    replace: 'throw new Error(t("app.git.noProject"))',
  },

  // --- FileTab -----------------------------------------------------------
  {
    find:
      "  onLspStatus?: (event: LspStatusEvent) => void;\n}) {\n  const { resolvedEditorTheme } = useTheme();",
    replace:
      "  onLspStatus?: (event: LspStatusEvent) => void;\n}) {\n  const { t } = useI18n();\n  const { resolvedEditorTheme } = useTheme();",
  },
  {
    find: 'function lspBadgeLabel(status: LspStatusEvent["status"]): string {',
    replace: 'function lspBadgeLabel(t: Translator, status: LspStatusEvent["status"]): string {',
  },
  { find: 'return "Connecting…";', replace: 'return t("app.lsp.connecting");' },
  { find: 'return "Ready";', replace: 'return t("app.lsp.ready");' },
  { find: 'return "Error";', replace: 'return t("app.lsp.error");' },
  { find: 'return "Off";', replace: 'return t("app.lsp.off");' },
  {
    find: "LSP {lspBadgeLabel(lspStatus.status)}",
    replace: 'LSP {lspBadgeLabel(t, lspStatus.status)}',
  },
  {
    find: '<p className="p-6 text-xs text-muted-foreground">File biner (tidak ditampilkan).</p>',
    replace: '<p className="p-6 text-xs text-muted-foreground">{t("app.fileTab.binary")}</p>',
  },
  {
    find: 'title="Belum disimpan"',
    replace: 'title={t("app.fileTab.unsaved")}',
  },
  {
    find: '{tab.preview ? "Kode" : "Preview"}',
    replace: '{tab.preview ? t("app.fileTab.code") : t("app.fileTab.preview")}',
  },
  {
    re: /^([ \t]*)\{saving \? <Spinner \/> : <Save \/>\}[ \t]*\n([ \t]*)Simpan[ \t]*$/gm,
    replace: '$1{saving ? <Spinner /> : <Save />}\n$2{t("app.fileTab.save")}',
  },
  {
    find: 'content={tab.content || "_(kosong)_"}',
    replace: 'content={tab.content || t("app.fileTab.emptyMarkdown")}',
  },
];

const CHAT_RULES: Rule[] = [
  // --- impor & hook ------------------------------------------------------
  {
    find: 'import { cn } from "@/lib/utils";',
    replace:
      'import { cn } from "@/lib/utils";\nimport { useI18n, type Translator } from "@/lib/i18n";',
  },
  {
    find: "  const { chatFont, chatFontSize } = useTheme();",
    replace: "  const { t } = useI18n();\n  const { chatFont, chatFontSize } = useTheme();",
  },

  // --- konfigurasi modul -------------------------------------------------
  {
    find:
      'const VARIANTS = [\n  { id: "low", label: "Low" },\n  { id: "medium", label: "Medium" },\n  { id: "high", label: "High" },\n];',
    replace:
      'const VARIANTS = [\n  { id: "low", labelKey: "chat.variant.low" },\n  { id: "medium", labelKey: "chat.variant.medium" },\n  { id: "high", labelKey: "chat.variant.high" },\n];',
  },
  { find: "{item.label}", replace: "{t(item.labelKey)}" },

  // --- helper lampiran (non-komponen → pakai t: Translator) --------------
  {
    find: "function readAsDataUrl(file: File): Promise<string> {",
    replace: "function readAsDataUrl(file: File, t: Translator): Promise<string> {",
  },
  {
    find: 'reader.onerror = () => reject(reader.error ?? new Error("Gagal membaca file."));',
    replace:
      'reader.onerror = () => reject(reader.error ?? new Error(t("chat.attachment.readFailed")));',
  },
  {
    find: "async function readAttachment(file: File): Promise<AttachmentDraft> {",
    replace:
      "async function readAttachment(file: File, t: Translator): Promise<AttachmentDraft> {",
  },
  {
    find: "      throw new Error(`Tipe gambar tidak didukung (pakai PNG/JPEG/GIF/WebP): ${file.name}`);",
    replace: '      throw new Error(t("chat.attachment.unsupportedImage", { name: file.name }));',
  },
  {
    find: "    throw new Error(`Tipe file tidak didukung: ${file.name}`);",
    replace: '    throw new Error(t("chat.attachment.unsupportedType", { name: file.name }));',
  },
  {
    find: "      throw new Error(`Gambar terlalu besar (maks 3 MB): ${file.name}`);",
    replace: '      throw new Error(t("chat.attachment.imageTooLarge", { name: file.name }));',
  },
  {
    find: "    throw new Error(`File teks terlalu besar (maks 200 KB): ${file.name}`);",
    replace: '    throw new Error(t("chat.attachment.textTooLarge", { name: file.name }));',
  },
  {
    find: "      data: await readAsDataUrl(file),",
    replace: "      data: await readAsDataUrl(file, t),",
  },
  {
    find: "        accepted.push(await readAttachment(file));",
    replace: "        accepted.push(await readAttachment(file, t));",
  },

  // --- pesan error -------------------------------------------------------
  {
    find: 'setError("Pilih project dulu.");',
    replace: 'setError(t("chat.error.pickProjectFirst"));',
    expect: 2,
  },
  {
    find: "setError(`Maksimal ${MAX_ATTACHMENTS} lampiran per pesan.`);",
    replace: 'setError(t("chat.error.maxAttachments", { count: MAX_ATTACHMENTS }));',
    expect: 4,
  },
  {
    find: 'setError("Belum ada provider LLM (Global Settings → LLM Providers).");',
    replace: 'setError(t("chat.error.noProvider"));',
    expect: 2,
  },
  {
    find: 'setError(response.status === "error" ? response.error : "Terjadi kesalahan.");',
    replace: 'setError(response.status === "error" ? response.error : t("chat.error.generic"));',
  },
  {
    find: 'if (!confirm("Hapus sesi chat?")) return;',
    replace: 'if (!confirm(t("chat.sessions.deleteConfirm"))) return;',
  },

  // --- autoskill ---------------------------------------------------------
  {
    find: 'content: "Menjalankan `npx autoskills` di workspace… (bisa beberapa menit)",',
    replace: 'content: t("chat.autoskill.running"),',
  },
  {
    find: 'result.dryRun ? "Dry-run selesai." : "Autoskills selesai.",',
    replace: 'result.dryRun ? t("chat.autoskill.dryRunDone") : t("chat.autoskill.done"),',
  },
  {
    find:
      '            ? `Skill workspace (${names.length}): ${names.map((name) => `/${name}`).join(", ")}`',
    replace:
      '            ? t("chat.autoskill.skills", {\n              count: names.length,\n              list: names.map((name) => `/${name}`).join(", "),\n            })',
  },
  {
    find: '            : "Tidak ada skill workspace baru terdeteksi (cek output CLI).",',
    replace: '            : t("chat.autoskill.none"),',
  },
  {
    find: '`Gagal: ${result.error ?? "autoskills error"}`',
    replace: 't("chat.autoskill.failed", { error: result.error ?? "autoskills error" })',
  },
  {
    find: "{ ...entry, content: `Gagal: ${(e as Error).message}` }",
    replace: '{ ...entry, content: t("chat.autoskill.failed", { error: (e as Error).message }) }',
  },

  // --- add to chat -------------------------------------------------------
  {
    find: 'const label = detail.sourceLabel?.trim() || "Seleksi";',
    replace: 'const label = detail.sourceLabel?.trim() || t("chat.addToChat.selection");',
  },
  {
    find: "const name = `Seleksi: ${label}`.slice(0, 80);",
    replace: 'const name = `${t("chat.addToChat.selection")}: ${label}`.slice(0, 80);',
  },
  {
    find: "`# Seleksi: ${label}`",
    replace: '`# ${t("chat.addToChat.selection")}: ${label}`',
  },

  // --- composer: isi pesan ----------------------------------------------
  {
    find:
      'const content = bodyText.trim() || (skillName ? `Ikuti skill /${skillName}.` : "Lihat lampiran.");',
    replace:
      'const content = bodyText.trim() ||\n      (skillName\n        ? t("chat.composer.followSkill", { skill: skillName })\n        : t("chat.composer.seeAttachment"));',
  },

  // --- JSX: resize & drag ------------------------------------------------
  { find: 'aria-label="Resize chat"', replace: 'aria-label={t("chat.resize.aria")}' },
  { find: 'title="Drag to resize"', replace: 'title={t("chat.resize.title")}' },
  {
    find: ">Lepaskan file, dokumen, atau tiket di sini<",
    replace: '>{t("chat.drag.drop")}<',
  },

  // --- JSX: sesi ---------------------------------------------------------
  { find: 'aria-label="Sesi chat"', replace: 'aria-label={t("chat.sessions.selectAria")}' },
  {
    find: 'placeholder="Chat baru"',
    replace: 'placeholder={t("chat.sessions.newPlaceholder")}',
  },
  {
    re: /^([ \t]*)<Plus size=\{12\}\/>[ \t]*\n([ \t]*)Chat baru[ \t]*$/gm,
    replace: '$1<Plus size={12}/>\n$2{t("chat.sessions.new")}',
  },
  {
    find: 'aria-label="Hapus sesi chat"',
    replace: 'aria-label={t("chat.sessions.deleteAria")}',
  },

  // --- JSX: panel kosong -------------------------------------------------
  {
    re: /^([ \t]*)Mulai chat dengan LLM\.[\s\S]*?chat selesai\.[ \t]*$/gm,
    replace: '$1{t("chat.empty.intro")}',
  },

  // --- JSX: step agent ---------------------------------------------------
  { re: /^([ \t]*)Allow once[ \t]*$/gm, replace: '$1{t("chat.steps.allowOnce")}' },
  { re: /^([ \t]*)Always allow[ \t]*$/gm, replace: '$1{t("chat.steps.alwaysAllow")}' },
  { re: /^([ \t]*)No[ \t]*$/gm, replace: '$1{t("chat.steps.deny")}' },
  { re: /^([ \t]*)Bekerja…[ \t]*$/gm, replace: '$1{t("chat.steps.working")}' },

  // --- JSX: review perubahan --------------------------------------------
  {
    find: ">Perubahan menunggu review<",
    replace: '>{t("chat.review.pendingTitle")}<',
  },
  {
    re: /^([ \t]*)Diff dan tombol accept\/reject tersedia di tab editor\.[ \t]*$/gm,
    replace: '$1{t("chat.review.pendingHint")}',
  },
  { re: /^([ \t]*)Buka review[ \t]*$/gm, replace: '$1{t("chat.review.open")}' },
  {
    find: ">Perubahan sudah diterapkan<",
    replace: '>{t("chat.review.appliedTitle")}<',
  },
  {
    find: 'aria-label="Tutup review perubahan"',
    replace: 'aria-label={t("chat.review.closeAria")}',
  },
  {
    find: "{describeDeferredReview(reviewOffer.changes)} · chat tetap bisa dilanjutkan",
    replace:
      '{t("chat.review.appliedHint", { summary: describeDeferredReview(reviewOffer.changes) })}',
  },
  { re: /^([ \t]*)Review &amp; revert[ \t]*$/gm, replace: '$1{t("chat.review.revert")}' },

  // --- JSX: konteks & lampiran ------------------------------------------
  {
    re: /^([ \t]*)Membaca dokumen\/tiket…[ \t]*$/gm,
    replace: '$1{t("chat.context.loading")}',
  },
  {
    find: "aria-label={`Hapus ${item.name}`}",
    replace: 'aria-label={t("chat.attachment.remove", { name: item.name })}',
  },

  // --- JSX: composer -----------------------------------------------------
  { find: ">Role</span>", replace: '>{t("chat.composer.role")}</span>' },
  { find: 'aria-label="Role chat"', replace: 'aria-label={t("chat.composer.roleAria")}' },
  { find: 'placeholder="Tanpa role"', replace: 'placeholder={t("chat.composer.roleNone")}' },
  { find: ">Tanpa role</SelectItem>", replace: '>{t("chat.composer.roleNone")}</SelectItem>' },
  {
    find: 'aria-label="Hapus skill"',
    replace: 'aria-label={t("chat.composer.removeSkillAria")}',
  },
  {
    find: '? "Selesaikan persetujuan dulu…"',
    replace: '? t("chat.composer.placeholderPending")',
  },
  {
    find: ': "Tulis pesan… /skill-name · Enter kirim"}',
    replace: ': t("chat.composer.placeholder")}',
  },
  {
    find: 'aria-label="Lampirkan file"',
    replace: 'aria-label={t("chat.composer.attachAria")}',
  },
  {
    find: 'title="Lampirkan gambar/file — atau seret file dari Explorer"',
    replace: 'title={t("chat.composer.attachTitle")}',
  },
  { find: 'aria-label="Mode chat"', replace: 'aria-label={t("chat.composer.modeAria")}' },
  {
    find: 'aria-label="Pilih provider / model"',
    replace: 'aria-label={t("chat.composer.providerAria")}',
  },
  {
    find: 'title={roleProviderId ? "Provider ditentukan oleh role" : undefined}',
    replace: 'title={roleProviderId ? t("chat.composer.providerLocked") : undefined}',
  },
  {
    find: 'placeholder="Provider"',
    replace: 'placeholder={t("chat.composer.providerPlaceholder")}',
  },
  {
    re: /^([ \t]*)Memuat model…[ \t]*$/gm,
    replace: '$1{t("chat.composer.modelsLoading")}',
  },
  {
    find: 'aria-label="Variant model"',
    replace: 'aria-label={t("chat.composer.variantAria")}',
  },
  {
    find: 'placeholder="Variant"',
    replace: 'placeholder={t("chat.composer.variantPlaceholder")}',
  },
];

/** Blok yang wajib selamat. Kalau hilang, penulisan dibatalkan. */
const APP_ANCHORS = [
  "export default function App()",
  "function Empty(",
  "function lspBadgeLabel(",
  "function FileTab(",
  "function DocumentTab(",
  "function TicketTab(",
  "function SettingsTab(",
];

const CHAT_ANCHORS = [
  "export function ChatSidebar(",
  "async function readAttachment(",
];

/**
 * App.tsx: ganti salinan lokal `WorkspaceOverview` + `StatCard` dengan komponen
 * yang sudah ter-i18n-kan (`web/src/components/WorkspaceOverview.tsx`).
 */
function structuralApp(source: string, notes: string[]): string {
  const overview = /\nfunction WorkspaceOverview\(\{[\s\S]*?\n\}\n\nfunction lspBadgeLabel\(/;
  if (overview.test(source)) {
    source = source.replace(overview, "\nfunction lspBadgeLabel(");
    notes.push("salinan lokal WorkspaceOverview + StatCard dihapus");
  } else if (source.includes("function WorkspaceOverview(")) {
    notes.push("! blok WorkspaceOverview lokal tidak dikenali, dibiarkan (cek manual)");
  } else {
    notes.push("WorkspaceOverview lokal sudah tidak ada (sudah di-wire sebelumnya)");
  }

  const cardImport =
    'import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";\n';
  if (source.includes(cardImport)) {
    const rest = source.replace(cardImport, "");
    if (/\bCard(Content|Description|Header|Title)?\b/.test(rest)) {
      notes.push("import Card masih dipakai komponen lain, dibiarkan");
    } else {
      source = rest;
      notes.push("import Card yang tidak terpakai dihapus");
    }
  }
  return source;
}

const ATTR_RE = /\b(?:aria-label|placeholder|title|alt)=(?:"([^"]+)"|\{`([^`]+)`\})/g;
const ERROR_RE = /(?:new Error|setError|confirm)\(\s*"([^"]+)"/g;
const JSX_TEXT_RE = /^\s{6,}([A-Z][^<>{}"'`=]*[a-z][^<>{}"'`=]*)\s*$/;

/** Daftar teks user-visible yang masih hardcoded (untuk sisa pekerjaan). */
function inventory(source: string): string[] {
  const found: string[] = [];
  source.split("\n").forEach((line, index) => {
    const row = index + 1;
    for (const match of line.matchAll(ATTR_RE)) {
      found.push(`${row}: attr ${JSON.stringify(match[1] ?? match[2])}`);
    }
    for (const match of line.matchAll(ERROR_RE)) {
      found.push(`${row}: pesan ${JSON.stringify(match[1])}`);
    }
    const jsx = line.match(JSX_TEXT_RE);
    if (jsx) {
      const text = jsx[1].trim();
      if (text.split(/\s+/).length >= 2) found.push(`${row}: teks ${JSON.stringify(text)}`);
    }
  });
  return found;
}

interface Report {
  applied: number;
  missing: number;
  mismatch: string[];
}

function occurrences(source: string, rule: Rule): number {
  if (rule.re) return [...source.matchAll(rule.re)].length;
  return source.split(rule.find ?? "").length - 1;
}

function applyRules(source: string, rules: Rule[], report: Report): string {
  let out = source;
  for (const rule of rules) {
    const expected = rule.expect ?? 1;
    const count = occurrences(out, rule);
    const label = rule.re ? String(rule.re).slice(0, 70) : JSON.stringify((rule.find ?? "").slice(0, 70));
    if (count === 0) {
      report.missing += 1;
      continue;
    }
    if (count !== expected) {
      report.mismatch.push(`diharapkan ${expected}x, ditemukan ${count}x: ${label}`);
      continue;
    }
    out = rule.re ? out.replace(rule.re, rule.replace) : out.split(rule.find ?? "").join(rule.replace);
    report.applied += 1;
  }
  return out;
}

function kb(text: string): string {
  return `${(new TextEncoder().encode(text).length / 1024).toFixed(1)} KB`;
}

async function main() {
  const write = Deno.args.includes("--write");
  const inventoryOnly = Deno.args.includes("--inventory");

  const targets: Target[] = [
    {
      label: "web/src/App.tsx",
      url: new URL("../web/src/App.tsx", import.meta.url),
      rules: APP_RULES,
      anchors: APP_ANCHORS,
      structural: structuralApp,
    },
    {
      label: "web/src/components/ChatSidebar.tsx",
      url: new URL("../web/src/components/ChatSidebar.tsx", import.meta.url),
      rules: CHAT_RULES,
      anchors: CHAT_ANCHORS,
    },
  ];

  console.log(write ? "mode: WRITE\n" : "mode: dry-run (pakai --write untuk menerapkan)\n");
  let fatal = 0;

  for (const target of targets) {
    const original = await Deno.readTextFile(target.url);
    const notes: string[] = [];
    const report: Report = { applied: 0, missing: 0, mismatch: [] };

    let next = original;
    if (!inventoryOnly) {
      if (target.structural) next = target.structural(next, notes);
      next = applyRules(next, target.rules, report);
    }

    const lost = target.anchors.filter((anchor) => !next.includes(anchor));
    const leftovers = inventory(next);

    console.log(`== ${target.label}`);
    console.log(`   ukuran: ${kb(original)} -> ${kb(next)}`);
    if (!inventoryOnly) {
      console.log(`   rule diterapkan: ${report.applied}/${target.rules.length}`);
      for (const note of notes) console.log(`   - ${note}`);
      for (const item of report.mismatch) console.log(`   ! tidak cocok — ${item}`);
      if (report.mismatch.length > 0) fatal += report.mismatch.length;
      if (report.missing > 0) {
        console.log(`   · ${report.missing} rule tidak ditemukan (mungkin sudah dikonversi)`);
      }
    }
    if (lost.length > 0) {
      fatal += lost.length;
      for (const anchor of lost) console.log(`   ! ANCHOR HILANG: ${anchor}`);
    }
    console.log(`   sisa teks hardcoded: ${leftovers.length}`);
    for (const item of leftovers.slice(0, 200)) console.log(`      ${item}`);
    if (leftovers.length > 200) console.log(`      … ${leftovers.length - 200} lainnya`);
    console.log("");

    if (inventoryOnly) continue;
    if (lost.length > 0) {
      console.log(`   DIBATALKAN: ${target.label} tidak ditulis (anchor hilang).\n`);
      continue;
    }
    if (next === original) {
      console.log("   tidak ada perubahan.\n");
      continue;
    }
    if (!write) continue;

    const tmp = `${target.url.pathname}.i18n.tmp`;
    await Deno.writeTextFile(tmp, next);
    await Deno.rename(tmp, target.url.pathname);
    console.log(`   ditulis: ${target.label}\n`);
  }

  if (write && fatal > 0) {
    console.log(`selesai dengan ${fatal} peringatan — tinjau laporan di atas.`);
  }
  console.log("lanjutkan dengan: cd web && npx vitest run src/lib/i18n.test.ts");
}

if (import.meta.main) await main();
