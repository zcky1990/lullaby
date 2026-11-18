import type { MessageDict } from "../../types";

/** Chat sidebar, composer, sesi, dan step agent. */
export const chat: MessageDict = {
  "chat.activity.title": "Activity",
  "chat.activity.empty": "Belum ada aktivitas.",
  "chat.skillMenu.label": "Pilih skill",
  "chat.skillMenu.empty": "Tidak ada skill yang cocok.",
  "chat.addToChat.title": "Tambah ke chat",
  "chat.addToChat.description": "Seleksi akan dilampirkan ke chat aktif. Tulis prompt lalu Enter.",
  "chat.addToChat.source": " Sumber: {source}.",
  "chat.addToChat.emptySelection": "(seleksi kosong)",
  "chat.addToChat.placeholder": "Prompt untuk chat… (Enter kirim ke composer)",
  "chat.addToChat.cancel": "Batal",
  "chat.addToChat.submit": "Tambah ke chat",
  "chat.addToChat.selection": "Seleksi",
  "chat.changes.title": "Perubahan file",
  "chat.changes.show": "Tampilkan daftar file",
  "chat.changes.hide": "Sembunyikan daftar file",
  "chat.changes.created": "{count} baru",
  "chat.changes.updated": "{count} diubah",
  "chat.changes.action.create": "baru",
  "chat.changes.action.update": "diubah",
  "chat.changes.openTitle": "Buka {path} di tab ({action})",
  "chat.changes.pathWithAction": "{path} ({action})",
  "chat.changes.openAria": "Buka {path} di tab",

  // Sesi chat
  "chat.sessions.new": "Chat baru",
  "chat.sessions.newPlaceholder": "Chat baru",
  "chat.sessions.selectAria": "Sesi chat",
  "chat.sessions.deleteAria": "Hapus sesi chat",
  "chat.sessions.deleteConfirm": "Hapus sesi chat?",

  // Panel kosong & resize
  "chat.empty.intro":
    "Mulai chat dengan LLM. Lampirkan gambar/file teks, atau seret file, dokumen, dan tiket dari panel kiri ke sini sebagai konteks. Aplikasi dapat membaca/menulis file di workspace — setiap edit langsung diterapkan lalu bisa di-review atau di-revert setelah chat selesai.",
  "chat.resize.aria": "Resize chat",
  "chat.resize.title": "Drag to resize",

  // Drag & drop
  "chat.drag.drop": "Lepaskan file, dokumen, atau tiket di sini",

  // Varian model
  "chat.variant.low": "Low",
  "chat.variant.medium": "Medium",
  "chat.variant.high": "High",

  // Step agent
  "chat.steps.allowOnce": "Izinkan sekali",
  "chat.steps.alwaysAllow": "Selalu izinkan",
  "chat.steps.deny": "Tidak",
  "chat.steps.working": "Bekerja…",

  // Review perubahan dari chat
  "chat.review.pendingTitle": "Perubahan menunggu review",
  "chat.review.pendingHint": "Diff dan tombol accept/reject tersedia di tab editor.",
  "chat.review.open": "Buka review",
  "chat.review.appliedTitle": "Perubahan sudah diterapkan",
  "chat.review.closeAria": "Tutup review perubahan",
  "chat.review.appliedHint": "{summary} · chat tetap bisa dilanjutkan",
  "chat.review.revert": "Review & revert",

  // Konteks & lampiran
  "chat.context.loading": "Membaca dokumen/tiket…",
  "chat.attachment.remove": "Hapus {name}",
  "chat.attachment.readFailed": "Gagal membaca file.",
  "chat.attachment.unsupportedType": "Tipe file tidak didukung: {name}",
  "chat.attachment.unsupportedImage":
    "Tipe gambar tidak didukung (pakai PNG/JPEG/GIF/WebP): {name}",
  "chat.attachment.imageTooLarge": "Gambar terlalu besar (maks 3 MB): {name}",
  "chat.attachment.textTooLarge": "File teks terlalu besar (maks 200 KB): {name}",

  // Composer
  "chat.composer.role": "Role",
  "chat.composer.roleAria": "Role chat",
  "chat.composer.roleNone": "Tanpa role",
  "chat.composer.removeSkillAria": "Hapus skill",
  "chat.composer.placeholder": "Tulis pesan… /skill-name · Enter kirim",
  "chat.composer.placeholderPending": "Selesaikan persetujuan dulu…",
  "chat.composer.attachAria": "Lampirkan file",
  "chat.composer.attachTitle": "Lampirkan gambar/file — atau seret file dari Explorer",
  "chat.composer.modeAria": "Mode chat",
  "chat.composer.providerAria": "Pilih provider / model",
  "chat.composer.providerPlaceholder": "Provider",
  "chat.composer.providerLocked": "Provider ditentukan oleh role",
  "chat.composer.modelsLoading": "Memuat model…",
  "chat.composer.variantAria": "Variant model",
  "chat.composer.variantPlaceholder": "Variant",
  "chat.composer.followSkill": "Ikuti skill /{skill}.",
  "chat.composer.seeAttachment": "Lihat lampiran.",

  // Error
  "chat.error.pickProjectFirst": "Pilih project dulu.",
  "chat.error.maxAttachments": "Maksimal {count} lampiran per pesan.",
  "chat.error.noProvider": "Belum ada provider LLM (Global Settings → LLM Providers).",
  "chat.error.generic": "Terjadi kesalahan.",

  // /autoskill
  "chat.autoskill.running":
    "Menjalankan `npx autoskills` di workspace… (bisa beberapa menit)",
  "chat.autoskill.dryRunDone": "Dry-run selesai.",
  "chat.autoskill.done": "Autoskills selesai.",
  "chat.autoskill.skills": "Skill workspace ({count}): {list}",
  "chat.autoskill.none": "Tidak ada skill workspace baru terdeteksi (cek output CLI).",
  "chat.autoskill.failed": "Gagal: {error}",
};
