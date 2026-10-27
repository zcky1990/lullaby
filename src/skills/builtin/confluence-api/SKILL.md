---
name: confluence-api
description: Panduan REST API Confluence Cloud (space, content/page, body storage) dan lokasi penyimpanan token di aplikasi ini. Gunakan saat membaca atau menelusuri halaman Confluence.
---

# Confluence API

Confluence dipakai untuk browse dan membaca halaman dokumen remote.

## Kredensial di aplikasi ini

- Diisi di **Project Settings → Integrations → Confluence Cloud**.
- Disimpan per project di tabel `project_integrations` (SQLite `data.db`), kolom `config` (JSON):
  `baseUrl`, `email`, `apiToken`, `spaceKey?`.
- Token dimask (`••••`) saat dikirim ke renderer. Jangan mencetak token ke log/chat.
- File DB: `{appDataDir}/data.db`. Di macOS:
  `~/Library/Application Support/RND Workflow/data.db`.

## Autentikasi

Basic auth dengan **email Atlassian + API token**:

```http
Authorization: Basic base64(email:apiToken)
Accept: application/json
```

Base URL: `https://acme.atlassian.net/wiki`. Aplikasi menambahkan `/wiki` otomatis bila belum ada.
Path REST: `<base>/rest/api/...`.

## Endpoint yang dipakai aplikasi

| Method | Path | Kegunaan |
| --- | --- | --- |
| GET | `/rest/api/space?limit=50&start={n}` | Daftar space |
| GET | `/rest/api/content?spaceKey={key}&type=page&limit=50&start={n}` | Daftar halaman |
| GET | `/rest/api/content/{id}/child/page?limit=50&start={n}` | Sub-halaman |
| GET | `/rest/api/content/{id}?expand=space` | Metadata halaman |
| GET | `/rest/api/content/{id}?expand=body.storage,body.view,space` | Isi halaman |

Contoh:

```bash
curl -sS "$CONFLUENCE_URL/rest/api/space?limit=25" \
  -H "Authorization: Basic $(printf '%s' "$CONFLUENCE_EMAIL:$CONFLUENCE_TOKEN" | base64)" \
  -H "Accept: application/json"
```

```bash
curl -sS -G "$CONFLUENCE_URL/rest/api/content" \
  -H "Authorization: Basic $(printf '%s' "$CONFLUENCE_EMAIL:$CONFLUENCE_TOKEN" | base64)" \
  -H "Accept: application/json" \
  --data-urlencode 'spaceKey=PROJ' \
  --data-urlencode 'type=page' \
  --data-urlencode 'limit=25'
```

```bash
curl -sS "$CONFLUENCE_URL/rest/api/content/<pageId>?expand=body.storage,body.view,space" \
  -H "Authorization: Basic $(printf '%s' "$CONFLUENCE_EMAIL:$CONFLUENCE_TOKEN" | base64)" \
  -H "Accept: application/json"
```

## Respons

- Daftar: `{ "results": [...], "start": 0, "limit": 50, "size": n, "_links": { "next": ... } }`.
- Isi halaman ada di `body.storage.value` (XHTML) dan/atau `body.view.value` (HTML).
- Aplikasi mengonversi HTML → teks Markdown sederhana untuk ditampilkan.
- `spaceKey` opsional; bila kosong aplikasi menampilkan daftar space.

## Alur di aplikasi

1. **Document → Confluence** memanggil `GET /api/projects/:id/documents?source=confluence`.
2. Membuka halaman: `GET /api/projects/:id/documents/:pageId?source=confluence`.
3. Confluence **read-only** di v1: tidak ada create/update dari UI.

## Troubleshooting

- `401/403`: email atau API token salah, atau tidak punya akses space.
- `404`: cek `baseUrl` (harus mengarah ke `/wiki`) dan id halaman.
- `429`: rate limit, coba lagi nanti.
- Halaman kosong: cek `expand=body.storage,body.view`.
