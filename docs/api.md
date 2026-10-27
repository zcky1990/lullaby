# HTTP API

Base: proses lokal Deno. Auth: cookie `app_token` atau header `x-app-token`, kecuali health.

Implementasi: `src/server/router.ts`. Input divalidasi Zod (`src/config/schema.ts`).

## Meta & events

| Method | Path | Keterangan |
| --- | --- | --- |
| `GET` | `/api/health` | Open, tanpa auth |
| `GET` | `/api/events` | SSE activity |
| `GET` | `/api/events/recent` | Snapshot events |

## Settings (global)

| Method | Path | Keterangan |
| --- | --- | --- |
| `GET` | `/api/skills?projectId=` | Daftar skills + path |
| `PUT` | `/api/settings/skills` | `{ enabled, disabled }` |
| `GET`/`PUT` | `/api/settings/automation` | `{ autoBuildOnInProgress }` |
| `GET`/`PUT` | `/api/settings/terminal` | `{ shell: "zsh" \| "bash" }` |
| `GET`/`PUT` | `/api/settings/mcp` | servers, enabled, disabledTools |
| `POST` | `/api/settings/mcp/tools` | Discover tools satu server |
| `GET`/`POST` | `/api/llm` | List / create provider |
| `PUT`/`DELETE` | `/api/llm/:id` | Update / hapus |
| `GET`/`POST` | `/api/roles` | List / create role |
| `PUT`/`DELETE` | `/api/roles/:id` | Update / hapus |
| `POST` | `/api/integrations/test` | Health-check config |

## Projects

| Method | Path | Keterangan |
| --- | --- | --- |
| `GET`/`POST` | `/api/projects` | List / create |
| `GET`/`PUT`/`DELETE` | `/api/projects/:id` | Detail / update / hapus (CASCADE data lokal; folder disk tetap) |
| `PUT`/`POST` | `/api/projects/:id/integrations/:kind` | Upsert integrasi |

## Files (workspace)

| Method | Path | Keterangan |
| --- | --- | --- |
| `GET` | `/api/projects/:id/files?path=` | List directory |
| `GET` | `/api/projects/:id/files/content?path=` | Baca file |
| `PUT` | `/api/projects/:id/files/content` | Tulis langsung (tanpa Review) |

## Git

Prefix: `/api/projects/:id/git/`

| Path | Method | Keterangan |
| --- | --- | --- |
| `status` | `GET` | Working tree |
| `branches` | `GET` | `{ branches, remotes, stashes }` |
| `log` | `GET` | Commits |
| `diff` | `GET` | Diff path (+ staged) |
| `show` | `GET` | Detail + patch commit (`?hash=`) |
| `stage` / `unstage` | `POST` | `{ paths }` |
| `commit` | `POST` | `{ message }` |
| `checkout` | `POST` | `{ branch }` (lokal atau `remote/name`) |
| `clone` | `POST` | `{ url, protocol? }` → clone ke `workspace_path` (`https`\|`ssh`) |
| `fetch` / `pull` / `push` | `POST` | Sinkron remote |
| `branch` | `POST` | `{ name, checkout? }` buat branch |
| `merge` | `POST` | `{ branch }` merge ke HEAD |
| `stash` | `POST` | `{ message?, includeUntracked? }` buat stash |
| `stash/apply` | `POST` | `{ index, pop? }` |

## Terminal

| Method | Path | Keterangan |
| --- | --- | --- |
| `GET` | `/api/projects/:id/terminal` | Upgrade WebSocket + PTY |

## Documents (remote)

| Method | Path | Keterangan |
| --- | --- | --- |
| `GET` | `/api/projects/:id/documents?source=&pageId=` | Tree / children (`source`: docmost\|notion\|confluence) |
| `POST` | `/api/projects/:id/documents` | Create (Docmost) |
| `GET` | `/api/projects/:id/documents/:pageId?source=` | Konten halaman |
| `PUT` | `/api/projects/:id/documents/:pageId` | Update (Docmost) |

## Documents (local)

| Method | Path | Keterangan |
| --- | --- | --- |
| `GET`/`POST`/`PUT` | `/api/projects/:id/local-documents` | List / create / update |
| `GET` | `/api/projects/:id/local-documents/content?path=` | Baca |
| `POST` | `/api/projects/:id/local-documents/sync` | Sync ke Docmost |

## Tickets

| Method | Path | Keterangan |
| --- | --- | --- |
| `GET` | `/api/projects/:id/tickets` | Lokal unsynced + Jira |
| `GET` | `/api/projects/:id/tickets/:key` | Detail Jira |
| `POST` | `/api/projects/:id/tickets/:key/transition` | `{ status }` |
| `POST` | `/api/projects/:id/local-tickets` | Buat lokal |
| `GET`/`PATCH`/`DELETE` | `/api/projects/:id/local-tickets/:id` | Detail / edit / hapus (unsynced) |
| `POST` | `/api/projects/:id/local-tickets/:id/sync` | Push ke Jira |
| `POST` | `/api/projects/:id/generate-tickets` | AI dari dokumen |

## Chat

| Method | Path | Keterangan |
| --- | --- | --- |
| `POST` | `/api/projects/:id/chat` | Start / lanjut agent |
| `POST` | `/api/projects/:id/autoskills` | Jalankan `npx autoskills` di workspace (`{ dryRun? }`) |
| `POST` | `/api/chat/change` | Accept/reject satu hunk |
| `POST` | `/api/chat/change-all` | Accept/reject semua |
| `GET` | `/api/projects/:id/chat/sessions` | List sesi |
| `GET`/`DELETE` | `/api/projects/:id/chat/sessions/:sid` | Detail / hapus |

Response chat umum: `done` | `approval_required` | `error` (+ `runId`, pending changes).

## Static

`GET /*` → aset embedded; SPA fallback `index.html`. Cookie sesi diset pada respons HTML.
