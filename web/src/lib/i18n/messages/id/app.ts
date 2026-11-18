import type { MessageDict } from "../../types";

export const app: MessageDict = {
  "app.tab.workspace": "Workspace",
  "app.tab.ticket": "Ticket",
  "app.tab.ticketBoard": "Ticket Board",
  "app.tab.settings": "Project Settings",
  "app.tab.global": "Global Settings",
  "app.tab.document": "Document",
  "app.tab.review": "Review",
  "app.tab.git": "Git",
  "app.tab.workflow": "Workflows",
  "app.tab.workflowDocs": "Dokumentasi workflow",
  "app.tab.cron": "Cron",
  "app.tab.cronDocs": "Dokumentasi cron",
  "app.noProject": "Belum ada project dipilih",
  "app.pickProject": "Buat atau pilih project untuk mulai",

  // WorkspaceOverview (tab Workspace)
  "app.workspaceOverview.pathLabel": "Workspace: {path}",
  "app.workspaceOverview.statIntegrations": "Integrations",
  "app.workspaceOverview.statWorkspace": "Workspace",
  "app.workspaceOverview.startHere": "Mulai dari sini",
  "app.workspaceOverview.startHerePrefix": "Set folder workspace di ",
  "app.workspaceOverview.startHereAction": "Settings → Workspace",
  "app.workspaceOverview.startHereSuffix": " agar menu Explorer aktif.",
  "app.workspaceOverview.openSettings": "Buka Settings",

  // Empty state
  "app.empty.title": "Kosong",
  "app.empty.pickProject": "Pilih atau buat project di panel kiri.",
  "app.empty.review": "Tidak ada perubahan yang menunggu review.",
  "app.empty.openMenu": "Buka menu dari activity bar di kiri.",

  // Tab dinamis
  "app.review.changesTitle": "Review perubahan ({count})",

  // Pesan error di App.tsx
  "app.document.pickProjectFirst": "Pilih project dulu.",
  "app.git.noProject": "Belum ada project.",

  // FileTab
  "app.fileTab.binary": "File biner (tidak ditampilkan).",
  "app.fileTab.unsaved": "Belum disimpan",
  "app.fileTab.code": "Kode",
  "app.fileTab.preview": "Preview",
  "app.fileTab.save": "Simpan",
  "app.fileTab.emptyMarkdown": "_(kosong)_",

  // Badge status LSP
  "app.lsp.connecting": "Connecting…",
  "app.lsp.ready": "Ready",
  "app.lsp.error": "Error",
  "app.lsp.off": "Off",
};
