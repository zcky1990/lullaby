import type { MessageDict } from "../../types";

/** Panel dokumen lokal + Docmost/Notion/Confluence. */
export const documents: MessageDict = {
  // DocumentPanel
  "documents.panel.title": "Documents",
  "documents.panel.add": "Tambah dokumen",
  "documents.panel.refresh": "Refresh documents",
  "documents.panel.local": "Local",
  "documents.panel.createHintLocal":
    "Dokumen baru disimpan sebagai file .md di document workspace.",
  "documents.panel.createHintNotionChild":
    "Halaman Notion baru sebagai child dari halaman terpilih.",
  "documents.panel.createHintNotionRoot":
    "Halaman Notion baru di bawah parentPageId integrasi (wajib).",
  "documents.panel.createHintConfluenceChild":
    "Halaman Confluence baru di bawah space/halaman terpilih.",
  "documents.panel.createHintConfluenceRoot":
    "Halaman Confluence baru di spaceKey integrasi (wajib).",
  "documents.panel.createHintDocmostChild":
    "Dokumen baru akan dibuat sebagai sub-halaman dari dokumen terpilih.",
  "documents.panel.createHintDocmostRoot":
    "Dokumen baru akan dibuat di space Docmost project ini.",
  "documents.panel.titleLabel": "Judul",
  "documents.panel.titlePlaceholder": "Judul dokumen…",
  "documents.panel.cancel": "Batal",
  "documents.panel.create": "Buat",
  "documents.panel.noProject": "Pilih project dulu di menu Workspace.",
  "documents.panel.loadingLocal": "Memuat dokumen lokal…",
  "documents.panel.localNotConfigured":
    "Document workspace belum diatur (Project Settings → Workspace). Set folder markdown untuk menyimpan dokumen lokal.",
  "documents.panel.localEmpty":
    "Belum ada dokumen lokal. Klik tombol + untuk membuat.",
  "documents.panel.dragHint": "Seret dokumen ke panel chat untuk dijadikan konteks.",
  "documents.panel.dragTitle": "{path} · seret ke chat",
  "documents.panel.synced": "Synced",
  "documents.panel.error": "Error",
  "documents.panel.loading": "Memuat dokumen…",
  "documents.panel.notConfigured":
    "Integrasi {source} belum diatur (Project Settings → Integrations).",
  "documents.panel.emptyNotionPrefix":
    "Belum ada halaman. Pastikan integration punya akses ke page, atau isi ",
  "documents.panel.emptyNotionAction": "Parent Page ID",
  "documents.panel.emptyNotionSuffix": " di Project Settings.",
  "documents.panel.emptyConfluencePrefix": "Belum ada dokumen. Isi ",
  "documents.panel.emptyConfluenceAction": "Space Key",
  "documents.panel.emptyConfluenceSuffix":
    " di Project Settings atau expand space di tree.",
  "documents.panel.emptyDocmostPrefix": "Belum ada dokumen. Isi ",
  "documents.panel.emptyDocmostAction": "Space ID",
  "documents.panel.emptyDocmostSuffix":
    " (id space, bukan nama) di Project Settings → Integrations.",
  "documents.panel.collapse": "Collapse",
  "documents.panel.expand": "Expand",
  "documents.panel.nodeDragTitle": "{title} · seret ke chat",
  "documents.panel.noChildren": "Tidak ada sub-halaman.",

  // RichTextEditor
  "documents.richText.bold": "Bold",
  "documents.richText.italic": "Italic",
  "documents.richText.underline": "Underline",
  "documents.richText.strikethrough": "Strikethrough",
  "documents.richText.heading": "Heading",
  "documents.richText.bulletList": "Bullet list",
  "documents.richText.numberedList": "Numbered list",
  "documents.richText.quote": "Quote",
  "documents.richText.codeBlock": "Code block",
  "documents.richText.clearFormat": "Hapus format",
  "documents.richText.ariaLabel": "Rich text editor",
};
