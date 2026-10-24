# Git & Terminal

## Git

Menjalankan CLI `git` di dalam `projects.workspace_path` (`src/integrations/git.ts`).

UI:

- Aside: `GitPanel` (branches, refresh, checkout)
- Tab: `GitTab` — Changes (stage/unstage/commit/diff) dan History

Route: `/api/projects/:id/git/*`. Path di-guard (`--` / reject escape).  
Jika folder bukan repo git, API mengembalikan error yang jelas.

## Terminal

- Upgrade WebSocket: `/api/projects/:id/terminal`
- PTY interaktif lewat `@sigma/pty-ffi` (butuh `--allow-ffi`)
- cwd = workspace project; resize didukung
- Output di-batch sebagai frame binary; kontrol tetap JSON
- Auth sama dengan HTTP (cookie sesi)

UI: `TerminalPanel` (tinggi tersimpan) + multi `TerminalSession` (xterm.js). Session tetap
mounted saat panel disembunyikan.
