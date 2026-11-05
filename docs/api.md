# HTTP API

Base: proses lokal Deno. Auth: cookie `app_token` atau header `x-app-token`, kecuali health.

Implementasi: `src/server/router.ts` (+ `src/server/routes/*`). Input divalidasi Zod
(`src/config/schema.ts`).

## Meta & events

| Method | Path                 | Keterangan       |
| ------ | -------------------- | ---------------- |
| `GET`  | `/api/health`        | Open, tanpa auth |
| `GET`  | `/api/events`        | SSE activity     |
| `GET`  | `/api/events/recent` | Snapshot events  |

## Backup & restore

Implementasi: `src/server/backup.ts` + `src/server/routes/backup.ts` (didaftarkan dari
`main.ts` sebelum router utama).

| Method | Path                             | Keterangan                                            |
| ------ | -------------------------------- | ----------------------------------------------------- |
| `GET`  | `/api/backup/global?secrets=&save=` | Bundle JSON seluruh config + database              |
| `POST` | `/api/backup/global`             | `{ bundle, mode: merge\|replace }` → restore global   |
| `GET`  | `/api/projects/:id/backup?secrets=&save=` | Bundle JSON project (config + data)          |
| `POST` | `/api/projects/:id/backup`       | `{ bundle, mode: merge\|replace }` → restore project  |

- `secrets=1` menyertakan nilai rahasia (api key, token integrasi, webhook) apa adanya; default
  diganti `••••••••`.
- `save=1` menulis file ke `<data dir>/backups/<nama-file>.json` dan mengembalikan
  `{ ok, path, bytes }` (dipakai saat webview memblokir unduhan).
- Bundle memakai `format: "lullaby-backup"`, `version: 1`, `scope: "global" | "project"`.
- Isi bundle: `settings` (app_settings), `llmProviders`, `roles`, `project` (project scope),
  `integrations` (project scope), dan `tables` (projects, project_integrations, local_tickets,
  local_documents, chat_sessions, chat_messages, workflow_*).
- Import `merge` memakai upsert per primary key; `replace` menghapus data scope tersebut lebih
  dulu. Import project selalu menyalin baris dengan id baru (tiket, sesi chat, workflow run) agar
  tidak menimpa data yang ada; baris yatim (parent tidak ada) diabaikan.
- Rahasia dienkripsi ulang dengan master key mesin tujuan saat import.

## Settings (global)

| Method         | Path                       | Keterangan                      |
| -------------- | -------------------------- | ------------------------------- |
| `GET`          | `/api/skills?projectId=`   | Daftar skills + path            |
| `PUT`          | `/api/settings/skills`     | `{ enabled, disabled }`         |
| `GET`/`PUT`    | `/api/settings/automation` | `{ autoBuildOnInProgress }`     |
| `GET`/`PUT`    | `/api/settings/notifications` | `{ channels: [...] }`       |
| `POST`         | `/api/settings/notifications/test` | `{ channelId? }`           |
| `GET`/`PUT`    | `/api/settings/terminal`   | `{ shell: "zsh" \| "bash" }`    |
| `GET`/`PUT`    | `/api/settings/mcp`        | servers, enabled, disabledTools |
| `POST`         | `/api/settings/mcp/tools`  | Discover tools satu server      |
| `GET`/`POST`   | `/api/llm`                 | List / create provider          |
| `PUT`/`DELETE` | `/api/llm/:id`             | Update / hapus                  |
| `GET`/`POST`   | `/api/roles`               | List / create role              |
| `PUT`/`DELETE` | `/api/roles/:id`           | Update / hapus                  |
| `POST`         | `/api/integrations/test`   | Health-check config             |

### Chat tools (`/api/settings/chat-tools`)

`GET`/`PUT` `{ autoApproveWrites, disabledTools, autoApproveTools, maxSteps, writeReviewMode }`
(`null` `maxSteps` = unlimited). `writeReviewMode`:

- `end` (default) — `write_file` langsung diterapkan; review dilakukan setelah run selesai
  (respons `done` membawa `runId` + `pendingChanges` + `reviewDeferred: true`).
- `before` — run berhenti dengan `status: "approval_required"` sampai hunk diputuskan.

Field yang tidak dikirim saat `PUT` mempertahankan nilai tersimpan.

## Projects

| Method               | Path                                   | Keterangan                                                      |
| -------------------- | -------------------------------------- | --------------------------------------------------------------- |
| `GET`/`POST`         | `/api/projects`                        | List / create                                                   |
| `GET`/`PUT`/`DELETE` | `/api/projects/:id`                    | Detail / update (termasuk `name`) / hapus (CASCADE data lokal)   |
| `PUT`/`POST`         | `/api/projects/:id/integrations/:kind` | Upsert integrasi                                                |

## Files (workspace)

| Method | Path                                           | Keterangan                                     |
| ------ | ---------------------------------------------- | ---------------------------------------------- |
| `GET`  | `/api/projects/:id/files?path=`                | List directory                                 |
| `POST` | `/api/projects/:id/files`                      | Buat file/folder `{ type, parent?, name }`     |
| `GET`  | `/api/projects/:id/files/index`                | Indeks semua file workspace (untuk Quick Open) |
| `GET`  | `/api/projects/:id/files/find?q=&case=&regex=` | Cari teks di file workspace                    |
| `GET`  | `/api/projects/:id/files/content?path=`        | Baca file                                      |
| `PUT`  | `/api/projects/:id/files/content`              | Tulis langsung (tanpa Review)                  |

## Git

Prefix: `/api/projects/:id/git/`

| Path                      | Method | Keterangan                                                        |
| ------------------------- | ------ | ----------------------------------------------------------------- |
| `status`                  | `GET`  | Working tree                                                      |
| `branches`                | `GET`  | `{ branches, remotes, stashes }`                                  |
| `log`                     | `GET`  | Commits                                                           |
| `diff`                    | `GET`  | Diff path (+ staged)                                              |
| `show`                    | `GET`  | Detail + patch commit (`?hash=`)                                  |
| `stage` / `unstage`       | `POST` | `{ paths }`                                                       |
| `commit`                  | `POST` | `{ message }`                                                     |
| `checkout`                | `POST` | `{ branch }` (lokal atau `remote/name`)                           |
| `clone`                   | `POST` | `{ url, protocol? }` → clone ke `workspace_path` (`https`\|`ssh`) |
| `fetch` / `pull` / `push` | `POST` | Sinkron remote                                                    |
| `branch`                  | `POST` | `{ name, checkout? }` buat branch                                 |
| `merge`                   | `POST` | `{ branch }` merge ke HEAD                                        |
| `stash`                   | `POST` | `{ message?, includeUntracked? }` buat stash                      |
| `stash/apply`             | `POST` | `{ index, pop? }`                                                 |

## Terminal

| Method | Path                         | Keterangan              |
| ------ | ---------------------------- | ----------------------- |
| `GET`  | `/api/projects/:id/terminal` | Upgrade WebSocket + PTY |

## Documents (remote)

| Method | Path                                          | Keterangan                                              |
| ------ | --------------------------------------------- | ------------------------------------------------------- |
| `GET`  | `/api/projects/:id/documents?source=&pageId=` | Tree / children (`source`: docmost\|notion\|confluence) |
| `POST` | `/api/projects/:id/documents`                 | Create (Docmost)                                        |
| `GET`  | `/api/projects/:id/documents/:pageId?source=` | Konten halaman                                          |
| `PUT`  | `/api/projects/:id/documents/:pageId`         | Update (Docmost)                                        |

## Documents (local)

| Method             | Path                                              | Keterangan             |
| ------------------ | ------------------------------------------------- | ---------------------- |
| `GET`/`POST`/`PUT` | `/api/projects/:id/local-documents`               | List / create / update |
| `GET`              | `/api/projects/:id/local-documents/content?path=` | Baca                   |
| `POST`             | `/api/projects/:id/local-documents/sync`          | Sync ke Docmost        |

## Tickets

| Method                 | Path                                        | Keterangan                       |
| ---------------------- | ------------------------------------------- | -------------------------------- |
| `GET`                  | `/api/projects/:id/tickets`                 | Lokal + Jira + ClickUp           |
| `GET`                  | `/api/projects/:id/tickets/:key`            | Detail Jira/ClickUp (`?source=`) |
| `POST`                 | `/api/projects/:id/tickets/:key/transition` | `{ status, source? }`            |
| `POST`                 | `/api/projects/:id/local-tickets`           | Buat lokal                       |
| `GET`/`PATCH`/`DELETE` | `/api/projects/:id/local-tickets/:id`       | Detail / edit / hapus (unsynced) |
| `POST`                 | `/api/projects/:id/local-tickets/:id/sync`  | `{ provider?: jira\|clickup }`   |
| `POST`                 | `/api/projects/:id/generate-tickets`        | AI dari dokumen                  |

## Workflows

| Method               | Path                                               | Keterangan                               |
| -------------------- | -------------------------------------------------- | ---------------------------------------- |
| `GET`/`POST`         | `/api/projects/:id/workflows`                      | Daftar (file + last run + schedule) / buat |
| `GET`/`PUT`/`DELETE` | `/api/projects/:id/workflows/:slug`                | Detail + YAML / simpan / hapus           |
| `PATCH`              | `/api/projects/:id/workflows/:slug/schedule`       | `{ enabled }` toggle schedule/event      |
| `POST`               | `/api/projects/:id/workflows/:slug/run`            | Mulai run (`202 { runId }`)              |
| `GET`                | `/api/projects/:id/workflow-runs?workflow=&limit=` | Riwayat run                              |
| `GET`                | `/api/projects/:id/workflow-runs/:runId`           | Detail run + step/log                    |
| `POST`               | `/api/projects/:id/workflow-runs/:runId/cancel`    | Cancel run aktif                         |

## Chat

| Method         | Path                                   | Keterangan                                             |
| -------------- | -------------------------------------- | ------------------------------------------------------ |
| `POST`         | `/api/projects/:id/chat`               | Start / lanjut agent (NDJSON stream)                   |
| `POST`         | `/api/projects/:id/autoskills`         | Jalankan `npx autoskills` di workspace (`{ dryRun? }`) |
| `POST`         | `/api/chat/change`                     | Keep/revert satu hunk (`{ runId, callId, hunk, accept }`) |
| `POST`         | `/api/chat/change-all`                 | Keep/revert semua                                      |
| `GET`          | `/api/projects/:id/chat/sessions`      | List sesi                                              |
| `GET`/`DELETE` | `/api/projects/:id/chat/sessions/:sid` | Detail / hapus                                         |

Response chat: `done` | `approval_required` | `error` | `cancelled`.

- `done` dengan mode review `end` dapat membawa `runId`, `pendingChanges`, dan
  `reviewDeferred: true`. `pendingChanges[].applied = true` berarti perubahan sudah ditulis ke disk;
  `POST /api/chat/change(-all)` dengan `accept: false` akan me-revert hunk/file tersebut (file baru
  yang seluruhnya di-revert dihapus). Run disimpan 10 menit sejak `finishedAt` agar review masih
  bisa dilakukan.
- `approval_required` dipakai mode review `before` (agent menunggu keputusan sebelum menulis).

## Static

`GET /*` → aset embedded; SPA fallback `index.html`. Cookie sesi diset pada respons HTML.
