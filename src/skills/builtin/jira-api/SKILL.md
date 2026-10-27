---
name: jira-api
description: Panduan API Jira Cloud/Data Center (myself, JQL search, issue, create, transitions) dan lokasi penyimpanan token di aplikasi ini. Gunakan saat membaca/membuat/menyinkronkan tiket Jira.
---

# Jira API

Jira dipakai untuk board tiket, detail issue, transisi status, dan sync tiket lokal → Jira.

## Kredensial di aplikasi ini

- Diisi di **Project Settings → Integrations → Jira**.
- Disimpan per project di tabel `project_integrations` (SQLite `data.db`), kolom `config` (JSON):
  `baseUrl`, `deployment` (`cloud` | `data-center`), `cloudId?`, `projectKey`, `email?`, `apiToken`.
- Token dimask (`••••`) saat dikirim ke renderer. Jangan mencetak token ke log/chat.
- File DB: `{appDataDir}/data.db`. Di macOS:
  `~/Library/Application Support/RND Workflow/data.db`.

## Autentikasi

- **Jira Cloud**: Basic auth dengan email + API token.
  ```http
  Authorization: Basic base64(email:apiToken)
  ```
- **Jira Data Center**: Personal Access Token (PAT) dengan Bearer.
  ```http
  Authorization: Bearer <apiToken>
  ```
- `baseUrl` tanpa `/rest/api/...`, mis. `https://acme.atlassian.net`.
- Versi API: Cloud → `3`, Data Center → `2`; aplikasi mencoba versi lain bila `404/405/410`.
- Cloud dengan `cloudId`: base menjadi
  `https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3`.

## Endpoint yang dipakai aplikasi

| Method | Path | Kegunaan |
| --- | --- | --- |
| GET | `/rest/api/{2,3}/myself` | Test koneksi / identitas |
| GET/POST | `/rest/api/{2,3}/search/jql` | Cari issue dengan JQL |
| POST | `/rest/api/{2,3}/search` | Fallback pencarian lama |
| GET | `/rest/api/{2,3}/issue/{key}?fields=...` | Detail issue |
| POST | `/rest/api/{2,3}/issue` | Buat issue |
| GET | `/rest/api/{2,3}/issue/{key}/transitions?expand=transitions.fields` | Daftar transisi |
| POST | `/rest/api/{2,3}/issue/{key}/transitions` | Ubah status |

### Cari tiket

```bash
curl -sS -G "$JIRA_URL/rest/api/3/search/jql" \
  -H "Authorization: Basic $(printf '%s' "$JIRA_EMAIL:$JIRA_TOKEN" | base64)" \
  -H "Accept: application/json" \
  --data-urlencode 'jql=project = "PROJ" ORDER BY updated DESC' \
  --data-urlencode 'maxResults=50' \
  --data-urlencode 'fields=summary,status,assignee,priority'
```

### Buat issue

```bash
curl -sS -X POST "$JIRA_URL/rest/api/3/issue" \
  -H "Authorization: Basic $(printf '%s' "$JIRA_EMAIL:$JIRA_TOKEN" | base64)" \
  -H "Content-Type: application/json" \
  -d '{
    "fields": {
      "project": { "key": "PROJ" },
      "summary": "Judul tiket",
      "issuetype": { "name": "Task" },
      "description": "Deskripsi"
    }
  }'
```

Catatan: Jira Cloud API v3 memakai **ADF** untuk `description`. Aplikasi mengonversi HTML → ADF
(`htmlToAdf`). Data Center v2 memakai teks biasa.

### Transisi status

```bash
curl -sS "$JIRA_URL/rest/api/3/issue/PROJ-1/transitions?expand=transitions.fields" \
  -H "Authorization: Basic $(printf '%s' "$JIRA_EMAIL:$JIRA_TOKEN" | base64)"

curl -sS -X POST "$JIRA_URL/rest/api/3/issue/PROJ-1/transitions" \
  -H "Authorization: Basic $(printf '%s' "$JIRA_EMAIL:$JIRA_TOKEN" | base64)" \
  -H "Content-Type: application/json" \
  -d '{"transition":{"id":"31"}}'
```

## Alur di aplikasi

1. **Ticket** memanggil `GET /api/projects/:id/tickets` (gabungan tiket lokal + Jira).
2. Detail tiket: `GET /api/projects/:id/tickets/:key` (Jira) atau `local-tickets/:id`.
3. Sync tiket lokal: `POST /api/projects/:id/local-tickets/:id/sync` → membuat issue Jira, menyimpan
   `jira_key` dan `sync_status`.
4. Transisi status memakai nama status tujuan; aplikasi mencari transisi yang cocok.

## Troubleshooting

- `401` Cloud: pastikan memakai **email + API token**, bukan password.
- `401` Data Center: pastikan memakai **PAT Bearer**.
- `404`: cek `baseUrl`, deployment, dan `cloudId`.
- `403`: akun tidak punya izin project/issue.
- `429`: hormati header `Retry-After`.
- `projectKey` kosong → list tiket gagal.
