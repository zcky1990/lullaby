import type { MessageDict } from "../../types";

/** Chat sidebar, composer, sessions, and agent steps. */
export const chat: MessageDict = {
  "chat.activity.title": "Activity",
  "chat.activity.empty": "No activity yet.",
  "chat.skillMenu.label": "Select a skill",
  "chat.skillMenu.empty": "No matching skill.",
  "chat.addToChat.title": "Add to chat",
  "chat.addToChat.description":
    "The selection will be attached to the active chat. Write a prompt then press Enter.",
  "chat.addToChat.source": " Source: {source}.",
  "chat.addToChat.emptySelection": "(empty selection)",
  "chat.addToChat.placeholder": "Prompt for the chat… (Enter sends it to the composer)",
  "chat.addToChat.cancel": "Cancel",
  "chat.addToChat.submit": "Add to chat",
  "chat.addToChat.selection": "Selection",
  "chat.changes.title": "File changes",
  "chat.changes.show": "Show file list",
  "chat.changes.hide": "Hide file list",
  "chat.changes.created": "{count} new",
  "chat.changes.updated": "{count} modified",
  "chat.changes.action.create": "new",
  "chat.changes.action.update": "modified",
  "chat.changes.openTitle": "Open {path} in a tab ({action})",
  "chat.changes.pathWithAction": "{path} ({action})",
  "chat.changes.openAria": "Open {path} in a tab",

  // Chat sessions
  "chat.sessions.new": "New chat",
  "chat.sessions.newPlaceholder": "New chat",
  "chat.sessions.selectAria": "Chat session",
  "chat.sessions.deleteAria": "Delete chat session",
  "chat.sessions.deleteConfirm": "Delete this chat session?",

  // Empty panel & resize
  "chat.empty.intro":
    "Start a chat with the LLM. Attach images/text files, or drag files, documents, and tickets from the left panel here as context. The app can read/write files in the workspace — every edit is applied immediately and can be reviewed or reverted once the chat finishes.",
  "chat.resize.aria": "Resize chat",
  "chat.resize.title": "Drag to resize",

  // Drag & drop
  "chat.drag.drop": "Drop files, documents, or tickets here",

  // Model variants
  "chat.variant.low": "Low",
  "chat.variant.medium": "Medium",
  "chat.variant.high": "High",

  // Agent steps
  "chat.steps.allowOnce": "Allow once",
  "chat.steps.alwaysAllow": "Always allow",
  "chat.steps.deny": "No",
  "chat.steps.working": "Working…",

  // Chat change review
  "chat.review.pendingTitle": "Changes waiting for review",
  "chat.review.pendingHint": "The diff and accept/reject buttons are available in the editor tab.",
  "chat.review.open": "Open review",
  "chat.review.appliedTitle": "Changes have been applied",
  "chat.review.closeAria": "Close the change review",
  "chat.review.appliedHint": "{summary} · you can keep chatting",
  "chat.review.revert": "Review & revert",

  // Context & attachments
  "chat.context.loading": "Reading documents/tickets…",
  "chat.attachment.remove": "Remove {name}",
  "chat.attachment.readFailed": "Failed to read the file.",
  "chat.attachment.unsupportedType": "Unsupported file type: {name}",
  "chat.attachment.unsupportedImage": "Unsupported image type (use PNG/JPEG/GIF/WebP): {name}",
  "chat.attachment.imageTooLarge": "Image too large (max 3 MB): {name}",
  "chat.attachment.textTooLarge": "Text file too large (max 200 KB): {name}",

  // Composer
  "chat.composer.role": "Role",
  "chat.composer.roleAria": "Chat role",
  "chat.composer.roleNone": "No role",
  "chat.composer.removeSkillAria": "Remove skill",
  "chat.composer.placeholder": "Write a message… /skill-name · Enter to send",
  "chat.composer.placeholderPending": "Resolve the approval first…",
  "chat.composer.attachAria": "Attach a file",
  "chat.composer.attachTitle": "Attach an image/file — or drag a file from the Explorer",
  "chat.composer.modeAria": "Chat mode",
  "chat.composer.providerAria": "Pick a provider / model",
  "chat.composer.providerPlaceholder": "Provider",
  "chat.composer.providerLocked": "The provider is set by the role",
  "chat.composer.modelsLoading": "Loading models…",
  "chat.composer.variantAria": "Model variant",
  "chat.composer.variantPlaceholder": "Variant",
  "chat.composer.followSkill": "Follow the /{skill} skill.",
  "chat.composer.seeAttachment": "See the attachment.",

  // Errors
  "chat.error.pickProjectFirst": "Pick a project first.",
  "chat.error.maxAttachments": "At most {count} attachments per message.",
  "chat.error.noProvider": "No LLM provider yet (Global Settings → LLM Providers).",
  "chat.error.generic": "Something went wrong.",

  // /autoskill
  "chat.autoskill.running": "Running `npx autoskills` in the workspace… (this can take a while)",
  "chat.autoskill.dryRunDone": "Dry run finished.",
  "chat.autoskill.done": "Autoskills finished.",
  "chat.autoskill.skills": "Workspace skills ({count}): {list}",
  "chat.autoskill.none": "No new workspace skill detected (check the CLI output).",
  "chat.autoskill.failed": "Failed: {error}",
};
