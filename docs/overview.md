# Overview

## Apa itu RND Workflow?

**RND Workflow** adalah aplikasi desktop (Deno Desktop / webview) yang menggabungkan alur kerja
produk–engineering dalam satu jendela:

1. **Dokumen** — baca/kelola PRD dan catatan (lokal Markdown, Docmost, Notion, Confluence)
2. **Tiket** — backlog lokal + board Jira (Kanban)
3. **Kode** — explorer workspace, editor Monaco, Git, terminal
4. **AI** — chat agent dengan tools file/tiket, review hunk sebelum write, opsional auto-build

Nama jendela / app: **RND Workflow** (`com.klgroup.rndworkflow`).

## Alur kerja tipikal

```text
Dokumen (PRD)  →  Generate / buat tiket  →  Kanban (To Do → In Progress)
                                              ↓
                                    Chat Build (opsional otomatis)
                                              ↓
                                    Review hunk → write ke workspace
                                              ↓
                                         Git commit
```

## Model proses

Semua I/O sensitif (filesystem, kredensial, git, PTY, HTTP ke layanan eksternal) berjalan di
**main process Deno**. UI React hanya berbicara ke API lokal `127.0.0.1`. Bundle UI di-embed ke
binary (`src/ui/assets.generated.ts`) agar distribusi self-contained.

```text
webview (React)  ──HTTP──►  Deno main process
                              ├─ server (router, chat, terminal, static, SSE)
                              ├─ integrations (Docmost, Notion, Confluence, Jira, GitHub, …)
                              ├─ fs (workspace + local documents)
                              ├─ db (SQLite)
                              └─ desktop (window + folder picker)
```

## Ruang lingkup v1 (penting)

| Area | Didukung | Belum / out of scope |
| --- | --- | --- |
| Dokumen lokal | Buat, edit, rename, sync ke Docmost | Sync ke Notion/Confluence |
| Docmost | List, buka, buat, update | — |
| Notion / Confluence | Browse + baca halaman | Create/update remote |
| Tiket | Lokal CRUD, sync ke Jira, Kanban | Provider non-Jira (ClickUp, Linear) |
| Chat | Plan/Build, tools file + tiket lokal, Review | Eksekusi tool MCP dari chat |
| Automation | Auto Build To Do → In Progress | Auto-accept Review, auto Done |
| MCP | Simpan config + list tools | Tool execution di agent |

## Audiens dokumen

- **Pengguna / PM / engineer** yang menjalankan app: mulai dari [getting-started.md](getting-started.md) dan fitur di `features/`
- **Kontributor kode**: [architecture.md](architecture.md), [api.md](api.md), dan [`AGENTS.md`](../AGENTS.md)
