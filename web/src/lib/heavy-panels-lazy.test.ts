import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guard PERF-7.
 *
 * Chunk utama dulu 1,19 MB karena panel berat di-import statis di shell:
 * `TicketKanban` (@dnd-kit + @base-ui lewat komponen kanban ReUI),
 * `TerminalPanel`/xterm, `GlobalSettingsView` (±130 KB section settings),
 * `SettingsView` (form integrasi + backup).
 *
 * Lazy boundary dipasang di modul pemilik panel (bukan di `App.tsx`) supaya
 * call site di shell tidak berubah:
 *
 * 1. `TerminalPanel` → `lazy(() => import("@/components/TerminalSession"))`.
 * 2. `TicketKanban` (wrapper) → `lazy(() => import("@/components/TicketKanbanBoard"))`.
 * 3. `GlobalSettingsView` → tiap section di-`lazy()`.
 * 4. `SettingsView` → `BackupSettings` + `IntegrationForm` di-`lazy()`.
 */
const terminalPanel = readFileSync(
  new URL("../components/TerminalPanel.tsx", import.meta.url),
  "utf8",
);
const ticketKanban = readFileSync(new URL("../components/TicketKanban.tsx", import.meta.url), "utf8");
const ticketKanbanBoard = readFileSync(
  new URL("../components/TicketKanbanBoard.tsx", import.meta.url),
  "utf8",
);
const globalSettingsView = readFileSync(
  new URL("../components/GlobalSettingsView.tsx", import.meta.url),
  "utf8",
);
const settingsView = readFileSync(
  new URL("../components/SettingsView.tsx", import.meta.url),
  "utf8",
);

function staticNamedImport(name: string): RegExp {
  return new RegExp(`^import\\s+(?:type\\s+)?\\{[^}]*\\b${name}\\b[^}]*\\}`, "m");
}

describe("PERF-7: panel berat dimuat lazy", () => {
  it("TerminalPanel mengambil TerminalSession (xterm) lewat lazy + Suspense", () => {
    expect(terminalPanel).toContain('import("@/components/TerminalSession")');
    expect(terminalPanel).not.toMatch(staticNamedImport("TerminalSession"));
    expect(terminalPanel).toContain("<Suspense");
    // API publik untuk shell tidak berubah.
    expect(terminalPanel).toContain("export function TerminalPanel(");
  });

  it("TicketKanban dipecah jadi wrapper lazy + board pemakai kanban", () => {
    expect(ticketKanban).toContain('import("@/components/TicketKanbanBoard")');
    expect(ticketKanban).toContain("<Suspense");
    expect(ticketKanban).not.toMatch(/from\s+["']@\/components\/reui\/kanban["']/);
    expect(ticketKanban).toContain("export function TicketKanban(");
    // Implementasi board tetap satu-satunya pemakai kanban (dnd-kit + base-ui).
    expect(ticketKanbanBoard).toContain('from "@/components/reui/kanban"');
    expect(ticketKanbanBoard).toContain("export function TicketKanbanBoard(");
  });

  it("section Global Settings tidak diimpor statis", () => {
    const sections = [
      "AutomationSettings",
      "WorkflowSettings",
      "BackupSettings",
      "ChatToolsSettings",
      "LayoutSettings",
      "LlmProvidersSettings",
      "LspSettingsPanel",
      "McpSettings",
      "NotificationSettings",
      "PromptsSettings",
      "RolesSettings",
      "SkillsSettings",
      "TerminalSettings",
    ];
    for (const name of sections) {
      expect(globalSettingsView).not.toMatch(staticNamedImport(name));
      expect(globalSettingsView).toContain(`default: module.${name}`);
    }
    expect(globalSettingsView).toContain("<Suspense");
    expect(globalSettingsView).toContain("export function GlobalSettingsView(");
  });

  it("SettingsView memuat form integrasi dan backup lewat lazy", () => {
    expect(settingsView).toContain('import("@/components/BackupSettings")');
    expect(settingsView).toContain('import("@/components/IntegrationForm")');
    expect(settingsView).not.toMatch(staticNamedImport("BackupSettings"));
    expect(settingsView).not.toMatch(staticNamedImport("IntegrationForm"));
    expect(settingsView).toContain("<Suspense");
    expect(settingsView).toContain("export function SettingsView(");
  });
});

/**
 * Guard PERF-9 (LOCAL-96C322).
 *
 * Panel yang hanya muncul saat satu menu dibuka tidak boleh ikut chunk utama.
 * Pola yang dipakai sama dengan PERF-7: modul yang di-`import` shell tetap
 * bernama sama (`@/components/GitTab`, …) tapi isinya tipis — implementasi
 * pindah ke subfolder dan dimuat lewat `lazy()` + `Suspense` + `Skeleton`.
 *
 * Kalau `App.tsx` (atau siapa pun) kembali meng-`import` modul implementasi
 * secara statis, chunk-nya masuk lagi ke bundle awal dan test ini gagal.
 * (Batas baca tool memotong `App.tsx` > 50.000 karakter, jadi boundary sengaja
 * dipasang di modul pemilik panel — call site di shell tidak perlu disentuh.)
 */
const appShell = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const viteConfig = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");

const PANELS = [
  {
    name: "GitTab",
    wrapperPath: "../components/GitTab.tsx",
    implPath: "@/components/git/GitTab",
    marker: "api.gitDiff(",
  },
  {
    name: "FileTreePanel",
    wrapperPath: "../components/FileTreePanel.tsx",
    implPath: "@/components/explorer/FileTreePanel",
    marker: "explorer",
  },
  {
    name: "DocumentPanel",
    wrapperPath: "../components/DocumentPanel.tsx",
    implPath: "@/components/documents/DocumentPanel",
    marker: "PanelDocSource",
  },
].map((panel) => ({
  ...panel,
  wrapper: readFileSync(new URL(panel.wrapperPath, import.meta.url), "utf8"),
  impl: readFileSync(
    new URL(`../components/${panel.implPath.replace("@/components/", "")}.tsx`, import.meta.url),
    "utf8",
  ),
}));

function staticValueImport(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^import\\s+(?!type\\b)[^;]*from\\s+["']${escaped}["']`, "m");
}

describe("PERF-9: panel per menu dimuat lazy", () => {
  for (const panel of PANELS) {
    it(`${panel.name}: wrapper tipis + implementasi di chunk terpisah`, () => {
      // Wrapper tetap mengekspor nama yang dipakai shell.
      expect(panel.wrapper).toContain(`export function ${panel.name}(`);
      expect(panel.wrapper).toContain(`import("${panel.implPath}")`);
      expect(panel.wrapper).toContain("<Suspense");
      expect(panel.wrapper).toContain("Skeleton");
      // Tidak boleh ada import runtime ke modul implementasi (mematikan split).
      expect(panel.wrapper).not.toMatch(staticValueImport(panel.implPath));

      // Implementasi berat memang ada di modul terpisah.
      expect(panel.impl).toContain(`export function ${panel.name}(`);
      expect(panel.impl).toContain(panel.marker);
    });

    it(`${panel.name}: shell hanya mengimpor wrapper, bukan implementasi`, () => {
      expect(appShell).not.toContain(panel.implPath);
      expect(appShell).toContain(`from "@/components/${panel.name}"`);
    });
  }

  it("DocumentPanel tetap mengekspor type PanelDocSource untuk shell", () => {
    const wrapper = PANELS.find((panel) => panel.name === "DocumentPanel")!.wrapper;
    expect(wrapper).toMatch(/export\s+type\s*\{[^}]*\bPanelDocSource\b/);
    expect(wrapper).not.toMatch(staticValueImport("@/components/documents/DocumentPanel"));
  });

  it("vite memecah vendor chunk per paket stabil", () => {
    expect(viteConfig).toContain("rollupOptions");
    expect(viteConfig).toContain("manualChunks");
    // Minimal 3 grup vendor, dikelompokkan berdasarkan nama paket…
    for (const pkg of ["react-dom", "@radix-ui", "lucide-react", "@xyflow/"]) {
      expect(viteConfig).toContain(pkg);
    }
    // …bukan berdasarkan path file aplikasi (cache hancur tiap commit).
    expect(viteConfig).not.toContain("@/components");
  });
});
