import type { MessageDict } from "../../types";

/** Panel tiket, kanban, dan dialog detail/create. */
export const tickets: MessageDict = {
  // TicketPanel
  "tickets.panel.title": "Tickets",
  "tickets.panel.newTicket": "New ticket",
  "tickets.panel.refreshAria": "Refresh tickets",
  "tickets.panel.refreshTitle": "Refresh",
  "tickets.panel.filterAssignee": "Assignee filter",
  "tickets.panel.allUsers": "All users",
  "tickets.panel.unassigned": "Unassigned",
  "tickets.panel.hintPrefix":
    "Local and Jira tickets. Drag cards between columns to change status, or drag the grip on a card into the chat panel to use it as context. The ticket detail has a ",
  "tickets.panel.hintAction": "Work on ticket",
  "tickets.panel.hintSuffix": " button.",

  // TicketKanbanBoard
  "tickets.kanban.empty": "Empty",
  "tickets.kanban.dragAria": "Drag {key} to chat",
  "tickets.kanban.dragTitle": "Drag to chat",
  "tickets.kanban.syncError": "Sync error",
  "tickets.kanban.local": "Local",
  "tickets.kanban.unassigned": "Unassigned",
  "tickets.kanban.notSynced": "Not synced",

  // TicketCreateDialog
  "tickets.create.title": "New ticket",
  "tickets.create.description":
    "Saved locally first. You can sync it to Jira from the ticket detail.",
  "tickets.create.titleLabel": "Title",
  "tickets.create.titlePlaceholder": "e.g. Fix chat dropdown",
  "tickets.create.descriptionLabel": "Description",
  "tickets.create.descriptionPlaceholder":
    "Context, reproduction steps, or acceptance criteria…",
  "tickets.create.statusLabel": "Status",
  "tickets.create.statusAria": "Ticket status",
  "tickets.create.priorityLabel": "Priority",
  "tickets.create.priorityAria": "Ticket priority",
  "tickets.create.priorityNone": "None",
  "tickets.create.typeLabel": "Type",
  "tickets.create.typeAria": "Ticket type",
  "tickets.create.cancel": "Cancel",
  "tickets.create.submit": "Create ticket",

  // TicketDetailDialog
  "tickets.detail.titleRequired": "Ticket title is required.",
  "tickets.detail.deleteConfirm":
    "Delete ticket {key}? This action cannot be undone.",
  "tickets.detail.synced": "Synced",
  "tickets.detail.syncError": "Sync error",
  "tickets.detail.local": "Local",
  "tickets.detail.editTitle": "Edit ticket",
  "tickets.detail.loading": "Loading…",
  "tickets.detail.title": "Ticket detail",
  "tickets.detail.description": "Ticket {key} detail",
  "tickets.detail.workOnTicketHint": "Open chat and start working on this ticket",
  "tickets.detail.workOnTicket": "Work on ticket",
  "tickets.detail.edit": "Edit",
  "tickets.detail.syncProvider": "Sync provider",
  "tickets.detail.syncTo": "Sync to {provider}",
  "tickets.detail.openIn": "Open in {provider}",
  "tickets.detail.delete": "Delete",
  "tickets.detail.loadingDetail": "Loading ticket detail…",
  "tickets.detail.titleLabel": "Title",
  "tickets.detail.descriptionLabel": "Description",
  "tickets.detail.descriptionPlaceholder":
    "Context, reproduction steps, or acceptance criteria…",
  "tickets.detail.statusLabel": "Status",
  "tickets.detail.statusAria": "Ticket status",
  "tickets.detail.priorityLabel": "Priority",
  "tickets.detail.priorityAria": "Ticket priority",
  "tickets.detail.priorityNone": "None",
  "tickets.detail.typeLabel": "Type",
  "tickets.detail.typeAria": "Ticket type",
  "tickets.detail.syncedNotice":
    "This ticket is already synced to Jira — local changes are not pushed to Jira automatically.",
  "tickets.detail.assignee": "Assignee",
  "tickets.detail.reporter": "Reporter",
  "tickets.detail.typeField": "Type",
  "tickets.detail.updated": "Updated",
  "tickets.detail.labels": "Labels",
  "tickets.detail.descriptionSection": "Description",
  "tickets.detail.noDescription": "No description",
  "tickets.detail.cancel": "Cancel",
  "tickets.detail.save": "Save",
};
