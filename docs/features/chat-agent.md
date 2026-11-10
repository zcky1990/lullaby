# Chat agent

Chat sidebar kanan (`ChatSidebar`) memanggil `POST /api/projects/:id/chat`. Engine:
`src/server/chat/agent.ts`.

## Mode

| Mode      | Tools                                                                       | Tujuan                                |
| --------- | --------------------------------------------------------------------------- | ------------------------------------- |
| **Plan**  | `use_skill`, doc/ticket reads, enabled MCP (`mcp_*`)                        | Rencana + baca konteks (tanpa mutate file/doc/ticket app) |
| **Build** | Plan tools + file tools + doc/ticket write/sync + MCP                       | Kerja di workspace + docs/tickets + MCP |

Mode disimpan di localStorage (`rnd.chatMode:v1`).

## Tools

- Path file relatif ke `workspace_path`; path di luar ditolak
- **Documents**: `list_documents` / `get_document` (`source`: local \| docmost \| notion \|
  confluence); `create_document` / `update_document` (local \| docmost); `sync_document` (local →
  Docmost). Notion/Confluence read-only seperti UI.
- **Tickets**: `list_tickets` / `get_ticket`; `create_ticket` / `update_ticket` / `delete_ticket`
  (local); `sync_ticket` (local → Jira/ClickUp); `transition_ticket` (Jira/ClickUp status).
- `create_ticket` selalu menulis ke SQLite lokal (bukan langsung ke board remote)
- Mutasi doc/ticket langsung diterapkan (tidak lewat Review tab; Review hanya `write_file`)
- `use_skill` memuat body `SKILL.md` (progressive disclosure)
- **MCP**: jika Global Settings → MCP master switch on, tool dari setiap server enabled
  di-inject ke LLM sebagai `mcp_<server>_<tool>` (`src/server/chat/mcp-tools.ts`). Disable
  per-tool memakai key `serverId:toolName` (`mcp_disabled_tools`). Eksekusi:
  `tools/call` lewat stdio/HTTP (`src/server/mcp.ts`). Cache `tools/list` ~60s. Tidak memakai
  deny-list Chat Tools; kurangi lewat MCP settings. Provider **Cursor SDK** mengabaikan tool
  OpenAI-style ini (tool Cursor sendiri).
- Loop tool default **unlimited** (seperti OpenCode). Opsional batas di Global Settings →
  Tools (`chat_max_steps`); langkah terakhir = text-only + ringkasan. Workflow
  `action: agent` memakai `max_steps` opsional (default juga unlimited)

## Dua jalur write

1. **Chat `write_file`** → pending hunk → tab **Review** → `POST /api/chat/change` atau
   `/api/chat/change-all` → baru ditulis ke disk\
   (kecuali Global Settings → Tools → **Auto-approve file writes** aktif: langsung ke disk)
2. **Editor Monaco** → `PUT .../files/content` langsung (user mengedit sendiri)

Event UI: `web/src/lib/review-events.ts`.

## Global Tools settings

`GET`/`PUT` `/api/settings/chat-tools` (`app_settings.auto_approve_writes`, `chat_disabled_tools`):

- **Auto-approve writes** — skip Review untuk `write_file` di chat Build (default off).
- **Max agent steps** — kosong/null = unlimited; jika diisi (1–200), langkah terakhir memaksa
  jawaban teks saja (OpenCode-style).
- **Disabled tools** — deny-list nama tool; dihilangkan dari tool list LLM dan ditolak jika
  dipanggil. UI: Global Settings → Tools (+ **Enable all**).
- Hanya chat interaktif; workflow `action: agent` tetap auto-write dan tidak memakai deny-list ini.

## Cursor SDK provider

Provider LLM dengan `provider: cursor` memakai `@cursor/sdk` (lihat `src/server/chat/cursor.ts`).
Di runtime Deno, app memakai transport Node (`connect-node` / `node:http2`) — Deno `fetch`
tidak mendukung streaming request body untuk local agent bidi. **Jangan** pakai HTTP/1.1
(`useHttp1ForAgent`): jalur `node:https` SDK gagal di Deno dengan `write EPERM`. Lihat
`cursor-sdk.ts`.
Progres streaming datang dari `agent.send(message, { mode, onDelta })` (`sendCursorPrompt`);
`mode`/`onDelta` **harus** di argumen kedua — di dalam `message` keduanya diabaikan SDK.
Setiap fase dibatasi `runCursorPhase` (timeout + sinyal Stop): `Agent.create`/`resume` 120s,
`send` 180s, `wait` wall-clock 15 menit (tanpa drain `stream()` paralel). Fase yang
ditinggalkan dibersihkan bila selesai terlambat (agent ditutup, run dibatalkan).
Konfigurasi tetap lewat Global Settings → LLM Providers:

- `apiKey`: Cursor API key (disimpan di `llm_providers.api_key`).
- `model`: mis. `composer-2`.
- `baseUrl`: tidak dipakai.
- `provider`: `cursor`.

Katalog model dari `Cursor.models.list` disimpan di `llm_providers.config.cursorModels` (plus
`cursorModelsUpdatedAt`). Sync katalog berjalan di background setelah listen (`bootstrapBackground`)
dan di-skip bila cache masih segar (&lt; 24 jam). Create/update provider dan
`POST /api/llm/cursor/models` (dengan `providerId`) juga menyimpan ulang katalog.

Setiap sesi chat menyimpan `chat_sessions.cursor_agent_id` (SDK agent id). Turn pertama memakai
`Agent.create`; turn berikutnya `Agent.resume` (local: fallback create bila resume gagal; cloud
`bc-…`: error jika resume gagal — tidak dibuat ulang sebagai local). Hanya pesan user terbaru
(+ gambar) yang dikirim saat resume; create pertama menyertakan catatan runtime/system singkat.
Mode Plan memakai tool tanpa `edit` dan `mode: "plan"`.

**Local agents** memakai `local.cwd = projects.workspace_path` (cwd asli, sama dengan Cursor IDE)
plus `settingSources: ["project"]` agar rules workspace ikut terbaca. Sebelum Build, app
menyimpan snapshot file; setelah run, diff → `write_file` sintetis → **Review**, lalu workspace
di-revert ke snapshot sehingga IDE↔app bisa resume agent yang sama tanpa temp copy. **Cloud
agents** (`bc-…`) di-resume tanpa menulis Review lokal (edit di VM Cursor).

Setelah run sukses, transcript `run.conversation()` disinkronkan ke `chat_messages` (assistant
baru saja; dedupe). Test koneksi memakai `Cursor.models.list`.

### Import riwayat Cursor

`GET /api/projects/:id/chat/sessions` (bila ada provider Cursor + API key):

1. `Agent.list({ runtime: "local", cwd: workspace })` — agent IDE/app di folder project
2. `Agent.list({ runtime: "cloud", apiKey })` — cloud agents (`bc-…`), judul diprefix `Cloud ·`

Upsert `source: "cursor"` (satu sesi per `cursor_agent_id`). Sidebar badge **Cursor**. Membuka
sesi kosong menghidrasi via `Agent.messages.list` / `listRuns` + `conversation()` (cloud pakai
`apiKey`).

## Skills

Discovery: workspace `.agents/skills` > project skills (auto) > global skills > builtin
(`src/skills/builtin`).\
Composer: `/skill-name` menyuntikkan body ke system prompt.\
Setelah Build sukses yang memakai tools, `skill-learn.ts` dapat menulis skill project.

Saat aplikasi pertama kali dibuka, `installDefaultSkills()` (`src/core/bootstrap.ts`) menyalin skill
integrasi bawaan ke **global skills** (`{appDataDir}/skills`): `docmost-api`, `jira-api`,
`confluence-api`, `clickup-api`. Seed hanya sekali (`app_settings.skills_defaults_installed`); skill
bisa dilihat/diatur di Global Settings → Skills.

### `/code-review`

Skill builtin (`src/skills/builtin/code-review/SKILL.md`). Saat `skillName=code-review`:

- Mode dipaksa **Plan** (UI + server) — tidak menulis file lewat tools
- Pesan user diperkaya dengan status/diff git (`src/server/code-review.ts`: unstaged, staged, vs
  upstream merge-base bila ada)
- Output diharapkan findings-first (severityitas: bug, regresi, security, missing tests)

Detail: [code-review.md](code-review.md).

### `/autoskill`

Slash command khusus (bukan skill file): menjalankan `npx autoskills -y -a cursor` di
`workspace_path` project via `POST /api/projects/:id/autoskills`. Skill terinstal ke
`<workspace>/.agents/skills` dan langsung bisa dipakai `use_skill` / mention.

Prasyarat: Node.js >= 22.6 + `npx` di PATH, jaringan untuk unduh registry, permission `--allow-run`
(sudah di task `dev`/`desktop`).

## Roles

Role global punya `persona` (+ opsional provider). Dipilih di composer; persona di-prepend ke system
prompt. Jika role punya provider, selector model terkunci ke provider itu.

## Sesi & lampiran

- Sesi & pesan di SQLite
- Lampiran: gambar (batas ukuran), teks, atau path workspace
- Variant Low/Medium/High mengatur temperature LLM

## Generate tickets dari dokumen

`POST .../generate-tickets` memakai provider LLM pertama dan hanya tool `create_ticket`.
