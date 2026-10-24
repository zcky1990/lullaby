# Git & Terminal

## Git

Menjalankan CLI `git` di dalam `projects.workspace_path` (`src/integrations/git.ts`).

UI:

- Aside: `GitPanel` (branches, refresh, checkout)
- Tab: `GitTab` — Changes (stage/unstage/commit/diff) dan History

Route: `/api/projects/:id/git/*`. Path di-guard (`--` / reject escape).  
Jika folder bukan repo git, API mengembalikan error yang jelas.

## Terminal

- Upgrade WebSocket: `/api/projects/:id/terminal?cols=&rows=&shell=`
- `shell` query: `zsh` | `bash` (opsional; fallback ke default global)
- Default shell global: `GET`/`PUT` `/api/settings/terminal` → `{ shell }` (`app_settings.terminal_shell`)
- PTY interaktif lewat `@sigma/pty-ffi` (butuh `--allow-ffi`)
- cwd = workspace project; resize didukung
- Output di-batch sebagai frame binary; kontrol tetap JSON
- Auth sama dengan HTTP (cookie sesi)

UI: `TerminalPanel` (tinggi tersimpan, picker zsh/bash +) + multi `TerminalSession` (xterm.js).
Session tetap mounted saat panel disembunyikan. Global Settings → Terminal mengatur default
untuk session baru.
