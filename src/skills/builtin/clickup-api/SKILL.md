---
name: clickup-api
description: Panduan API ClickUp v2 (teams, spaces, folders, lists, tasks, comments) dan status penyimpanan token ClickUp di aplikasi ini. Gunakan saat merencanakan integrasi atau memanggil API ClickUp.
---

# ClickUp API

ClickUp **belum terintegrasi** di aplikasi ini (opsi ClickUp di Project Settings → Integrations masih
berlabel “segera”). Skill ini menjelaskan API resmi dan status token agar tidak salah asumsi.

## Kredensial di aplikasi ini

- **Saat ini token ClickUp tidak disimpan oleh aplikasi.** Tidak ada `kind` ClickUp di
  `IntegrationKind`, sehingga tidak ada baris `project_integrations` untuk ClickUp.
- Jangan mengarang lokasi penyimpanan. Bila integrasi ditambahkan nanti, pola yang dipakai aplikasi
  adalah `project_integrations.config` (JSON, per project) seperti Docmost/Jira/Confluence.
- Untuk eksperimen lokal, gunakan environment variable di shell sesi, mis. `CLICKUP_API_TOKEN`,
  dan jangan menulis token ke file workspace atau YAML workflow.

## Autentikasi

ClickUp API v2 memakai **personal API token** langsung di header `Authorization` (tanpa `Bearer`):

```http
Authorization: pk_xxxxxxxxxxxxxxxx
Content-Type: application/json
```

Base URL: `https://api.clickup.com/api/v2`.

## Endpoint penting

| Method | Path | Kegunaan |
| --- | --- | --- |
| GET | `/team` | Daftar workspace/team |
| GET | `/team/{team_id}/space?archived=false` | Daftar space |
| GET | `/space/{space_id}/folder?archived=false` | Daftar folder |
| GET | `/space/{space_id}/list?archived=false` | Daftar list langsung di space |
| GET | `/folder/{folder_id}/list?archived=false` | Daftar list dalam folder |
| GET | `/list/{list_id}/task?archived=false&page=0` | Daftar task |
| POST | `/list/{list_id}/task` | Buat task |
| GET | `/task/{task_id}?include_subtasks=true` | Detail task |
| PUT | `/task/{task_id}` | Update task |
| GET | `/task/{task_id}/comment` | Komentar |
| POST | `/task/{task_id}/comment` | Tambah komentar |

Contoh:

```bash
curl -sS "https://api.clickup.com/api/v2/team" \
  -H "Authorization: $CLICKUP_API_TOKEN"
```

```bash
curl -sS "https://api.clickup.com/api/v2/list/901234567/task?archived=false&page=0" \
  -H "Authorization: $CLICKUP_API_TOKEN"
```

```bash
curl -sS -X POST "https://api.clickup.com/api/v2/list/901234567/task" \
  -H "Authorization: $CLICKUP_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Judul task",
    "description": "Deskripsi task",
    "status": "to do",
    "priority": 3
  }'
```

## Hierarki ID

`team (workspace)` → `space` → `folder` → `list` → `task` → `subtask`.

- ID berupa string numerik; jangan diasumsikan integer.
- Untuk task di list tertentu, list ID wajib diketahui. Ambil dari space/folder terlebih dahulu.
- Status task bersifat custom per list; ambil daftar status dari `GET /list/{list_id}` bila perlu.

## Respons & error

- Sukses biasanya `{ "tasks": [...] }`, `{ "spaces": [...] }`, `{ "lists": [...] }`.
- `401`: token tidak valid/kosong.
- `403`: token tidak punya akses ke workspace/space.
- `404`: ID atau path salah.
- `429`: rate limit per token/plan; hormati `Retry-After`.

## Bila nanti diintegrasikan

Agar konsisten dengan aplikasi:

1. Tambahkan `clickup` ke `IntegrationKind` + schema config (`baseUrl?`, `apiToken`, `teamId?`,
   `spaceId?`, `listId?`).
2. Simpan token di `project_integrations.config` per project; mask di renderer.
3. Tambahkan client di `src/integrations/` dan test koneksi di `POST /api/integrations/test`.
4. Jangan mengeksekusi write API otomatis tanpa aksi eksplisit pengguna.
