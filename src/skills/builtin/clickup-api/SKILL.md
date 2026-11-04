---
name: clickup-api
description: Panduan API ClickUp v2 (teams, spaces, folders, lists, tasks, comments) dan penyimpanan token ClickUp di aplikasi ini. Gunakan saat merencanakan atau memanggil API ClickUp.
---

# ClickUp API

ClickUp **terintegrasi** sebagai provider board (sejajar Jira): list/get/create/transition task
dan sync tiket lokal. Skill ini merangkum API resmi dan lokasi kredensial di aplikasi.

## Kredensial di aplikasi ini

- Kind: `clickup` di `IntegrationKind` / Project Settings → Integrations → Ticket → ClickUp.
- Disimpan di `project_integrations.config` (JSON per project), di-mask di renderer.
- Field utama: `apiToken` (wajib), `listId` (wajib untuk board & sync), opsional `teamId`,
  `spaceId`, `folderId`, `baseUrl` (link app, default `https://app.clickup.com`).
- Test koneksi: `POST /api/integrations/test` dengan `kind: "clickup"`.
- Jangan menulis token ke workspace/YAML; untuk eksperimen shell saja, gunakan
  `CLICKUP_API_TOKEN` di environment sesi.

## Autentikasi

ClickUp API v2 memakai **personal API token** langsung di header `Authorization` (tanpa `Bearer`):

```http
Authorization: pk_xxxxxxxxxxxxxxxx
Content-Type: application/json
```

Base URL API: `https://api.clickup.com/api/v2`.

## Endpoint penting

| Method | Path | Kegunaan |
| --- | --- | --- |
| GET | `/team` | Daftar workspace/team |
| GET | `/team/{team_id}/space?archived=false` | Daftar space |
| GET | `/space/{space_id}/folder?archived=false` | Daftar folder |
| GET | `/space/{space_id}/list?archived=false` | Daftar list langsung di space |
| GET | `/folder/{folder_id}/list?archived=false` | Daftar list dalam folder |
| GET | `/list/{list_id}/task?archived=false&page=0` | Daftar task (board) |
| POST | `/list/{list_id}/task` | Buat task (sync lokal) |
| GET | `/task/{task_id}?include_subtasks=true` | Detail task |
| PUT | `/task/{task_id}` | Update / ganti status |
| GET | `/task/{task_id}/comment` | Komentar |
| POST | `/task/{task_id}/comment` | Tambah komentar |

## Hierarki ID

`team (workspace)` → `space` → `folder` → `list` → `task` → `subtask`.

- ID berupa string numerik; jangan diasumsikan integer.
- Board aplikasi membutuhkan `listId`. Ambil dari space/folder terlebih dahulu.
- Status task bersifat custom per list; client mencocokkan nama status (mirip Jira transitions).

## Board di aplikasi

- `GET /api/projects/:id/tickets` menggabungkan lokal + Jira + ClickUp (`source: "clickup"`).
- Drag Kanban → `POST .../tickets/:key/transition` dengan `{ status, source: "clickup" }`.
- Sync lokal → `POST .../local-tickets/:id/sync` dengan `{ provider: "clickup" }` (menyimpan
  task id di `jira_key` + `sync_provider = clickup`).
- Client: `src/integrations/clickup.ts`.

## Respons & error

- Sukses biasanya `{ "tasks": [...] }`, `{ "spaces": [...] }`, `{ "lists": [...] }`.
- `401`: token tidak valid/kosong.
- `403`: token tidak punya akses ke workspace/space.
- `404`: ID atau path salah.
- `429`: rate limit per token/plan; hormati `Retry-After`.

## Catatan

- Jangan mengeksekusi write API otomatis tanpa aksi eksplisit pengguna (sync/transition
  dari UI atau tool chat yang diminta).
