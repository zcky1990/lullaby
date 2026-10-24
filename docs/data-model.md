# Data model

Persistensi: **SQLite** via `node:sqlite` di `src/db/db.ts`.  
File: `{appDataDir}/data.db` (`RND_APP_DATA_DIR` override).

## Tabel utama

### `projects`

Project aktif pengguna.

| Kolom (inti) | Arti |
| --- | --- |
| `id`, `name` | Identitas |
| `workspace_path` | Root kode (Explorer, Git, Terminal, chat tools) |
| `document_path` | Folder Markdown lokal |
| `docmost_space_id`, `jira_project_key`, `github_repo` | Target integrasi (opsional) |

### `project_integrations`

Satu baris per `(project_id, kind)`.  
`kind`: `docmost` | `notion` | `confluence` | `jira` | `github` (+ legacy).  
`config` JSON (termasuk token). Mode `api` | `mcp`.

**LLM tidak lagi di sini** — migrasi ke `llm_providers` saat startup.

### `llm_providers` (global)

`name`, `provider`, `model`, `base_url`, `api_key`, `mode`.

### `roles` (global)

`name`, `description`, `persona`, `provider_id` (nullable → `llm_providers`).

### `chat_sessions` / `chat_messages`

Sesi per project. Message menyimpan `role`, `content`, opsional `changes` JSON (diff setelah Review).

### `local_tickets`

Backlog lokal: title, description (HTML disanitasi), status Kanban, priority, type, labels,  
`jira_key`, `sync_status`, `sync_error`.

### `local_documents`

Meta sync file lokal → Docmost: `path`, `page_id`, `sync_status`, …

### `events`

Log aktivitas untuk SSE / Activity feed.

### `app_settings`

Key-value global.

| Key | Nilai |
| --- | --- |
| `mcp_servers` | JSON array server MCP |
| `mcp_enabled` | `"true"` / `"false"` |
| `mcp_disabled_tools` | JSON string[] |
| `skills_enabled` | `"true"` / `"false"` |
| `skills_disabled` | JSON skill id[] |
| `auto_build_on_in_progress` | `"true"` / `"false"` |

## Skills di disk (bukan tabel)

Urutan discovery (`src/server/skills.ts`):

1. `<workspace>/.agents/skills/` (prioritas tertinggi)
2. `{appDataDir}/project-<slug>/skills/` (hasil skill-learn)
3. `{appDataDir}/skills/` (global)

Setiap skill = folder berisi `SKILL.md` + frontmatter `name` / `description`.

## Migrasi

Kolom baru ditambahkan dengan `ensureColumn` di `db.ts` (idempotent). Jangan drop kolom secara
destruktif tanpa rencana migrasi eksplisit.
