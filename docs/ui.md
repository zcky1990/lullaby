# UI shell

Shell meniru VS Code: activity bar kiri, panel konteks, area tab utama, chat kanan, terminal bawah,
status bar.

## Activity bar

| Menu             | Panel / perilaku                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| Workspace        | `WorkspacePanel` — daftar, buat, pilih, ganti nama (klik dua kali / ikon pensil), hapus project        |
| Explorer         | `FileTreePanel` — butuh `workspace_path`; tombol buat file/folder; file yang belum disimpan ditebalkan |
| Document         | `DocumentPanel` — Local / Docmost / Notion / Confluence                                                |
| Ticket           | `TicketPanel` — filter + create/refresh; board full-height dengan scroll per kolom                     |
| Workflows        | `WorkflowPanel` — daftar YAML, recent runs, create/refresh                                             |
| Cron             | `CronPanel` — jadwal `schedule`/`on`, toggle enable, docs wiki                                         |
| Project Settings | `SettingsPanel` — section nav (Workspace, Integrations, Activity, Backup & Restore)                    |
| Terminal         | Toggle **bottom panel** (bukan tab utama)                                                              |
| Git              | `GitPanel` — branches / refresh                                                                        |
| Global Settings  | `GlobalSettingsPanel` — section nav di aside (termasuk Backup & Restore)                               |

File dan dokumen terbuka sebagai **tab dinamis**. Menu Workspace / Ticket / Settings / Git / Global
membuka **singleton tab**.

Shortcut shell: `Cmd/Ctrl+P` (Quick Open), `Cmd/Ctrl+S` (simpan file), `Cmd/Ctrl+Shift+V` (preview
markdown), dan `Cmd/Ctrl+Shift+F` (toggle layout deep work — lihat di bawah).

## Area utama (`TabsBar`)

Jenis tab: `workspace` | `ticket` | `workflow` | `workflow-docs` | `cron` | `cron-docs` | `settings`
| `global` | `document` | `file` | `review` | `git`.

- **File**: Monaco (lazy), dirty flag, simpan tombol / `Cmd|Ctrl+S` → `PUT .../files/content`
- **Document**: Markdown preview + Edit (lokal/Docmost); Notion/Confluence read-only
- **Review**: review perubahan `write_file` dari chat (accept/reject hunk, atau keep/revert bila
  perubahan sudah diterapkan)
- **Ticket**: Kanban board
- **Git**: Changes + History
- **Workflow**: editor YAML + DAG (React Flow) + run history/step logs
- **Cron**: daftar jadwal + toggle; **Cron Docs** / **Workflow Docs** = wiki markdown in-app

Menu Workflows membuka tab home; klik file workflow di panel membuka tab `workflow:<project>:<slug>`
(dinamis). Menu Cron membuka singleton `cron` + panel jadwal.

State tab: `web/src/hooks/useEditorTabs.ts`, dikelola dari `App.tsx`.

## Layout deep work (Kanban + Chat)

Mode tampilan minimal untuk sesi fokus panjang: hanya area tab (Kanban) + chat sidebar.

- State: `web/src/lib/layout-mode.ts` (`standard` | `focus`, localStorage `rnd.layout:v1`), dibaca
  komponen lewat `web/src/hooks/useLayoutMode.ts` (`useSyncExternalStore`).
- Toggle: tombol **deep work** di `WindowToolbar` (ikon maximize/minimize) atau
  `Cmd/Ctrl+Shift+F` (`installLayoutShortcut`, didaftarkan di `web/src/main.tsx` sebelum React
  mount dan memakai `stopImmediatePropagation` sehingga menang atas handler lama Find).
- Saat aktif: `data-layout="focus"` dipasang di `<html>`; `web/src/focus-layout.css` menyembunyikan
  activity bar, panel kiri (semua `aside` kecuali chat), `TabsBar`, dan status bar. Chat dibuka
  otomatis (`rnd:chat-open-request`) dan tab Ticket difokuskan lewat item activity bar yang sama
  dengan klik user.
- Sifatnya presentasional: bila selector CSS tidak cocok lagi, chrome hanya tetap terlihat (shell
  tidak error). Panel Global Settings (termasuk section Layout) ikut tersembunyi saat mode aktif,
  jadi keluar lewat tombol toolbar atau shortcut.
- Default `standard`; nilai disimpan lokal per mesin (tidak ikut export/import config).
- Section pengaturan: **Global Settings → Appearance → Layout**. Tests: `web/src/lib/layout-mode.test.ts`.

## Explorer — penanda perubahan & context menu

Explorer menandai dua jenis perubahan:

1. **Belum disimpan (dirty)** — tab editor dengan isi Monaco berbeda dari disk (`dirty-paths.ts`).
   File: `font-semibold` + dot `bg-primary`. Folder induk ikut lebih terang bila ada anak dirty.
2. **Git** — dari `gitStatus` (dimuat saat panel Explorer/Git dibuka). Modified = biru (`M`),
   untracked/baru = amber (`U`). Folder induk mewarisi warna bila berisi file berubah
   (`explorer-marks.ts`).

Klik kanan (context menu):

- **File baru** / **Folder baru** (juga di toolbar)
- **Cut** / **Copy** / **Paste** (clipboard in-app; Paste ke folder yang diklik atau root)
- **Delete** (konfirmasi; file atau folder rekursif)

API: `POST /files` create, `DELETE /files` hapus, `POST /files/move`, `POST /files/copy`.

## Chat sidebar

Tombol **Chat** di header. Fitur:

- Mode **Plan** / **Build** (disimpan di localStorage)
- Provider / role / variant (Low–High)
- Sesi chat (baru, load, hapus)
- Lampiran gambar/teks/path workspace
- Slash skill `/nama-skill`
- Event `rnd:auto-build` untuk automation
- Aksi **Kerjakan tiket** di dialog detail tiket
- Collapsible **Perubahan file** setelah chat selesai

### Drag & drop ke chat

Semua sumber drag memakai kontrak di `web/src/lib/chat-drag.ts`:

| Sumber                            | MIME                               | Hasil di chat                       |
| --------------------------------- | ---------------------------------- | ----------------------------------- |
| File di `FileTreePanel`           | `application/x-rnd-workspace-path` | lampiran `workspace` (path)         |
| Dokumen lokal di `DocumentPanel`  | `application/x-rnd-chat-document`  | lampiran teks berisi isi `.md`      |
| Dokumen Docmost/Notion/Confluence | `application/x-rnd-chat-document`  | lampiran teks berisi konten halaman |
| Kartu tiket (`TicketKanban`)      | `application/x-rnd-chat-ticket`    | lampiran teks berisi detail tiket   |
| File dari OS / clipboard          | `Files`                            | lampiran gambar/teks                |

- Isi dokumen/tiket diambil saat **drop** (`web/src/lib/chat-context.ts`) lalu dikirim sebagai
  lampiran `{ type: "text" }`; maksimal 6 lampiran, konteks dipotong di 180k karakter.
- `dragstart` memancarkan `rnd:chat-open-request`; `WindowToolbar` meneruskannya ke toggle chat
  milik `App`, jadi panel chat otomatis terbuka saat item diseret.
- Node `space:` (placeholder Docmost) tidak bisa diseret.
- Kartu tiket tetap memakai dnd-kit untuk pindah kolom. Drag ke chat memakai grip kecil di pojok
  kartu yang `pointerdown`-nya di-`stopPropagation` agar sensor kanban tidak aktif, sehingga drag
  HTML5 native bisa berjalan.

### Kerjakan tiket

Dialog detail tiket punya tombol **Kerjakan tiket**:

1. dialog ditutup (dialog modal memblokir area chat),
2. `rnd:chat-open-request` membuka panel chat,
3. `rnd:auto-build` mengirim prompt `buildAutoBuildPrompt` (mode Build, sesi baru).

### Daftar file yang berubah (collapsible)

Setelah chat selesai (`status: "done"`), pesan asisten menyimpan `changes` (`FileChange[]`) dan
menampilkan collapsible **Perubahan file** — komponen `web/src/components/ChatChangesList.tsx`:

- Header collapsible (default **tertutup**): jumlah file, ringkasan “n baru, m diubah”, total
  `+added` / `−removed`. Klik header untuk membuka/menutup.
- Satu baris per path (font mono, `truncate`, `title` = path lengkap): ikon `FilePlus2` untuk file
  **baru**, `FileCode2` untuk file **diubah**, label aksi, dan angka +/−.
- **Klik baris** → `dispatchChangesApplied([path])` (`web/src/lib/review-events.ts`). `App.tsx`
  sudah menangani event itu dengan `openFile(path, true)`, sehingga file dibuka/difokuskan sebagai
  **tab editor** dan isinya di-refresh dari disk.
- Normalisasi & dedupe path: `web/src/lib/chat-changes.ts` (path sama digabung, aksi `create`
  dipertahankan, angka memakai kondisi akhir file).
- Daftar juga tampil saat sesi lama dibuka, karena `changes` per pesan disimpan di DB
  (`GET /api/projects/:id/chat/sessions/:sessionId`).
- Perubahan yang masih menunggu persetujuan (mode review **Sebelum diterapkan**) tidak masuk daftar
  ini; pakai tombol **Buka review** di chat.

## Review perubahan AI

Global Settings → Tools punya dua pengaturan yang menentukan kapan `write_file` direview
(`src/server/chat/settings.ts`, `app_settings`):

| `auto_approve_writes` | `chat_write_review_mode` | Perilaku                                                                                                             |
| --------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| on                    | —                        | tulis langsung ke disk, tanpa Review tab                                                                             |
| off                   | `end` (**default**)      | tulis langsung selama agent bekerja, semua perubahan dikumpulkan lalu direview saat chat selesai — **tidak memblok** |
| off                   | `before`                 | agent berhenti (`status: approval_required`) dan menunggu accept/reject per hunk sebelum menulis                     |

Mode `end` (deferred review) **tidak** memunculkan prompt izin per-tool: `write_file` dan tool
read-only dikecualikan oleh `src/server/chat/approval.ts` (`needsToolPermission`), jadi satu-satunya
interaksi adalah kartu review di akhir.

Mode `end` (deferred review):

- Selama run, setiap `write_file` langsung diterapkan ke disk dan dicatat sebagai entri review
  (`run.pendingChanges`, `applied: true`, semua hunk sudah `accepted`). Langkah chat menampilkan
  “Diterapkan: `<path>`”.
- Saat run selesai, respons `done` membawa `runId`, `pendingChanges`, dan `reviewDeferred: true`.
  Run tetap di memori selama masih ada hunk belum di-settle (TTL 24 jam dari `finishedAt`); run
  tanpa antrean review dihapus setelah 10 menit. Restart app menghapus state Review (lihat
  `docs/improvements.md` REL-1).
- Chat menampilkan kartu **Perubahan sudah diterapkan** (ringkasan file, mis.
  `2 file (1 baru, 1 diubah) · +12 · −3`) dengan tombol **Review & revert**; tab Review dibuat di
  latar belakang lewat event `rnd:chat-review` (tanpa merebut fokus tab aktif) dan bisa
  dibuka/ditutup tanpa menghentikan chat.
- Di tab Review, tombol berubah menjadi **Keep** / **Revert** (semua hunk sudah `accepted`).
  **Revert** menulis ulang file dari `before` + hunk yang di-keep, jadi bisa revert sebagian hunk.
  File baru yang seluruhnya di-revert akan dihapus.
- Revert hanya dijalankan bila isi file di disk masih sama dengan hasil tulisan AI; bila file sudah
  diubah manual setelahnya, revert dilewati dan alasannya dikirim sebagai pesan chat.
- Beberapa `write_file` ke path yang sama digabung menjadi satu entri review (diff kumulatif dari
  kondisi sebelum chat).
- Bila masih ada entri yang belum direview, respons berikutnya juga bertanda `reviewDeferred`
  sehingga tab Review tetap sinkron. Setelah semua hunk diputuskan, run dihapus dan tab Review
  ditutup.

## Workspace (nama project)

`WorkspacePanel` bisa mengganti nama project tanpa keluar dari panel:

- **Klik dua kali** baris project, atau klik ikon **pensil** (muncul saat hover).
- Input inline: `Enter` simpan, `Escape` batal, tombol ✓ / ✕.
- Nama baru dikirim lewat `PUT /api/projects/:id` (`{ name }`), daftar project langsung diperbarui.
- Nama di header/toolbar mengikuti data detail project yang dimuat ulang saat project diganti.

## Backup & restore

Dua tempat, komponen yang sama (`web/src/components/BackupSettings.tsx`):

| Lokasi           | Section          | Cakupan                                                                                                                         |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Global Settings  | Backup & Restore | Seluruh config (`app_settings`, LLM provider, role, integrasi) + database (project, tiket lokal, dokumen lokal, chat, workflow) |
| Project Settings | Backup & Restore | Integration config project + data milik project tersebut                                                                        |

Alur UI:

1. **Export** — toggle “Sertakan nilai rahasia” (default mati → nilai diganti `••••••••`), lalu
   **Unduh backup** (`web/src/lib/backup.ts` membuat blob JSON) atau **Simpan ke folder backup**
   (`?save=1` → server menulis `<data dir>/backups/<file>.json`, path ditampilkan di UI).
2. **Import** — pilih file `.json` (divalidasi `format`/`scope` di klien), mode **Merge** (upsert)
   atau **Replace** (hapus data scope lebih dulu, butuh konfirmasi), lalu **Import**.
3. Setelah import global, tombol **Muat ulang aplikasi** muncul karena state UI di memori belum
   menyesuaikan.

Catatan: import project menyalin tiket/sesi chat/workflow run dengan id baru sehingga data lama
tidak tertimpa. Import tanpa menyertakan rahasia akan menyisakan nilai `••••••••` yang perlu diisi
ulang di form integrasi.

## Terminal panel

`TerminalPanel` + `TerminalSession` (xterm.js + fit). Multi-session; tetap hidup saat panel
disembunyikan. WebSocket ke `/api/projects/:id/terminal`.

## Tema

`ThemeProvider`: light/dark/system, color preset, font app/editor, tema Monaco (auto mengikuti app).
Mermaid mengikuti tema yang sama.
