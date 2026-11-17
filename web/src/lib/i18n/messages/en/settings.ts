import type { MessageDict } from "../../types";

/** Global Settings + Project Settings + form integrasi/LLM. */
export const settings: MessageDict = {
  // GlobalSettingsPanel — side menu
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
  "settings.global.section.notifications": "Notifications",
  "settings.global.section.terminal": "Terminal",
  "settings.global.section.backup": "Backup & Restore",
  "settings.global.section.about": "About",

  // GlobalSettingsView — Appearance
  "settings.global.appearance.title": "Appearance",
  "settings.global.appearance.description": "App color theme and app font.",
  "settings.global.appearance.colorTheme": "Color theme",
  "settings.global.appearance.mode": "Mode",
  "settings.global.appearance.appFont": "App font",

  "settings.global.colorTheme.lullaby": "Lullaby",
  "settings.global.colorTheme.lullabyDescription":
    "Midnight indigo + soft gold — matches the brand icon",
  "settings.global.colorTheme.vscode": "VS Code",
  "settings.global.colorTheme.vscodeDescription": "VS Code look (blue, dark gray)",
  "settings.global.colorTheme.shadcn": "shadcn",
  "settings.global.colorTheme.shadcnDescription": "Neutral black and white",
  "settings.global.colorTheme.claude": "Claude",
  "settings.global.colorTheme.claudeDescription": "Warm cream with terracotta accents",
  "settings.global.colorTheme.supabase": "Supabase",
  "settings.global.colorTheme.supabaseDescription": "Emerald green with a dark feel",

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
  "settings.global.editor.description": "Theme, font, and text size of the code editor (Monaco).",
  "settings.global.editor.theme": "Editor theme",
  "settings.global.editor.font": "Editor font",
  "settings.global.editor.fontSize": "Font size",
  "settings.global.editor.fontSizeAria": "Editor font size",
  "settings.global.editor.typeScriptService": "TypeScript service",
  "settings.global.editor.typeScriptLabel": "Monaco built-in TypeScript/JavaScript IntelliSense",
  "settings.global.editor.typeScriptHint":
    "Turn this off when you use a language server (LSP) for TS/JS: the ~7 MB worker is not downloaded and the language service chunk is skipped. Syntax highlighting stays on; changes apply to editors opened after the app is reloaded.",

  "settings.global.editorTheme.auto": "Auto",
  "settings.global.editorTheme.light": "Light",
  "settings.global.editorTheme.dark": "Dark",
  "settings.global.editorTheme.hcDark": "HC Dark",
  "settings.global.editorTheme.hcLight": "HC Light",

  // GlobalSettingsView — Chat
  "settings.global.chat.title": "Chat",
  "settings.global.chat.description": "Font and text size for chat messages and input.",
  "settings.global.chat.font": "Chat font",
  "settings.global.chat.size": "Chat font size",
  "settings.global.chat.previewTitle": "Sample chat message",
  "settings.global.chat.previewBody": "These settings apply to chat messages and input.",

  // GlobalSettingsView — Icons
  "settings.global.icons.title": "Icons",
  "settings.global.icons.description": "Size and weight of interface icons.",
  "settings.global.icons.size": "Icon size",
  "settings.global.icons.weight": "Icon weight",
  "settings.global.iconSize.sm": "Compact",
  "settings.global.iconSize.md": "Normal",
  "settings.global.iconSize.lg": "Large",
  "settings.global.iconWeight.light": "Light",
  "settings.global.iconWeight.regular": "Regular",
  "settings.global.iconWeight.bold": "Bold",

  // GlobalSettingsView — About
  "settings.global.about.title": "About",
  "settings.global.about.description":
    "AI-powered developer companion for repetitive work — so you can focus on building things that matter.",
  "settings.global.about.name": "Name",
  "settings.global.about.version": "Version",
  "settings.global.about.dataDir": "Data dir",

  // LlmProvidersSettings
  "settings.llm.title": "LLM Providers",
  "settings.llm.description":
    "Global LLM providers, shared by every project (chat and ticket generation).",
  "settings.llm.add": "Provider",
  "settings.llm.empty": "No LLM provider yet. Add at least one for chat and ticket generation.",
  "settings.llm.newProvider": "New provider",

  // LlmProviderForm
  "settings.llm.form.kind": "Provider type",
  "settings.llm.form.kindCustom": "Custom (OpenAI-compatible)",
  "settings.llm.form.kindCursor": "Cursor SDK",
  "settings.llm.form.mode": "Mode",
  "settings.llm.form.apiKey": "API Key",
  "settings.llm.form.model": "Model (from Cursor SDK)",
  "settings.llm.form.savedPlaceholder": "Stored — enter a value to replace it",
  "settings.llm.form.cursorKeyPlaceholder": "Cursor API key",
  "settings.llm.form.loadingModels": "Loading models…",
  "settings.llm.form.needKey": "Enter an API key first",
  "settings.llm.form.selectModel": "Select model",
  "settings.llm.form.modelsError": "Failed to load models: {message}",
  "settings.llm.form.modelsCount": "{count} models available.",
  "settings.llm.form.cursorHint":
    "Cursor SDK uses a Cursor API key. The agent may read and edit the workspace; edits run on a temporary copy and then land in the app's Review. Shell/delete are disabled.",
  "settings.llm.form.testConnection": "Test Connection",
  "settings.llm.form.confirmDelete": "Delete this provider?",

  // LlmProviderModelSelect
  "settings.llm.model.aria": "Select provider / model",
  "settings.llm.model.placeholder": "Provider",
  "settings.llm.model.loading": "Loading models…",

  // RolesSettings
  "settings.roles.title": "Roles",
  "settings.roles.description":
    "A role decides the persona and LLM provider used automatically in chat.",
  "settings.roles.add": "Role",
  "settings.roles.empty": "No role yet. Add a role for a custom persona + provider.",
  "settings.roles.newRole": "New role",
  "settings.roles.form.name": "Name",
  "settings.roles.form.description": "Short description",
  "settings.roles.form.descriptionPlaceholder": "optional",
  "settings.roles.form.namePlaceholder": "e.g. Backend Engineer",
  "settings.roles.form.persona": "Persona",
  "settings.roles.form.personaPlaceholder":
    "You are a senior backend engineer. Always consider performance, security, and tests…",
  "settings.roles.form.provider": "LLM provider",
  "settings.roles.form.providerAria": "Role provider",
  "settings.roles.form.providerFollow": "Follow chat selection",
  "settings.roles.form.providerHint":
    "When selected, chat automatically uses this provider while the role is active.",
  "settings.roles.form.errorRequired": "Name and persona are required.",
  "settings.roles.form.confirmDelete": 'Delete role "{name}"?',

  // PromptsSettings
  "settings.prompts.title": "Prompts",
  "settings.prompts.description":
    "Override the global system prompt for Build and Plan modes. The role persona (if active) is still prepended to this prompt.",
  "settings.prompts.loading": "Loading prompts…",
  "settings.prompts.systemLabel": "SYSTEM PROMPT (Build)",
  "settings.prompts.planLabel": "PLAN PROMPT",
  "settings.prompts.resetDefault": "Reset to default",
  "settings.prompts.custom": "Using a custom prompt.",
  "settings.prompts.default": "Using the default.",
  "settings.prompts.saved": "Saved.",
};
