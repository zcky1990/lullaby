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

| Menu                 | Muncul bila             | Isi                                                                                                                                                           |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace**        | selalu                  | daftar/buat project (nama + workspace folder opsional), overview project                                                                                      |
| **Explorer**         | project punya workspace | file tree folder workspace + editor kode **Monaco** (bisa diedit, simpan dengan tombol/card `Cmd/Ctrl+S`)                                                     |
| **Document**         | selalu                  | tree halaman Docmost (collapsible, lazy children, **+** tambah) + render **markdown** + **Edit** (judul/isi via Monaco)                                       |
| **Ticket**           | selalu                  | **Kanban** tiket lokal + Jira (kolom = status, drag = transition/update); **Tiket baru** (lokal) + sync manual; klik card → detail; filter assignee + refresh |
| **Project Settings** | ada project             | Workspace, Integrations (Document/Ticket/Code, `+` pilih tipe), LLM Providers — form **collapsible**                                                          |
| **Global Settings**  | selalu                  | satu halaman: **Appearance & Editor** (tema/font app, tema/font/ukuran Monaco, ukuran & ketebalan ikon) · MCP · About                                         |

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

**Mode Plan / Build:** selector **Mode** di composer (tersimpan di `localStorage`). **Plan** hanya
merencanakan — hanya boleh `use_skill` (read-only, bila skill tersedia); write tool tidak dikirim
dan tool call lain tidak dieksekusi. **Build** adalah agent penuh: `use_skill`, file tools
(`list_files`/`read_file`/`write_file` + approval), dan `create_ticket`.

**Skills:** AI bisa memilih skill lewat **progressive disclosure**: daftar `name` + `description`
diberikan di system prompt, lalu model memanggil `use_skill(name)` untuk memuat isi `SKILL.md`
sebelum mengikuti instruksinya. Skill dibaca dari **global** `appDataDir()/skills` dan **workspace**
`<workspace>/.agents/skills` (workspace menang bila nama sama). Format: folder berisi `SKILL.md`
dengan frontmatter `name` dan `description`. Aktif/nonaktif global & per-skill diatur di **Global
Settings → Skills** (`app_settings`: `skills_enabled`, `skills_disabled`).

**Perubahan file di chat:** setiap `write_file` yang disetujui menghasilkan kartu perubahan berisi
**path** (klik → tab file dibuka/di-reload di aplikasi), status (baru/diubah), jumlah `+/-`, dan
**diff** berwarna. Diff ikut disimpan di kolom `chat_messages.changes` sehingga tetap tampil saat
sesi dimuat ulang.

**Lampiran chat:** composer (ikon lampiran berada **di dalam kotak chat**, seperti Cursor) mendukung
**gambar** (dikirim sebagai vision content: `image_url` untuk OpenAI-compatible, blok `image` base64
untuk Anthropic) dan **file teks** (isi file ditambahkan ke prompt). File bisa dipilih lewat tombol
lampiran, **drag & drop** dari Explorer (hanya path yang dikirim — backend membaca file dari
workspace) atau file eksternal, maupun paste dari clipboard. Batas: 6 lampiran/pesan, gambar ≤ 3 MB,
file teks ≤ 200 KB (body API ≤ 26 MB).

**Editor tabs (ala VS Code):** memilih file (Explorer), dokumen (Document), atau menu
(Workspace/Ticket/Project Settings/Global Settings) membuka **tab** di area konten. Tab bisa diklik
ulang dan **ditutup** (`×`); menutup tab terakhir menampilkan empty state. Workspace/Explorer/
Document memakai **panel kiri terpisah** yang **lebarnya bisa di-drag** (tersimpan di `localStorage`
`rnd.panelWidth:v1`), sedangkan **Project Settings** dan **Global Settings** menaruh sidebar-nya
(section nav) di dalam tab.

## HTTP API

| Method & path                                              | Fungsi                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| `GET /api/health`                                          | info app: name, version, dataDir                        |
| `GET /api/events` · `GET /api/events/recent`               | SSE + riwayat event                                     |
| `GET /api/projects` · `POST /api/projects`                 | list / buat project                                     |
| `GET /api/projects/:id` · `PUT /api/projects/:id`          | detail (+ integrations, llmProviders) / update          |
| `PUT /api/projects/:id/integrations/:kind`                 | simpan config integrasi (`docmost`/`jira`/`github`)     |
| `POST /api/integrations/test`                              | test koneksi (docmost/jira/github/llm)                  |
| `GET/PUT /api/settings/mcp`                                | baca / simpan MCP (server, enabled, disabled tools)     |
| `POST /api/settings/mcp/tools`                             | konek ke server MCP & ambil daftar tools (`tools/list`) |
| `GET /api/skills?projectId=`                               | daftar skill global + workspace (+ status aktif)        |
| `PUT /api/settings/skills`                                 | aktif/nonaktif skills global & per-skill                |
| `GET /api/projects/:id/documents`                          | daftar halaman Docmost                                  |
| `POST /api/projects/:id/documents`                         | buat halaman Docmost (judul, parent opsional)           |
| `GET /api/projects/:id/local-documents`                    | daftar dokumen lokal (scan document workspace)          |
| `POST /api/projects/:id/local-documents`                   | buat dokumen lokal (`.md`)                              |
| `GET /api/projects/:id/local-documents/content?path=`      | isi dokumen lokal                                       |
| `PUT /api/projects/:id/local-documents`                    | simpan/rename dokumen lokal                             |
| `POST /api/projects/:id/local-documents/sync`              | sync manual dokumen lokal → Docmost                     |
| `GET /api/projects/:id/documents/:pageId`                  | isi halaman (markdown)                                  |
| `PUT /api/projects/:id/documents/:pageId`                  | edit halaman Docmost (judul/isi)                        |
| `GET /api/projects/:id/tickets`                            | daftar tiket lokal + Jira (JQL)                         |
| `GET /api/projects/:id/tickets/:key`                       | detail tiket Jira (deskripsi ADF → teks)                |
| `POST /api/projects/:id/tickets/:key/transition`           | pindah status tiket Jira (drag Kanban)                  |
| `POST /api/projects/:id/local-tickets`                     | buat tiket **lokal** (belum di Jira)                    |
| `GET/PATCH/DELETE /api/projects/:id/local-tickets/:id`     | detail / ubah (termasuk status) / hapus tiket lokal     |
| `POST /api/projects/:id/local-tickets/:id/sync`            | sync manual tiket lokal → Jira (buat issue)             |
| `GET /api/projects/:id/llm` · `POST /api/projects/:id/llm` | list / tambah provider LLM                              |
| `PUT /api/projects/:id/llm/:providerId` · `DELETE ...`     | ubah / hapus provider LLM                               |
| `POST /api/projects/:id/chat`                              | chat LLM (agent + tools file workspace)                 |
| `POST /api/chat/approve`                                   | setujui/tolak aksi tulis (once/always/deny)             |
| `GET /api/projects/:id/chat/sessions`                      | daftar sesi chat                                        |
| `GET/DELETE /api/projects/:id/chat/sessions/:sid`          | muat / hapus sesi chat                                  |
| `GET /api/projects/:id/files?path=`                        | daftar isi folder workspace                             |
| `GET /api/projects/:id/files/content?path=`                | isi file (maks 200 KB, deteksi biner)                   |
| `GET /*`                                                   | aset client (SPA fallback ke `index.html`)              |

## Skema data (SQLite)

| Tabel                  | Isi                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `projects`             | `name`, `workspace_path`, target (`docmost_space_id`, `jira_project_key`, `github_repo`)                   |
| `project_integrations` | per `(project, kind)`: `mode`, `config` (JSON, termasuk token)                                             |
| `llm_providers`        | banyak per project: `name`, `provider`, `model`, `base_url`, `api_key`, `mode`                             |
| `chat_sessions`        | sesi chat per project: `title`, `created_at`, `updated_at`                                                 |
| `chat_messages`        | pesan per sesi: `role` (user/assistant), `content`, `changes` (JSON diff), `created_at`                    |
| `local_tickets`        | tiket lokal: `title`, `description`, `status`, `priority`, `type`, `jira_key`, `sync_status`, `sync_error` |
| `local_documents`      | metadata sync dokumen lokal: `path`, `page_id`, `sync_status`, `sync_error`                                |
| `events`               | stream event (audit/activity)                                                                              |

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

**Preview markdown**: saat tab file `.md` aktif, `Cmd/Ctrl` + `Shift` + `V` men-toggle antara editor
Monaco dan preview markdown (tombol **Preview/Kode** juga tersedia di header tab file).

## Permissions & keamanan

Task menjalankan Deno dengan `--allow-read --allow-write --allow-net --allow-env --allow-run`.
`--allow-run` dipakai untuk folder picker native (`osascript`/`zenity`/PowerShell).

API lokal dilindungi **token sesi per-proses** (`src/server/session.ts`): saat shell HTML disajikan,
server menyetel cookie `app_token`; semua `/api/*` wajib menyertakannya (atau header `x-app-token`),
kecuali `/api/health`. `baseUrl` integrasi dibatasi `http(s)` (menolak `file://` dsb).

## Status

Fondasi (F0) — yang sudah jalan:

- **Workspace**: project CRUD + workspace folder (native picker), overview project.
- **Explorer**: file tree folder workspace + editor kode **Monaco** yang **bisa diedit** (indikator
  dirty di tab/header, tombol **Simpan** atau `Cmd/Ctrl+S`; file ditulis lewat
  `PUT /api/projects/:id/files/content` dengan guard path workspace).
- **Document**: pilih sumber **Local** atau **Docmost**. Local memakai folder **Document workspace**
  (Project Settings → Workspace): daftar file `.md`, buat/rename, edit markdown, dan **sync manual**
  ke Docmost (badge Local/Synced/Error; sync pertama membuat page lalu update konten, sync
  berikutnya update page yang sama). Docmost tetap menampilkan tree halaman collapsible (children
  di-load saat expand).
- **Ticket**: **Kanban** full-width dengan kolom tetap **Backlog / To Do / In Progress / Test /
  Done** (kosong tetap tampil, card seragam), **drag antar kolom** = update status lokal atau Jira
  transition, **klik card** = dialog detail, **Tiket baru** membuat tiket lokal, **sync manual** ke
  Jira dari detail (badge Local/Synced/Sync error), **filter assignee** + refresh di header. Tiket
  lokal disimpan di tabel `local_tickets`; `GET /tickets` menggabungkan tiket lokal yang belum
  synced dengan tiket Jira (yang sudah synced tidak diduplikasi). AI punya tool `create_ticket` yang
  selalu membuat tiket **lokal** (tidak langsung POST ke Jira).
- **Project Settings**: layout **section** (bukan card) dengan tombol `+` pilih tipe integrasi
  (Document/Ticket/Code), LLM Providers, Workspace, Activity.
- **Global Settings**: **Appearance & Editor** (tema app + tema Monaco dalam satu section) · **MCP**
  · About. MCP ditambah/diedit lewat **editor JSON** (format `mcpServers`, seperti `mcp.json`
  Cursor) untuk server global stdio (command/args/env) atau http (url/headers), aktif/nonaktif;
  disimpan di `app_settings` (SQLite).
- Integrasi Docmost/Jira/GitHub/LLM: simpan config, health-check, list document/ticket.
- Multi-provider LLM per project; live activity via SSE.

**Belum termasuk:** eksekusi tool MCP di chat (discovery & toggle sudah ada), generate tiket AI dari
PRD, bulk-sync/update Jira, workflow engine, sandbox coding loop, MCP transport (mode `mcp`
tersimpan di config tetapi belum dieksekusi), WebSocket (masih SSE), agent roles
(Planner/Coder/Verifier).

## Kredit / dependensi UI

- **shadcn/ui** — Button, Card, Input, Label, Select, Badge, DropdownMenu, Dialog (copy-in di
  `web/src/components/ui`).
- **ReUI** (`@reui/kanban`) — komponen Kanban, di-vendor ke `web/src/components/reui/kanban.tsx`
  (butuh `@base-ui/react`, `@dnd-kit/*`).
- **Monaco Editor** (`@monaco-editor/react`) — viewer kode.
- **react-markdown** + **remark-gfm** + **mermaid** — render dokumen Docmost (GFM + diagram).
- **lucide-react** — ikon.
