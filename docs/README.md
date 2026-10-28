# Dokumentasi RND Workflow

Dokumentasi produk dan teknis untuk aplikasi desktop **RND Workflow** (`rnd-workflow`).

Sumber kebenaran perilaku terkini untuk kontributor: [`AGENTS.md`](../AGENTS.md).
Dokumen di folder ini menjelaskan **apa yang dilakukan aplikasi**, cara menjalankannya, dan
peta fitur/API untuk pengguna maupun developer.

## Daftar isi

| Dokumen | Isi |
| --- | --- |
| [overview.md](overview.md) | Apa itu RND Workflow, alur kerja utama, ruang lingkup v1 |
| [getting-started.md](getting-started.md) | Instalasi, perintah dev/build, checklist kualitas |
| [architecture.md](architecture.md) | Arsitektur proses, modul backend/frontend, keamanan lokal |
| [ui.md](ui.md) | Shell UI (activity bar, panel, tab, chat, terminal) |
| [data-model.md](data-model.md) | SQLite, `app_settings`, path data aplikasi |
| [api.md](api.md) | Peta endpoint HTTP / WebSocket |
| [features/documents.md](features/documents.md) | Dokumen lokal, Docmost, Notion, Confluence |
| [features/tickets.md](features/tickets.md) | Tiket lokal, Jira, Kanban, sync |
| [features/chat-agent.md](features/chat-agent.md) | Chat Plan/Build, tools, Review, skills, roles |
| [features/autoskill.md](features/autoskill.md) | Slash `/autoskill` → npx autoskills di workspace |
| [features/code-review.md](features/code-review.md) | Builtin `/code-review` (Plan + git context) |
| [features/git-terminal.md](features/git-terminal.md) | Git CLI UI dan terminal PTY |
| [features/lsp.md](features/lsp.md) | Language Server Protocol di editor workspace |
| [features/workflows.md](features/workflows.md) | Workflow YAML (DAG), runner, history, UI graph |
| [features/integrations.md](features/integrations.md) | Konfigurasi & test integrasi |
| [features/settings.md](features/settings.md) | Project Settings vs Global Settings |
| [automation.md](automation.md) | Auto-build saat To Do → In Progress |

## Desain historis

Catatan desain/perencanaan (bukan runtime): folder [`feature/`](../feature/).

## Versi

- Nama paket: `rnd-workflow` `0.1.0`
- Runtime: Deno 2.9+ (desktop), Node/npm untuk build client Vite
