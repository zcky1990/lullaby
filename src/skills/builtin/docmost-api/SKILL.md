---
name: docmost-api
description: Panduan API Docmost (spaces, sidebar pages, page info/create/update markdown) dan lokasi penyimpanan token di aplikasi ini. Gunakan saat membaca/menulis dokumen Docmost atau melakukan sync dokumen lokal.
---

# Docmost API

Docmost dipakai untuk dokumen remote (PRD/notes) dan sync dokumen lokal → Docmost.

## Kredensial di aplikasi ini

- Diisi di **Project Settings → Integrations → Docmost**.
- Disimpan per project di tabel `project_integrations` (SQLite `data.db`), kolom `config` (JSON),
  dengan field: `baseUrl`, `apiToken`, `workspace?`, `spaceId?`.
- Token dimask (`••••`) saat dikirim ke renderer. Jangan pernah mencetak token ke log/chat.
- Bukan setting global: satu project punya konfigurasi Docmost sendiri.
- File DB: `{appDataDir}/data.db` (`RND_APP_DATA_DIR` bisa meng-override). Di macOS:
  `~/Library/Application Support/RND Workflow/data.db`.

## Autentikasi

Semua request memakai bearer token:

```http
Authorization: Bearer <apiToken>
Content-Type: application/json
```

`baseUrl` tanpa trailing slash, mis. `https://docmost.example.com`.

## Endpoint yang dipakai aplikasi

| Method | Path | Body | Kegunaan |
| --- | --- | --- | --- |
| POST | `/api/spaces/` | `{}` | Daftar space / test koneksi |
| POST | `/api/pages/sidebar-pages` | `{ spaceId, pageId? }` | Tree halaman per space |
| POST | `/api/pages/info` | `{ pageId, format: "markdown" }` | Baca isi halaman |
| POST | `/api/pages/create` | `{ spaceId, title, parentPageId? }` | Buat halaman |
| POST | `/api/pages/update` | `{ pageId, title?, operation: "replace", content, format: "markdown" }` | Update halaman |

Contoh:

```bash
curl -sS -X POST "$DOCMOST_URL/api/pages/info" \
  -H "Authorization: Bearer $DOCMOST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pageId":"<uuid>","format":"markdown"}'
```

```bash
curl -sS -X POST "$DOCMOST_URL/api/pages/update" \
  -H "Authorization: Bearer $DOCMOST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pageId":"<uuid>","operation":"replace","content":"# Judul\n\nIsi","format":"markdown"}'
```

## Respons

- Bentuk umum: `{ "data": ... }`, tetapi aplikasi juga menerima array langsung atau wrapper
  `data`/`items`/`pages`/`results`/`spaces`/`children`.
- Id halaman dapat berupa `id`, `pageId`, atau `slugId`.
- Error yang perlu ditangani: `401/403` token/API enterprise tidak valid, `404` baseUrl salah,
  `429` rate limit.

## Alur di aplikasi

1. **Document → Docmost** memanggil `GET /api/projects/:id/documents?source=docmost`.
2. Membuka halaman memanggil `GET /api/projects/:id/documents/:pageId?source=docmost`.
3. **Sync lokal → Docmost** (`POST /projects/:id/local-documents/sync`) membuat/meng-update halaman
   lalu menyimpan `page_id` di `local_documents`.
4. `spaceId` opsional: bila kosong dan hanya ada 1 space, aplikasi memakai space tersebut otomatis.

## Troubleshooting

- `401/403`: cek token dan pastikan API enterprise aktif.
- `404`: pastikan `baseUrl` benar (tanpa `/api`).
- Tree kosong: isi `spaceId` (UUID, bukan nama space).
- Jangan menaruh token di YAML workflow atau file workspace.
