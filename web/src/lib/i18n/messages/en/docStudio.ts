import type { MessageDict } from "../../types";

/**
 * Kamus menu Doc Studio (PRD/BRD/RFC/RCA/… terpandu AI).
 *
 * Key `nav.*` dan `settings.global.section.*` sengaja ikut di sini supaya
 * penambahan menu cukup satu berkas per bahasa.
 */
export const docStudio: MessageDict = {
  "nav.docStudio": "Doc Studio",
  "settings.global.section.docStudio": "Doc Studio",

  "docStudio.title": "Doc Studio",
  "docStudio.noProject": "Select a project to start a guided document.",
  "docStudio.noWorkspace":
    "Set the document workspace in Project Settings → Workspace before generating documents.",
  "docStudio.pickTitle": "Choose a document type",
  "docStudio.pickHint": "The AI interviews you first, then writes the document.",
  "docStudio.draftsTitle": "Saved interviews",
  "docStudio.noDrafts": "No interviews yet.",
  "docStudio.status.interviewing": "Interviewing",
  "docStudio.status.ready": "Ready",
  "docStudio.status.saved": "Saved",
  "docStudio.roleLabel": "Guided by {role}",
  "docStudio.roleNone": "No role configured",
  "docStudio.back": "Back",
  "docStudio.answerPlaceholder": "Type your answer…",
  "docStudio.send": "Send",
  "docStudio.sending": "Thinking…",
  "docStudio.finalize": "Generate document",
  "docStudio.finalizing": "Writing document…",
  "docStudio.readyHint": "Enough context collected — ready to generate.",
  "docStudio.openDocument": "Open {title}",
  "docStudio.savedAt": "Saved to {path}",
  "docStudio.startError": "Could not start the interview: {message}",
  "docStudio.turnError": "Could not send the answer: {message}",
  "docStudio.finalizeError": "Could not generate the document: {message}",
  "docStudio.loadError": "Could not load Doc Studio: {message}",
  "docStudio.deleteDraft": "Delete interview",
  "docStudio.emptyTranscript": "Preparing the first question…",

  "docStudio.error.llmNotConfigured":
    "No LLM provider yet — add one in Global Settings → LLM, then try again.",
  "docStudio.error.workspaceMissing":
    "This project has no document workspace. Set it in Project Settings → Workspace.",
  "docStudio.error.projectNotFound": "Project not found. Pick another project.",
  "docStudio.error.templateNotFound": "That document type no longer exists.",
  "docStudio.error.draftNotFound": "This interview is no longer available.",
  "docStudio.error.draftAlreadySaved": "This interview is already saved as a document.",
  "docStudio.error.unauthorized": "Session expired — reload the app.",
  "docStudio.error.invalidInput": "The server rejected the input — check the fields.",

  "docStudio.settings.title": "Doc Studio",
  "docStudio.settings.description":
    "Default role, provider, language, and per-type interview prompts for guided documents.",
  "docStudio.settings.defaultRole": "Default role",
  "docStudio.settings.defaultRoleHint":
    "The role persona is prepended to the interview prompt. A type can override it.",
  "docStudio.settings.defaultRoleNone": "No role",
  "docStudio.settings.defaultProvider": "Default provider",
  "docStudio.settings.defaultProviderHint":
    "Used when the selected role has no provider. Falls back to the first provider.",
  "docStudio.settings.providerAuto": "Follow role",
  "docStudio.settings.language": "Output language",
  "docStudio.settings.languageAuto": "Follow the user",
  "docStudio.settings.languageId": "Bahasa Indonesia",
  "docStudio.settings.languageEn": "English",
  "docStudio.settings.perType": "Per document type",
  "docStudio.settings.perTypeHint":
    "Override the role or the interview prompt for a specific document type.",
  "docStudio.settings.typeRole": "Role",
  "docStudio.settings.typePrompt": "Interview prompt",
  "docStudio.settings.typePromptPlaceholder": "Leave empty to use the built-in prompt.",
  "docStudio.settings.typeDefault": "default",
  "docStudio.settings.typeCustom": "custom",
  "docStudio.settings.resetPrompt": "Reset",
  "docStudio.settings.customTypes": "Custom document types",
  "docStudio.settings.customTypesHint":
    "Add your own types (max 20). Built-in types with the same id are overridden.",
  "docStudio.settings.newTypeId": "Id (a-z, -, _)",
  "docStudio.settings.newTypeLabel": "Label",
  "docStudio.settings.newTypeOutline": "Outline (one section per line)",
  "docStudio.settings.newTypeTopics": "Interview topics (one per line)",
  "docStudio.settings.addType": "Add type",
  "docStudio.settings.remove": "Remove",
  "docStudio.settings.save": "Save",
  "docStudio.settings.saving": "Saving…",
  "docStudio.settings.saved": "Saved.",
  "docStudio.settings.saveError": "Could not save: {message}",
  "docStudio.settings.loadError": "Could not load settings: {message}",
};
