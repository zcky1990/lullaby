import type { MessageDict } from "../../types";

/** Chat sidebar, composer, sesi, dan step agent. */
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
};
