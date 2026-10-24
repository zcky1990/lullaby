# UI shell

Shell meniru VS Code: activity bar kiri, panel konteks, area tab utama, chat kanan, terminal bawah,
status bar.

## Activity bar

| Menu | Panel / perilaku |
| --- | --- |
| Workspace | `WorkspacePanel` — daftar & pilih project |
| Explorer | `FileTreePanel` — butuh `workspace_path` |
| Document | `DocumentPanel` — Local / Docmost / Notion / Confluence |
| Ticket | `TicketPanel` — filter, create, refresh |
| Project Settings | `SettingsPanel` — section nav |
| Terminal | Toggle **bottom panel** (bukan tab utama) |
| Git | `GitPanel` — branches / refresh |
| Global Settings | `GlobalSettingsPanel` — section nav di aside |

File dan dokumen terbuka sebagai **tab dinamis**. Menu Workspace / Ticket / Settings / Git / Global
membuka **singleton tab**.

## Area utama (`TabsBar`)

Jenis tab: `workspace` | `ticket` | `settings` | `global` | `document` | `file` | `review` | `git`.

- **File**: Monaco (lazy), dirty flag, simpan tombol / `Cmd|Ctrl+S` → `PUT .../files/content`
- **Document**: Markdown preview + Edit (lokal/Docmost); Notion/Confluence read-only
- **Review**: accept/reject hunk dari chat `write_file`
- **Ticket**: Kanban board
- **Git**: Changes + History

State tab: `web/src/hooks/useEditorTabs.ts`, dikelola dari `App.tsx`.

## Chat sidebar

Tombol **Chat** di header. Fitur:

- Mode **Plan** / **Build** (disimpan di localStorage)
- Provider / role / variant (Low–High)
- Sesi chat (baru, load, hapus)
- Lampiran gambar/teks/path workspace
- Slash skill `/nama-skill`
- Event `rnd:auto-build` untuk automation

## Terminal panel

`TerminalPanel` + `TerminalSession` (xterm.js + fit). Multi-session; tetap hidup saat panel
disembunyikan. WebSocket ke `/api/projects/:id/terminal`.

## Tema

`ThemeProvider`: light/dark/system, color preset, font app/editor, tema Monaco (auto mengikuti app).
Mermaid mengikuti tema yang sama.
