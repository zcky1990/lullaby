import type { MessageDict } from "../../types";

/** Panel dokumen lokal + Docmost/Notion/Confluence. */
export const documents: MessageDict = {
  // DocumentPanel
  "documents.panel.title": "Documents",
  "documents.panel.add": "Add document",
  "documents.panel.refresh": "Refresh documents",
  "documents.panel.local": "Local",
  "documents.panel.createHintLocal":
    "The new document is saved as a .md file in the document workspace.",
  "documents.panel.createHintNotionChild":
    "New Notion page as a child of the selected page.",
  "documents.panel.createHintNotionRoot":
    "New Notion page under the integration's parentPageId (required).",
  "documents.panel.createHintConfluenceChild":
    "New Confluence page under the selected space/page.",
  "documents.panel.createHintConfluenceRoot":
    "New Confluence page in the integration's spaceKey (required).",
  "documents.panel.createHintDocmostChild":
    "The new document will be created as a sub-page of the selected document.",
  "documents.panel.createHintDocmostRoot":
    "The new document will be created in this project's Docmost space.",
  "documents.panel.titleLabel": "Title",
  "documents.panel.titlePlaceholder": "Document title…",
  "documents.panel.cancel": "Cancel",
  "documents.panel.create": "Create",
  "documents.panel.noProject": "Select a project first in the Workspace menu.",
  "documents.panel.loadingLocal": "Loading local documents…",
  "documents.panel.localNotConfigured":
    "The document workspace is not configured yet (Project Settings → Workspace). Set a markdown folder to store local documents.",
  "documents.panel.localEmpty":
    "No local documents yet. Click the + button to create one.",
  "documents.panel.dragHint": "Drag a document into the chat panel to use it as context.",
  "documents.panel.dragTitle": "{path} · drag to chat",
  "documents.panel.synced": "Synced",
  "documents.panel.error": "Error",
  "documents.panel.loading": "Loading documents…",
  "documents.panel.notConfigured":
    "The {source} integration is not configured yet (Project Settings → Integrations).",
  "documents.panel.emptyNotionPrefix":
    "No pages yet. Make sure the integration has access to the page, or fill in ",
  "documents.panel.emptyNotionAction": "Parent Page ID",
  "documents.panel.emptyNotionSuffix": " in Project Settings.",
  "documents.panel.emptyConfluencePrefix": "No documents yet. Fill in ",
  "documents.panel.emptyConfluenceAction": "Space Key",
  "documents.panel.emptyConfluenceSuffix":
    " in Project Settings or expand a space in the tree.",
  "documents.panel.emptyDocmostPrefix": "No documents yet. Fill in ",
  "documents.panel.emptyDocmostAction": "Space ID",
  "documents.panel.emptyDocmostSuffix":
    " (the space id, not the name) in Project Settings → Integrations.",
  "documents.panel.collapse": "Collapse",
  "documents.panel.expand": "Expand",
  "documents.panel.nodeDragTitle": "{title} · drag to chat",
  "documents.panel.noChildren": "No sub-pages.",

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
  "documents.richText.clearFormat": "Clear formatting",
  "documents.richText.ariaLabel": "Rich text editor",
};
