import type { MessageDict } from "../../types";

/** Panel tiket, kanban, dan dialog detail/create. */
export const tickets: MessageDict = {
  // TicketPanel
  "tickets.panel.title": "Tickets",
  "tickets.panel.newTicket": "Tiket baru",
  "tickets.panel.refreshAria": "Refresh tickets",
  "tickets.panel.refreshTitle": "Refresh",
  "tickets.panel.filterAssignee": "Filter assignee",
  "tickets.panel.allUsers": "Semua user",
  "tickets.panel.unassigned": "Tanpa assignee",
  "tickets.panel.hintPrefix":
    "Tiket lokal dan Jira. Drag kartu antar kolom untuk mengubah status, atau seret grip di kartu ke panel chat untuk menjadikannya konteks. Detail tiket punya tombol ",
  "tickets.panel.hintAction": "Kerjakan tiket",
  "tickets.panel.hintSuffix": ".",

  // TicketKanbanBoard
  "tickets.kanban.empty": "Kosong",
  "tickets.kanban.dragAria": "Seret {key} ke chat",
  "tickets.kanban.dragTitle": "Seret ke chat",
  "tickets.kanban.syncError": "Sync error",
  "tickets.kanban.local": "Local",
  "tickets.kanban.unassigned": "Tanpa assignee",
  "tickets.kanban.notSynced": "Belum sync",

  // TicketCreateDialog
  "tickets.create.title": "Tiket baru",
  "tickets.create.description":
    "Disimpan lokal dulu. Sync ke Jira bisa dilakukan dari detail tiket.",
  "tickets.create.titleLabel": "Judul",
  "tickets.create.titlePlaceholder": "Mis. Perbaiki dropdown chat",
  "tickets.create.descriptionLabel": "Deskripsi",
  "tickets.create.descriptionPlaceholder":
    "Konteks, langkah reproduksi, atau acceptance criteria…",
  "tickets.create.statusLabel": "Status",
  "tickets.create.statusAria": "Status tiket",
  "tickets.create.priorityLabel": "Prioritas",
  "tickets.create.priorityAria": "Prioritas tiket",
  "tickets.create.priorityNone": "Tanpa",
  "tickets.create.typeLabel": "Tipe",
  "tickets.create.typeAria": "Tipe tiket",
  "tickets.create.cancel": "Batal",
  "tickets.create.submit": "Buat tiket",

  // TicketDetailDialog
  "tickets.detail.titleRequired": "Judul tiket wajib diisi.",
  "tickets.detail.deleteConfirm":
    "Hapus tiket {key}? Tindakan ini tidak bisa dibatalkan.",
  "tickets.detail.synced": "Synced",
  "tickets.detail.syncError": "Sync error",
  "tickets.detail.local": "Local",
  "tickets.detail.editTitle": "Edit tiket",
  "tickets.detail.loading": "Memuat…",
  "tickets.detail.title": "Detail tiket",
  "tickets.detail.description": "Detail tiket {key}",
  "tickets.detail.workOnTicketHint": "Buka chat dan mulai kerjakan tiket ini",
  "tickets.detail.workOnTicket": "Kerjakan tiket",
  "tickets.detail.edit": "Edit",
  "tickets.detail.syncProvider": "Provider sync",
  "tickets.detail.syncTo": "Sync ke {provider}",
  "tickets.detail.openIn": "Buka di {provider}",
  "tickets.detail.delete": "Hapus",
  "tickets.detail.loadingDetail": "Memuat detail tiket…",
  "tickets.detail.titleLabel": "Judul",
  "tickets.detail.descriptionLabel": "Deskripsi",
  "tickets.detail.descriptionPlaceholder":
    "Konteks, langkah reproduksi, atau acceptance criteria…",
  "tickets.detail.statusLabel": "Status",
  "tickets.detail.statusAria": "Status tiket",
  "tickets.detail.priorityLabel": "Prioritas",
  "tickets.detail.priorityAria": "Prioritas tiket",
  "tickets.detail.priorityNone": "Tanpa",
  "tickets.detail.typeLabel": "Tipe",
  "tickets.detail.typeAria": "Tipe tiket",
  "tickets.detail.syncedNotice":
    "Tiket sudah synced ke Jira — perubahan lokal tidak otomatis dikirim ke Jira.",
  "tickets.detail.assignee": "Assignee",
  "tickets.detail.reporter": "Reporter",
  "tickets.detail.typeField": "Type",
  "tickets.detail.updated": "Updated",
  "tickets.detail.labels": "Labels",
  "tickets.detail.descriptionSection": "Deskripsi",
  "tickets.detail.noDescription": "Tidak ada deskripsi",
  "tickets.detail.cancel": "Batal",
  "tickets.detail.save": "Simpan",
};
