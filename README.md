# RND Workflow

Desktop workspace untuk alur **Docmost PRD → draft tiket → Jira → coding loop**, dibangun dengan
**Deno Desktop** (`deno desktop`, Deno 2.9+). Backend berjalan di **main process**: semua akses
kredensial, integrasi, filesystem, dan I/O sistem terjadi di sana; UI di-render di webview lewat
HTTP lokal.

Dokumen desain ada di `feature/` (`overview.md`, `PLAN.md`, `CODE_EDITING_LOOP.md`,
`STACK_RECOMMENDATION.md`, `STACK_TS.md`, `configuration.md`, `docmost.md`, `jira.md`).

## Arsitektur

```
webview (UI)  ──HTTP 127.0.0.1──►  main process (Deno)
   │  React + shadcn/ui                ├─ src/server        router + API + SSE + static
   │  + Monaco (Vite build, embedded)  ├─ src/integrations  docmost | jira | github | llm
   │  bindings (folder picker)         ├─ src/fs            file tree workspace
   └───────────────────────────────────┤─ src/db            SQLite (node:sqlite)
                                        └─ src/desktop       window + bindings
```

- **UI** (`web/`): React 19 + Vite + Tailwind v4 + **shadcn/ui** (`components/ui`), **ReUI** Kanban
  (`components/reui/kanban.tsx`, dari `@reui/kanban`) untuk board tiket, **Monaco**
  (`@monaco-editor/react`) untuk viewer kode, dan **react-markdown + remark-gfm + Mermaid** untuk
  render dokumen. Monaco/Markdown dimuat **lazy** (chunk terpisah). Di-build ke `web/dist`, lalu
  di-embed ke `src/ui/assets.generated.ts` oleh `scripts/build-assets.ts` dan di-serve oleh main
  process (`src/server/static.ts`). Tidak ada server UI terpisah.
- **API** (`src/server/router.ts`): REST + SSE (`/api/events`).
- **Integrasi** (`src/integrations`): klien REST Docmost/Jira/GitHub/LLM + health-check.
- **Filesystem** (`src/fs/workspace.ts`): file tree & baca file dengan proteksi path traversal.
- **Data** (`src/db/db.ts`): SQLite via `node:sqlite` (built-in, tanpa dependensi native).
- **Kredensial**: token/key diisi sebagai teks biasa dan disimpan di `config` integrasi (dan
  `llm_providers.api_key`). `src/secrets` (env/keychain) sudah **tidak dipakai**.
- **Bindings** (`src/desktop/window.ts`): `appInfo`, `chooseDirectory` (native folder picker),
  `checkDirectory`.

## Menjalankan

Butuh **Deno 2.9+** dan **Node/npm** (untuk build client Vite).

```sh
deno task build     # build client (Vite) + generate src/ui/assets.generated.ts
deno task dev       # build lalu desktop + hot reload (deno desktop --hmr)
deno task start     # build lalu jalankan tanpa shell desktop
deno task web:dev   # Vite dev server client saja (HMR UI, untuk iterasi komponen)
deno task desktop   # build client lalu -> ./dist/RNDWorkflow.app
```

`deno desktop` membaca `src/ui/assets.generated.ts` (hasil build), jadi jalankan `deno task build`
setiap kali UI berubah. Task `dev`/`desktop`/`start` sudah menjalankannya otomatis.

## Menu aplikasi

Shell ala VSCode: **activity bar** (kiri) + **panel** terpisah (Workspace/Explorer/Document) +
**area konten bertab**. Memilih file/dokumen/menu membuka **tab** di area konten.

| Menu                 | Muncul bila             | Isi                                                                                                                           |
| -------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Workspace**        | selalu                  | daftar/buat project (nama + workspace folder opsional), overview project                                                      |
| **Explorer**         | project punya workspace | file tree folder workspace + viewer kode **Monaco** (read-only)                                                               |
| **Document**         | selalu                  | tree halaman Docmost (collapsible, lazy children, **+** tambah) + render **markdown** + **Edit** (judul/isi via Monaco)       |
| **Ticket**           | selalu                  | **Kanban** tiket Jira full-width (kolom = status, drag = transition); klik card → detail; filter assignee + refresh di header |
| **Project Settings** | ada project             | Workspace, Integrations (Document/Ticket/Code, `+` pilih tipe), LLM Providers — form **collapsible**                          |
| **Global Settings**  | selalu                  | satu halaman: Appearance (tema app) · Editor (tema Monaco) · About                                                            |

**Chat LLM:** tombol **Chat** di header membuka sidebar kanan. Chat bisa memakai **tools** untuk
membaca (`list_files`, `read_file`) dan **menulis** (`write_file`) file di folder workspace project
(**root = `workspace_path` yang di-set saat membuat project / Settings → Workspace**; semua path
tool relatif terhadap root itu, `..`/path di luar ditolak). Setiap aksi tulis meminta
**persetujuan**: **Allow once**, **Always allow**, atau **No** (selama run berjalan). Backend
memakai tool-calling OpenAI-compatible (`/chat/completions`) atau Anthropic (`/messages`).

**Sesi chat** disimpan di SQLite (`chat_sessions`/`chat_messages`). Sidebar punya pemilih sesi (chat
baru + riwayat), bisa **memuat** sesi lama dan **menghapus** sesi. Judul sesi diambil dari pesan
user pertama. Pemilihan **model** memakai satu selector di composer chat (gaya Cursor): daftar model
dari semua provider LLM project (label = `model`, fallback nama provider). Di sampingnya ada
selector **Variant** — **Low / Medium / High** — yang memetakan ke `temperature` (low 0.2, medium
0.5, high 0.9).

**Editor tabs (ala VS Code):** memilih file (Explorer), dokumen (Document), atau menu
(Workspace/Ticket/Project Settings/Global Settings) membuka **tab** di area konten. Tab bisa diklik
ulang dan **ditutup** (`×`); menutup tab terakhir menampilkan empty state. Workspace/Explorer/
Document memakai **panel kiri terpisah** yang **lebarnya bisa di-drag** (tersimpan di `localStorage`
`rnd.panelWidth:v1`), sedangkan **Project Settings** dan **Global Settings** menaruh sidebar-nya
(section nav) di dalam tab.

## HTTP API

| Method & path                                              | Fungsi                                              |
| ---------------------------------------------------------- | --------------------------------------------------- |
| `GET /api/health`                                          | info app: name, version, dataDir                    |
| `GET /api/events` · `GET /api/events/recent`               | SSE + riwayat event                                 |
| `GET /api/projects` · `POST /api/projects`                 | list / buat project                                 |
| `GET /api/projects/:id` · `PUT /api/projects/:id`          | detail (+ integrations, llmProviders) / update      |
| `PUT /api/projects/:id/integrations/:kind`                 | simpan config integrasi (`docmost`/`jira`/`github`) |
| `POST /api/integrations/test`                              | test koneksi (docmost/jira/github/llm)              |
| `GET /api/projects/:id/documents`                          | daftar halaman Docmost                              |
| `POST /api/projects/:id/documents`                         | buat halaman Docmost (judul, parent opsional)       |
| `GET /api/projects/:id/documents/:pageId`                  | isi halaman (markdown)                              |
| `PUT /api/projects/:id/documents/:pageId`                  | edit halaman Docmost (judul/isi)                    |
| `GET /api/projects/:id/tickets`                            | daftar tiket Jira (JQL)                             |
| `GET /api/projects/:id/tickets/:key`                       | detail tiket (deskripsi ADF → teks)                 |
| `POST /api/projects/:id/tickets/:key/transition`           | pindah status tiket (drag Kanban)                   |
| `GET /api/projects/:id/llm` · `POST /api/projects/:id/llm` | list / tambah provider LLM                          |
| `PUT /api/projects/:id/llm/:providerId` · `DELETE ...`     | ubah / hapus provider LLM                           |
| `POST /api/projects/:id/chat`                              | chat LLM (agent + tools file workspace)             |
| `POST /api/chat/approve`                                   | setujui/tolak aksi tulis (once/always/deny)         |
| `GET /api/projects/:id/chat/sessions`                      | daftar sesi chat                                    |
| `GET/DELETE /api/projects/:id/chat/sessions/:sid`          | muat / hapus sesi chat                              |
| `GET /api/projects/:id/files?path=`                        | daftar isi folder workspace                         |
| `GET /api/projects/:id/files/content?path=`                | isi file (maks 200 KB, deteksi biner)               |
| `GET /*`                                                   | aset client (SPA fallback ke `index.html`)          |

## Skema data (SQLite)

| Tabel                  | Isi                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `projects`             | `name`, `workspace_path`, target (`docmost_space_id`, `jira_project_key`, `github_repo`) |
| `project_integrations` | per `(project, kind)`: `mode`, `config` (JSON, termasuk token)                           |
| `llm_providers`        | banyak per project: `name`, `provider`, `model`, `base_url`, `api_key`, `mode`           |
| `chat_sessions`        | sesi chat per project: `title`, `created_at`, `updated_at`                               |
| `chat_messages`        | pesan per sesi: `role` (user/assistant), `content`, `created_at`                         |
| `events`               | stream event (audit/activity)                                                            |

## Konfigurasi & data

Disimpan di direktori data aplikasi (dibuat otomatis):

- macOS: `~/Library/Application Support/RND Workflow/`
- Linux: `~/.local/share/rnd-workflow/`
- Windows: `%APPDATA%\RND Workflow\`

Berisi `data.db`. Kredensial (API token/key) **disimpan plaintext** di `config`/`api_key`, sehingga
`data.db` bersifat sensitif — jangan dibagikan.

Pengaturan UI (tema app & tema editor) disimpan di `localStorage` webview (`rnd.theme:v1`,
`rnd.editorTheme:v1`). **Project aktif** juga disimpan (`rnd.activeProjectId:v1`) sehingga saat app
dibuka, project terakhir yang dipilih otomatis menjadi aktif (badge **Aktif** di panel Workspace).

**Zoom UI**: `Cmd/Ctrl` + `+` (perbesar), `Cmd/Ctrl` + `-` (perkecil), `Cmd/Ctrl` + `0` (reset).
Level disimpan di `localStorage` (`rnd.zoom:v1`).

## Permissions & keamanan

Task menjalankan Deno dengan `--allow-read --allow-write --allow-net --allow-env --allow-run`.
`--allow-run` dipakai untuk folder picker native (`osascript`/`zenity`/PowerShell).

API lokal dilindungi **token sesi per-proses** (`src/server/session.ts`): saat shell HTML disajikan,
server menyetel cookie `app_token`; semua `/api/*` wajib menyertakannya (atau header `x-app-token`),
kecuali `/api/health`. `baseUrl` integrasi dibatasi `http(s)` (menolak `file://` dsb).

## Status

Fondasi (F0) — yang sudah jalan:

- **Workspace**: project CRUD + workspace folder (native picker), overview project.
- **Explorer**: file tree folder workspace + viewer kode **Monaco** (read-only).
- **Document**: tree halaman Docmost collapsible (children di-load saat expand) + isi markdown.
- **Ticket**: **Kanban** full-width dengan kolom tetap **Backlog / To Do / In Progress / Test /
  Done** (kosong tetap tampil, card seragam), **drag antar kolom = Jira transition**, **klik card =
  dialog detail**, **filter assignee** + refresh di header.
- **Project Settings**: layout **section** (bukan card) dengan tombol `+` pilih tipe integrasi
  (Document/Ticket/Code), LLM Providers, Workspace, Activity.
- **Global Settings**: satu halaman — Appearance (tema app) · Editor (tema Monaco) · About.
- Integrasi Docmost/Jira/GitHub/LLM: simpan config, health-check, list document/ticket.
- Multi-provider LLM per project; live activity via SSE.

**Belum termasuk:** generate tiket AI dari PRD, push/bulk-create Jira, workflow engine, sandbox
coding loop, MCP transport (mode `mcp` tersimpan di config tetapi belum dieksekusi), WebSocket
(masih SSE), agent roles (Planner/Coder/Verifier).

## Kredit / dependensi UI

- **shadcn/ui** — Button, Card, Input, Label, Select, Badge, DropdownMenu, Dialog (copy-in di
  `web/src/components/ui`).
- **ReUI** (`@reui/kanban`) — komponen Kanban, di-vendor ke `web/src/components/reui/kanban.tsx`
  (butuh `@base-ui/react`, `@dnd-kit/*`).
- **Monaco Editor** (`@monaco-editor/react`) — viewer kode.
- **react-markdown** + **remark-gfm** + **mermaid** — render dokumen Docmost (GFM + diagram).
- **lucide-react** — ikon.
