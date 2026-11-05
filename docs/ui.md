# UI shell

Shell meniru VS Code: activity bar kiri, panel konteks, area tab utama, chat kanan, terminal bawah,
status bar.

## Activity bar

| Menu | Panel / perilaku |
| --- | --- |
| Workspace | `WorkspacePanel` — daftar, buat, pilih, ganti nama (klik dua kali / ikon pensil), hapus project |
| Explorer | `FileTreePanel` — butuh `workspace_path`; tombol buat file/folder |
| Document | `DocumentPanel` — Local / Docmost / Notion / Confluence |
| Ticket | `TicketPanel` — filter + create/refresh; board full-height dengan scroll per kolom |
| Workflows | `WorkflowPanel` — daftar YAML, recent runs, create/refresh |
| Cron | `CronPanel` — jadwal `schedule`/`on`, toggle enable, docs wiki |
| Project Settings | `SettingsPanel` — section nav (Workspace, Integrations, Activity, Backup & Restore) |
| Terminal | Toggle **bottom panel** (bukan tab utama) |
| Git | `GitPanel` — branches / refresh |
| Global Settings | `GlobalSettingsPanel` — section nav di aside (termasuk Backup & Restore) |

File dan dokumen terbuka sebagai **tab dinamis**. Menu Workspace / Ticket / Settings / Git / Global
membuka **singleton tab**.

## Area utama (`TabsBar`)

Jenis tab: `workspace` | `ticket` | `workflow` | `workflow-docs` | `cron` | `cron-docs` |
`settings` | `global` | `document` | `file` | `review` | `git`.

- **File**: Monaco (lazy), dirty flag, simpan tombol / `Cmd|Ctrl+S` → `PUT .../files/content`
- **Document**: Markdown preview + Edit (lokal/Docmost); Notion/Confluence read-only
- **Review**: accept/reject hunk dari chat `write_file`
- **Ticket**: Kanban board
- **Git**: Changes + History
- **Workflow**: editor YAML + DAG (React Flow) + run history/step logs
- **Cron**: daftar jadwal + toggle; **Cron Docs** / **Workflow Docs** = wiki markdown in-app

Menu Workflows membuka tab home; klik file workflow di panel membuka tab `workflow:<project>:<slug>`
(dinamis). Menu Cron membuka singleton `cron` + panel jadwal.

State tab: `web/src/hooks/useEditorTabs.ts`, dikelola dari `App.tsx`.

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

| Sumber | MIME | Hasil di chat |
| --- | --- | --- |
| File di `FileTreePanel` | `application/x-rnd-workspace-path` | lampiran `workspace` (path) |
| Dokumen lokal di `DocumentPanel` | `application/x-rnd-chat-document` | lampiran teks berisi isi `.md` |
| Dokumen Docmost/Notion/Confluence | `application/x-rnd-chat-document` | lampiran teks berisi konten halaman |
| Kartu tiket (`TicketKanban`) | `application/x-rnd-chat-ticket` | lampiran teks berisi detail tiket |
| File dari OS / clipboard | `Files` | lampiran gambar/teks |

- Isi dokumen/tiket diambil saat **drop** (`web/src/lib/chat-context.ts`) lalu dikirim sebagai
  lampiran `{ type: "text" }`; maksimal 6 lampiran, konteks dipotong di 180k karakter.
- `dragstart` memancarkan `rnd:chat-open-request`; `WindowToolbar` meneruskannya ke toggle chat milik
  `App`, jadi panel chat otomatis terbuka saat item diseret.
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
- Perubahan yang masih menunggu persetujuan tidak masuk daftar ini (pakai tombol **Buka review** /
  tombol accept di langkah chat).

## Workspace (nama project)

`WorkspacePanel` bisa mengganti nama project tanpa keluar dari panel:

- **Klik dua kali** baris project, atau klik ikon **pensil** (muncul saat hover).
- Input inline: `Enter` simpan, `Escape` batal, tombol ✓ / ✕.
- Nama baru dikirim lewat `PUT /api/projects/:id` (`{ name }`), daftar project langsung diperbarui.
- Nama di header/toolbar mengikuti data detail project yang dimuat ulang saat project diganti.

## Backup & restore

Dua tempat, komponen yang sama (`web/src/components/BackupSettings.tsx`):

| Lokasi | Section | Cakupan |
| --- | --- | --- |
| Global Settings | Backup & Restore | Seluruh config (`app_settings`, LLM provider, role, integrasi) + database (project, tiket lokal, dokumen lokal, chat, workflow) |
| Project Settings | Backup & Restore | Integration config project + data milik project tersebut |

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
