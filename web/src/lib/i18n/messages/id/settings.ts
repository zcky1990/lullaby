import type { MessageDict } from "../../types";

/** Global Settings + Project Settings + form integrasi/LLM. */
export const settings: MessageDict = {
  // GlobalSettingsPanel — menu samping
  "settings.global.title": "Global Settings",
  "settings.global.section.appearance": "Appearance & Editor",
  "settings.global.section.llm": "LLM Providers",
  "settings.global.section.roles": "Roles",
  "settings.global.section.prompts": "Prompts",
  "settings.global.section.mcp": "MCP",
  "settings.global.section.skills": "Skills",
  "settings.global.section.tools": "Tools",
  "settings.global.section.lsp": "Language Servers",
  "settings.global.section.automation": "Automation",
  "settings.global.section.workflow": "Workflow",
  "settings.global.section.notifications": "Notifications",
  "settings.global.section.terminal": "Terminal",
  "settings.global.section.backup": "Backup & Restore",
  "settings.global.section.about": "About",

  // GlobalSettingsView — Appearance
  "settings.global.appearance.title": "Appearance",
  "settings.global.appearance.description": "Tema warna dan font aplikasi.",
  "settings.global.appearance.colorTheme": "Color theme",
  "settings.global.appearance.mode": "Mode",
  "settings.global.appearance.appFont": "Font aplikasi",

  "settings.global.colorTheme.lullaby": "Lullaby",
  "settings.global.colorTheme.lullabyDescription":
    "Midnight indigo + soft gold — sesuai brand icon",
  "settings.global.colorTheme.vscode": "VS Code",
  "settings.global.colorTheme.vscodeDescription": "Tampilan VS Code (biru, abu-abu gelap)",
  "settings.global.colorTheme.shadcn": "shadcn",
  "settings.global.colorTheme.shadcnDescription": "Neutral hitam-putih",
  "settings.global.colorTheme.claude": "Claude",
  "settings.global.colorTheme.claudeDescription": "Krem hangat dengan aksen terracotta",
  "settings.global.colorTheme.supabase": "Supabase",
  "settings.global.colorTheme.supabaseDescription": "Hijau emerald dengan nuansa gelap",

  "settings.global.theme.light": "Light",
  "settings.global.theme.dark": "Dark",
  "settings.global.theme.system": "System",

  "settings.global.font.system": "System",
  "settings.global.font.inter": "Inter",
  "settings.global.font.manrope": "Manrope",
  "settings.global.font.jetbrains": "JetBrains Mono",
  "settings.global.font.fira": "Fira Code",
  "settings.global.font.menlo": "Menlo",
  "settings.global.font.consolas": "Consolas",
  "settings.global.font.monospace": "Monospace",

  // GlobalSettingsView — Editor
  "settings.global.editor.title": "Editor",
  "settings.global.editor.description": "Tema, font, dan ukuran text editor (Monaco).",
  "settings.global.editor.theme": "Tema editor",
  "settings.global.editor.font": "Font editor",
  "settings.global.editor.fontSize": "Ukuran font",
  "settings.global.editor.fontSizeAria": "Ukuran font editor",
  "settings.global.editor.typeScriptService": "TypeScript service",
  "settings.global.editor.typeScriptLabel": "IntelliSense TypeScript/JavaScript bawaan Monaco",
  "settings.global.editor.typeScriptHint":
    "Matikan bila Anda memakai language server (LSP) untuk TS/JS: worker ±7 MB tidak akan diunduh dan chunk language service tidak dimuat. Syntax highlighting tetap aktif; perubahan berlaku untuk editor yang dibuka setelah aplikasi dimuat ulang.",

  "settings.global.editorTheme.auto": "Auto",
  "settings.global.editorTheme.light": "Light",
  "settings.global.editorTheme.dark": "Dark",
  "settings.global.editorTheme.hcDark": "HC Dark",
  "settings.global.editorTheme.hcLight": "HC Light",

  // GlobalSettingsView — Chat
  "settings.global.chat.title": "Chat",
  "settings.global.chat.description": "Font dan ukuran teks untuk pesan dan input chat.",
  "settings.global.chat.font": "Font chat",
  "settings.global.chat.size": "Ukuran font chat",
  "settings.global.chat.previewTitle": "Contoh pesan chat",
  "settings.global.chat.previewBody": "Pengaturan ini berlaku untuk pesan dan input chat.",

  // GlobalSettingsView — Icons
  "settings.global.icons.title": "Icons",
  "settings.global.icons.description": "Ukuran dan ketebalan ikon antarmuka.",
  "settings.global.icons.size": "Ukuran ikon",
  "settings.global.icons.weight": "Ketebalan ikon",
  "settings.global.iconSize.sm": "Compact",
  "settings.global.iconSize.md": "Normal",
  "settings.global.iconSize.lg": "Large",
  "settings.global.iconWeight.light": "Light",
  "settings.global.iconWeight.regular": "Regular",
  "settings.global.iconWeight.bold": "Bold",

  // GlobalSettingsView — About
  "settings.global.about.title": "About",
  "settings.global.about.description":
    "AI-powered developer companion untuk pekerjaan repetitif — supaya kamu fokus membangun hal yang berarti.",
  "settings.global.about.name": "Name",
  "settings.global.about.version": "Version",
  "settings.global.about.dataDir": "Data dir",

  // LlmProvidersSettings
  "settings.llm.title": "LLM Providers",
  "settings.llm.description":
    "Provider LLM global, dipakai semua project (chat dan generate ticket).",
  "settings.llm.add": "Provider",
  "settings.llm.empty":
    "Belum ada provider LLM. Tambahkan minimal satu untuk chat dan generate ticket.",
  "settings.llm.newProvider": "Provider baru",

  // LlmProviderForm
  "settings.llm.form.kind": "Jenis provider",
  "settings.llm.form.kindCustom": "Custom (OpenAI-compatible)",
  "settings.llm.form.kindCursor": "Cursor SDK",
  "settings.llm.form.mode": "Mode",
  "settings.llm.form.apiKey": "API Key",
  "settings.llm.form.model": "Model (dari Cursor SDK)",
  "settings.llm.form.savedPlaceholder": "Tersimpan — isi untuk mengganti",
  "settings.llm.form.cursorKeyPlaceholder": "Cursor API key",
  "settings.llm.form.loadingModels": "Memuat model…",
  "settings.llm.form.needKey": "Isi API key dulu",
  "settings.llm.form.selectModel": "Pilih model",
  "settings.llm.form.modelsError": "Gagal memuat model: {message}",
  "settings.llm.form.modelsCount": "{count} model tersedia.",
  "settings.llm.form.cursorHint":
    "Cursor SDK memakai API key Cursor. Agent boleh membaca dan mengedit workspace; edit dijalankan pada salinan sementara lalu masuk ke Review aplikasi. Shell/delete dinonaktifkan.",
  "settings.llm.form.testConnection": "Test Connection",
  "settings.llm.form.confirmDelete": "Hapus provider ini?",

  // LlmProviderModelSelect
  "settings.llm.model.aria": "Pilih provider / model",
  "settings.llm.model.placeholder": "Provider",
  "settings.llm.model.loading": "Memuat model…",

  // RolesSettings
  "settings.roles.title": "Roles",
  "settings.roles.description":
    "Role menentukan persona dan provider LLM yang dipakai otomatis saat chat.",
  "settings.roles.add": "Role",
  "settings.roles.empty": "Belum ada role. Tambahkan role untuk persona + provider khusus.",
  "settings.roles.newRole": "Role baru",
  "settings.roles.form.name": "Nama",
  "settings.roles.form.description": "Deskripsi singkat",
  "settings.roles.form.descriptionPlaceholder": "opsional",
  "settings.roles.form.namePlaceholder": "mis. Backend Engineer",
  "settings.roles.form.persona": "Persona",
  "settings.roles.form.personaPlaceholder":
    "Kamu adalah senior backend engineer. Selalu pertimbangkan performa, keamanan, dan test…",
  "settings.roles.form.provider": "Provider LLM",
  "settings.roles.form.providerAria": "Provider role",
  "settings.roles.form.providerFollow": "Ikuti pilihan chat",
  "settings.roles.form.providerHint":
    "Jika dipilih, chat otomatis memakai provider ini saat role aktif.",
  "settings.roles.form.errorRequired": "Nama dan persona wajib diisi.",
  "settings.roles.form.confirmDelete": 'Hapus role "{name}"?',

  // PromptsSettings
  "settings.prompts.title": "Prompts",
  "settings.prompts.description":
    "Override system prompt global untuk mode Build dan Plan, plus prompt yang dipakai tombol Generate ticket di tab Document. Persona role (jika aktif) tetap ditambahkan di atas prompt chat.",
  "settings.prompts.loading": "Memuat prompts…",
  "settings.prompts.systemLabel": "SYSTEM PROMPT (Build)",
  "settings.prompts.planLabel": "PLAN PROMPT",
  "settings.prompts.ticketLabel": "PROMPT GENERATE TIKET (dokumen → tiket)",
  "settings.prompts.ticketHint":
    "Dipakai tombol Generate ticket di tab Document. Judul dan isi dokumen dikirim sebagai pesan user; teks ini adalah system prompt-nya.",
  "settings.prompts.resetDefault": "Reset ke default",
  "settings.prompts.custom": "Menggunakan prompt kustom.",
  "settings.prompts.default": "Menggunakan default.",
  "settings.prompts.saved": "Tersimpan.",
};
