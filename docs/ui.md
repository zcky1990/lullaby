# UI shell

Shell meniru VS Code: activity bar kiri, panel konteks, area tab utama, chat kanan, terminal bawah,
status bar.

## Activity bar

| Menu | Panel / perilaku |
| --- | --- |
| Workspace | `WorkspacePanel` — daftar & pilih project |
| Explorer | `FileTreePanel` — butuh `workspace_path`; tombol buat file/folder |
| Document | `DocumentPanel` — Local / Docmost / Notion / Confluence |
| Ticket | `TicketPanel` — filter + create/refresh; board full-height dengan scroll per kolom |
| Workflows | `WorkflowPanel` — daftar YAML, recent runs, create/refresh |
| Cron | `CronPanel` — jadwal `schedule`/`on`, toggle enable, docs wiki |
| Project Settings | `SettingsPanel` — section nav |
| Terminal | Toggle **bottom panel** (bukan tab utama) |
| Git | `GitPanel` — branches / refresh |
| Global Settings | `GlobalSettingsPanel` — section nav di aside |

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

## Terminal panel

`TerminalPanel` + `TerminalSession` (xterm.js + fit). Multi-session; tetap hidup saat panel
disembunyikan. WebSocket ke `/api/projects/:id/terminal`.

## Tema

`ThemeProvider`: light/dark/system, color preset, font app/editor, tema Monaco (auto mengikuti app).
Mermaid mengikuti tema yang sama.
