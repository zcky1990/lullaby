# Integrasi Docmost — Sumber PRD

Turunan teknis dari `PLAN.md` §1A, `CODE_EDITING_LOOP.md`, dan `STACK_TS.md` §7. Dokumen ini
menjelaskan **secara detail** bagaimana aplikasi membaca PRD dari **Docmost** sebagai titik awal
alur (Docmost PRD -> Planner -> Draft tiket -> Jira).

> Ringkas: Docmost = **sumber dokumen** (PRD/spesifikasi). Aplikasi **hanya membaca** (read-mostly)
> dan **opsional menulis balik** (link Jira key / komentar status ke PRD). Docmost **bukan** sumber
> kebenaran status tiket — status tiket ada di Jira (lihat `jira.md`).

> **Status implementasi.** Yang sudah berjalan (mode `api`, REST): health-check
> `POST /api/spaces/`, daftar dokumen `POST /api/pages/sidebar-pages` (children di-load saat
> expand: `{ spaceId, pageId }`), isi dokumen `POST /api/pages/info` (`format: markdown`),
> **buat halaman** `POST /api/pages/create` (`{ spaceId, title, parentPageId? }`), dan
> **edit halaman** `POST /api/pages/update`
> (`{ pageId, operation: "replace", content, format: markdown, title? }`) —
> dipakai menu **Document** (tree collapsible, tombol **+**, mode **Edit**). **Kredensial:** token
> disimpan **plaintext** di `config.apiToken` (bukan `secretRef`/encryption seperti contoh di
> bawah). **Belum:** write-back komentar, MCP, cache `prd_documents`, generate tiket.

---

## 1. Peran Docmost dalam alur end-to-end

```
Docmost (PRD)  --read-->  AI Engine (Planner)  --draft-->  Review UI  --approve-->  Jira
     ^                                                                          |
     +------------------- (opsional) write-back: link Jira key / komentar ------+
```

1. User menyimpan PRD/spesifikasi produk sebagai **page** di Docmost dalam sebuah **space**.
2. Aplikasi menarik PRD (`search` atau `pages/info`) dalam format `markdown`.
3. AI (Planner) memecah PRD menjadi epic/story/sub-task + acceptance criteria.
4. Setelah tiket di-push ke Jira, aplikasi **opsional** menulis balik link `PROJ-123` atau komentar
   ringkasan ke page PRD agar ada jejak dua arah.

Docmost di sini adalah **input**, bukan target sinkronisasi status. Karena itu sebagian besar
operasi bersifat **read-only**.

---

## 2. Kondisi prasyarat & lisensi

- **API & MCP Docmost = fitur enterprise** (butuh lisensi Business/Enterprise).
  - Jika lisensi tidak tersedia, fallback: **export/import markdown manual** atau salin-tempel PRD
    ke editor aplikasi (capture manual).
  - Aplikasi harus menandai integrasi sebagai `unavailable` bila health-check gagal, lalu menawarkan
    mode manual.
- Auth tersedia dua jalur: **REST API key** dan **MCP**.
- Instance bisa **cloud/self-hosted**; `base_url` per project.

---

## 3. Bentuk integrasi: `api` vs `mcp`

Selaras `STACK_TS.md` §7, integrasi Docmost disimpan di `project_integrations` dengan
`kind = "docmost"` dan `mode`:

| Mode      | Cara kerja                                                                          | Kapan dipakai                              |
| --------- | ----------------------------------------------------------------------------------- | ------------------------------------------ |
| **`api`** | Panggil REST di `https://<docmost-host>/api` dengan `Bearer` API key                | Kontrol penuh, mapping field presisi       |
| **`mcp`** | Panggil MCP server `https://<docmost-host>/mcp` (JSON-RPC 2.0 over streamable HTTP) | Menghindari membangun adapter REST sendiri |

Keduanya dibungkus satu interface `DocProvider` sehingga logika bisnis tidak peduli mode. Adapter
dibuat **factory berbasis config** (bukan env global):

```ts
createDocmostClient(cfg: ProjectIntegrationConfig): DocProvider
```

`cfg` berisi `{ mode, baseUrl, apiKey?/token?, workspace?, spaceId? }` — secret **terenkripsi**
(AES-256-GCM, `APP_ENCRYPTION_KEY`), non-secret di kolom `config` jsonb.

---

## 4. REST API — autentikasi

- **Header**: `Authorization: Bearer <API_KEY>`
- API key dibuat di Docmost: **Setting -> API keys**.
- **Base**: `https://<docmost-host>/api` (semua endpoint di bawah prefix global `api`).
- Simpan hanya di server; **jangan** pernah kirim ke client/browser.

Contoh request:

```http
POST /api/search HTTP/1.1
Host: docmost.example.com
Authorization: Bearer <API_KEY>
Content-Type: application/json

{ "query": "checkout redesign", "spaceId": "sp_123" }
```

---

## 5. Ringkasan endpoint yang dipakai

| Kegunaan                    | Endpoint                        | Body utama                       |
| --------------------------- | ------------------------------- | -------------------------------- |
| Cari PRD                    | `POST /api/search`              | `{ query, spaceId? }`            |
| Baca isi page (PRD)         | `POST /api/pages/info`          | `{ pageId, format: "markdown" }` |
| List spaces                 | `POST /api/spaces/`             | `{}` (pagination)                |
| List page dalam space       | `POST /api/pages/sidebar-pages` | `{ spaceId }`                    |
| Tulis balik (link Jira key) | `POST /api/pages/update`        | `{ pageId, content, format }`    |
| Komentar balik ke PRD       | `POST /api/comments/create`     | `{ pageId, content }`            |

Catatan format: `format` bisa `json` (editor doc), `markdown`, atau `html`. **Pakai `markdown`**
agar isi page langsung bisa dikirim ke LLM tanpa konversi berat.

---

## 6. Detail endpoint kunci

### 6.1 `POST /api/search` — temukan PRD

```json
// request
{ "query": "checkout redesign", "spaceId": "sp_123" }

// response (ringkas)
{
  "items": [
    { "id": "pg_789", "title": "PRD Checkout Redesign", "spaceId": "sp_123",
      "updatedAt": "2026-10-01T10:00:00Z" }
  ]
}
```

- `spaceId` opsional; isi untuk membatasi pencarian ke space project terkait.
- Simpan `updatedAt` untuk caching/idempotency (lihat §9).

### 6.2 `POST /api/pages/info` — baca isi PRD (markdown)

```json
// request
{ "pageId": "pg_789", "format": "markdown" }

// response (ringkas)
{
  "id": "pg_789",
  "title": "PRD Checkout Redesign",
  "content": "# Checkout Redesign\n\n## Tujuan\n...",
  "updatedAt": "2026-10-01T10:00:00Z",
  "version": 12
}
```

Inilah payload utama yang diteruskan ke Planner.

### 6.3 `POST /api/pages/sidebar-pages` — daftar page dalam space

```json
{ "spaceId": "sp_123" }
```

Dipakai untuk memilih PRD di UI (tree/sidebar) tanpa perlu tahu `pageId` lebih dulu.

### 6.4 `POST /api/spaces/` — list space

```json
{}
```

Dipaginasi. Dipakai saat setup mapping (`docmostSpaceId -> jiraProjectKey -> githubRepo`).

### 6.5 `POST /api/pages/update` — tulis balik (opsional)

```json
{ "pageId": "pg_789", "content": "...(append link Jira)...", "format": "markdown" }
```

Dipakai untuk menambahkan daftar tiket hasil generate:

```markdown
## Tickets

- [PROJ-123](https://<site>.atlassian.net/browse/PROJ-123) — Checkout: validasi alamat
- [PROJ-124](https://<site>.atlassian.net/browse/PROJ-124) — Checkout: retry pembayaran
```

> **Peringatan**: update page meng-overwrite konten. Untuk aman, aplikasi harus **fetch -> render ->
> append -> update** dan menyimpan hash konten agar tidak menimpa edit manual user (optimistic
> concurrency; lihat §9).

### 6.6 `POST /api/comments/create` — komentar balik (opsional)

```json
{ "pageId": "pg_789", "content": "Tiket PROJ-123..PROJ-127 telah dibuat." }
```

Lebih aman daripada update page untuk jejak status ringan (tidak mengubah body PRD).

---

## 7. Alternatif: MCP server

Jika AI klien mendukung MCP, gunakan MCP daripada membangun adapter REST:

- **Endpoint**: `https://<docmost-host>/mcp`
- **Transport**: JSON-RPC 2.0 over streamable HTTP (mendukung respons JSON & SSE).
- **Client**: `createMcpClient({ url, token })`.

Tool siap pakai yang umum diekspos Docmost:

| Tool             | Setara endpoint REST        |
| ---------------- | --------------------------- |
| `search_pages`   | `POST /api/search`          |
| `get_page`       | `POST /api/pages/info`      |
| `list_spaces`    | `POST /api/spaces/`         |
| `create_page`    | (buat page baru)            |
| `update_page`    | `POST /api/pages/update`    |
| `create_comment` | `POST /api/comments/create` |

Praktik:

- `testIntegrationAction(kind: "docmost")` memeriksa koneksi & ketersediaan tool MCP.
- Simpan daftar tool hasil `tools/list` ke cache untuk ditampilkan di UI.
- Fallback otomatis ke REST (`mode=api`) bila handshake MCP gagal.

---

## 8. Interface `DocProvider`

Semua akses Docmost melewati satu interface seragam (lihat `PLAN.md` §2):

```ts
interface DocProvider {
  listSpaces(): Promise<Space[]>;
  search(query: string, spaceId?: string): Promise<SearchHit[]>;
  getDocument(pageId: string, format?: "markdown" | "html" | "json"): Promise<DocPage>;
  listPages(spaceId: string): Promise<PageSummary[]>;
  annotate(pageId: string, content: string): Promise<void>; // update page
  comment(pageId: string, content: string): Promise<void>; // create comment
}
```

Implementasi:

- `RestDocProvider` — memakai `fetch` wrapper + retry/backoff.
- `McpDocProvider` — memanggil tool MCP.
- `MockDocProvider` — untuk dev/test tanpa Docmost.

`resolveProjectIntegrations(projectId)` menyatukan konfigurasi efektif (`api` + `mcp`) sehingga
actions cukup memanggil satu objek.

---

## 9. Idempotency, cache, dan konkurensi

- **Cache PRD** di tabel `prd_documents`:
  `{ projectId, docmostPageId, version, hash, markdown, fetchedAt }`.
- **Hash konten markdown** (`sha256`) = kunci idempotency. Jika hash tidak berubah, **jangan**
  generate ulang draft tiket (hemat biaya LLM).
- Gunakan `version`/`updatedAt` dari Docmost untuk optimistic concurrency saat write-back; tolak
  update bila versi berubah sejak fetch.
- **Satu page = satu sumber**; hindari dua worker menarik/menulis page yang sama dalam waktu
  bersamaan (lock per `docmostPageId`).

```ts
const cached = await db.prdDocument.findUnique({ where: { projectId_pageId } });
if (cached?.hash === sha256(markdown)) return cached; // skip regen
```

---

## 10. Penanganan error & rate limit

| Situasi            | Penanganan                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| 401/403            | API key invalid/enterprise tidak aktif -> tandai integrasi `unavailable`, tawarkan mode manual |
| 404 page           | PRD dihapus/dipindah -> tandai draft `stale`, minta user pilih ulang                           |
| 429                | Hormati `Retry-After`; exponential backoff + jitter                                            |
| 5xx                | Retry terbatas (mis. 3x) lalu tandai `degraded`                                                |
| Timeout            | Batas waktu per request (mis. 15s); jangan menggantung workflow                                |
| Body terlalu besar | Chunking PRD panjang (per heading), lalu merge hasil Planner                                   |

Semua kegagalan integrasi **tidak boleh** mematikan workflow secara permanen — catat ke
`ai_runs`/`webhook_events` dan lanjutkan dengan fallback.

---

## 11. Keamanan

- API key/token **encrypted at rest** (AES-256-GCM), hanya didekripsi di server saat dipakai.
- **Least privilege**: gunakan key dengan scope minimal (read bila write-back tidak dipakai).
- **Jangan** log token atau isi penuh; redact di log.
- Validasi `baseUrl` (allowlist host) untuk mencegah SSRF.
- Audit setiap operasi read/write ke Docmost (`ai_tool_calls`).
- Rate limit + retry untuk menghormati kuota Docmost.

---

## 12. Konfigurasi (contoh)

```jsonc
// project_integrations (kind = "docmost")
{
  "kind": "docmost",
  "mode": "api", // "api" | "mcp"
  "config": {
    "baseUrl": "https://docmost.example.com",
    "workspace": "acme",
    "spaceId": "sp_123" // space default untuk project ini
  },
  "secret": {
    "apiKeyEnc": "…AES-256-GCM…" // atau tokenEnc untuk mode mcp
  }
}
```

```jsonc
// mode mcp
{
  "kind": "docmost",
  "mode": "mcp",
  "config": { "mcpUrl": "https://docmost.example.com/mcp" },
  "secret": { "tokenEnc": "…" }
}
```

---

## 13. Pemetaan ke skema data

| Tabel                       | Peran untuk Docmost                                                    |
| --------------------------- | ---------------------------------------------------------------------- |
| `project_integrations`      | `kind="docmost"`, mode + config + secret                               |
| `prd_documents`             | cache PRD: `docmostPageId`, `version`, `hash`, `markdown`, `fetchedAt` |
| `ticket_drafts`             | hasil AI dari PRD; `sourcePrdId` -> `prd_documents.id`                 |
| `ai_runs` / `ai_tool_calls` | audit pemanggilan `doc_search`/`doc_get_page` dll                      |
| `sync_cursors`              | opsional: posisi terakhir sync per integrasi                           |

Relasi:

```
Project (root)
  └─ project_integrations(kind=docmost)
  └─ prd_documents ──(1:N)── ticket_drafts ──(push)── Jira tickets
```

---

## 14. Tools yang diekspos ke AI (Docmost group)

Selaras `PLAN.md` §4:

| Tool              | Argumen                      | Akses | Catatan                      |
| ----------------- | ---------------------------- | ----- | ---------------------------- |
| `doc_search`      | `query, space_id?`           | read  | cari PRD                     |
| `doc_get_page`    | `page_id, format="markdown"` | read  | ambil isi                    |
| `doc_list_spaces` | –                            | read  | untuk mapping                |
| `doc_write_back`  | `page_id, content`           | write | **opsional**, butuh approval |

Aturan:

- Default AI = **read-only** untuk Docmost; write-back hanya setelah approval (atau mode auto bila
  user izinkan).
- Setiap tool call dicatat untuk audit & replay.

---

## 15. Contoh alur pemakaian (kode semu)

```ts
// 1. resolve integrasi efektif untuk project
const integ = await resolveProjectIntegrations(projectId);
const doc = createDocmostClient(integ.docmost);

// 2. cari + baca PRD
const hits = await doc.search("checkout redesign", integ.docmost.spaceId);
const prd = await doc.getDocument(hits[0].id, "markdown");

// 3. simpan cache + cek idempotency
const hash = sha256(prd.content);
const cached = await upsertPrdDocument({
  projectId,
  pageId: prd.id,
  version: prd.version,
  hash,
  markdown: prd.content,
});

// 4. teruskan ke Planner (lihat PLAN.md §3)
const draft = await planner.generateTickets(prd.content, projectContext);

// 5. setelah push ke Jira, tulis balik link (opsional)
await doc.comment(prd.id, `Tiket dibuat: ${createdKeys.join(", ")}`);
```

---

## 16. Checklist implementasi

- [ ] `ProjectIntegration` untuk `kind="docmost"` (mode `api`/`mcp`) + enkripsi secret.
- [ ] `DocProvider` + `RestDocProvider` + `McpDocProvider` + `MockDocProvider`.
- [ ] `createDocmostClient(cfg)` factory (bukan env global).
- [ ] `testIntegrationAction("docmost")` untuk health-check + list spaces.
- [ ] Cache `prd_documents` + idempotency via hash.
- [ ] Endpoint internal: sync PRD, render markdown di UI.
- [ ] Write-back opsional (comment/update) dengan optimistic concurrency + audit.
- [ ] Error handling, rate limit, retry, dan masking saat integrasi `unavailable`.
- [ ] Fallback mode manual (paste/import markdown) bila lisensi enterprise tidak ada.

---

## 17. Pertanyaan terbuka

1. Apakah instance Docmost punya **lisensi Business/Enterprise** (API/MCP aktif)?
2. Cloud atau self-hosted? (menentukan `baseUrl` & kebijakan egress)
3. Perlu **write-back** ke PRD, atau cukup read-only?
4. Gunakan **MCP** atau REST API?
5. Satu space per project, atau berbagi space antar project?
