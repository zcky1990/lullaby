# Integrasi Jira — Target Tiket & Sumber Kebenaran Status

Turunan teknis dari `PLAN.md` §1B & §9, `CODE_EDITING_LOOP.md`, dan `STACK_TS.md` §7. Dokumen ini
menjelaskan **secara detail** bagaimana aplikasi membuat, menyinkronkan, dan menggerakkan tiket di
**Jira** — termasuk **ADF**, **bulk create**, **JQL search**, **transitions**, **webhook**, dan
**linking ke GitHub**.

> Ringkas: Jira = **target tiket** sekaligus **sumber kebenaran (SoT) status**. Aplikasi = lapisan
> orkestrasi + Kanban. Semua perubahan status berpusat di Jira, aplikasi hanya mencerminkan (mirror)
> dan menggerakkan lewat transition API/webhook.

> **Status implementasi.** Yang sudah berjalan:
> `GET /rest/api/3/myself` (health-check), `POST /rest/api/3/search/jql` (daftar tiket),
> `GET /rest/api/3/issue/{key}` (detail; deskripsi **ADF → teks**), `GET/POST
> /rest/api/3/issue/{key}/transitions` (pindah status via drag Kanban). Menu **Ticket** menampilkan
> **Kanban** kolom tetap (Backlog/To Do/In Progress/Test/Done) + dialog detail + filter assignee.
> Fallback otomatis: `/search/jql` ⇄ `/search` (legacy `410 Gone` di Cloud) dan `v3` ⇄ `v2`
> (Data Center).
> **Kredensial:** `email` + API token (Basic, Jira Cloud) **atau** token saja (Bearer, Data
> Center/PAT); disimpan **plaintext** di `config`. `projectKey` **opsional** untuk test koneksi
> (wajib saat memuat tiket); `baseUrl` dengan suffix `/rest/api/N` dinormalisasi. **Belum:**
> create/bulk create, webhook, linking GitHub.

---

## 1. Peran Jira dalam alur end-to-end

```
Docmost (PRD) -> Planner -> Draft tiket -> [Gate1] -> Jira (bulk create)
                                                         |
                        status = In Progress (Jira webhook: issue_updated)
                                                         v
                                          Coder loop (sandbox) -> PR -> [Gate3] -> merge -> Done
```

- **Gate 1**: approve draft sebelum push `POST /issue/bulk`.
- Jira memicu coding loop lewat **webhook `jira:issue_updated`** ketika status -> `In Progress`.
- Aplikasi **memindahkan status** tiket via **transition API** sesuai hasil loop (mis.
  `CODING -> TESTING -> READY_FOR_REVIEW`).
- **Gate 3** (approve merge) tetap human gate; merge -> status `Done`.

---

## 2. Autentikasi & base URL

| Deployment                    | Auth                                                          | Base URL                                                 |
| ----------------------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| **Jira Cloud**                | Basic auth `base64(email:api_token)` **atau** OAuth 2.0 (3LO) | `https://<site>.atlassian.net/rest/api/3`                |
| **Jira Cloud (OAuth 3LO)**    | Bearer access token (refreshable)                             | `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3` |
| **Jira Data Center / Server** | PAT / Basic                                                   | `https://<host>/rest/api/3`                              |

- API **v3** memakai **ADF (Atlassian Document Format)** untuk `description` & komentar -> perlu
  **converter markdown -> ADF** (lihat §5).
- Simpan kredensial **terenkripsi** di `project_integrations` (`kind="jira"`).
- Untuk multi-user, gunakan **OAuth 2.0 (3LO)**; untuk single-service, Basic/PAT cukup.

Contoh Basic auth:

```http
POST /rest/api/3/issue HTTP/1.1
Host: acme.atlassian.net
Authorization: Basic <base64(email:api_token)>
Content-Type: application/json
```

---

## 3. Ringkasan endpoint yang dipakai

| Kegunaan                    | Endpoint                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| Buat tiket                  | `POST /issue` (fields: project, issuetype, summary, description/**ADF**, labels, priority, parent) |
| Bulk buat                   | `POST /issue/bulk` (maks **50**/call)                                                              |
| Metadata field & issue type | `GET /issue/createmeta/{projectKey}/issuetypes`                                                    |
| Search untuk sync           | `POST /search` atau `GET /search/jql` dengan `jql`, `fields`, `maxResults`, `nextPageToken`        |
| Detail/update               | `GET/PUT /issue/{key}`                                                                             |
| Pindah kolom kanban         | `GET/POST /issue/{key}/transitions`                                                                |
| Transisi yang tersedia      | `GET /issue/{key}/transitions?expand=transitions.fields`                                           |
| Komentar                    | `POST /issue/{key}/comment`                                                                        |
| Realtime                    | **Webhook**: `jira:issue_created`, `jira:issue_updated`                                            |

---

## 4. Membuat tiket

### 4.1 Satu tiket — `POST /issue`

```jsonc
{
  "fields": {
    "project": { "key": "PROJ" },
    "issuetype": { "name": "Story" },
    "summary": "Checkout: validasi alamat",
    "description": {/* ADF */},
    "labels": ["backend", "checkout"],
    "priority": { "name": "High" },
    "parent": { "key": "PROJ-100" } // epic
  }
}
```

- `description` **wajib ADF**, bukan string markdown.
- Field wajib & issuetype valid harus divalidasi dulu (lihat §4.3).

### 4.2 Bulk create — `POST /issue/bulk`

```jsonc
{
  "issueUpdates": [
    {
      "fields": {
        "project": { "key": "PROJ" },
        "issuetype": { "name": "Story" },
        "summary": "…",
        "description": {/* ADF */}
      }
    },
    {
      "fields": {
        "project": { "key": "PROJ" },
        "issuetype": { "name": "Task" },
        "summary": "…",
        "description": {/* ADF */}
      }
    }
  ]
}
```

- **Maksimum 50 issue per call** -> batch otomatis bila draft > 50.
- Respons memuat `issues[]` (berhasil) dan `errors[]` (gagal per-item) -> simpan pemetaan
  `draftId -> jiraKey` untuk yang berhasil saja.

Strategi batch:

```ts
for (const batch of chunk(approvedDrafts, 50)) {
  const res = await jira.bulkCreate(batch.map(toJiraFields));
  await persistPushedMappings(res.issues); // draftId/index -> key
  await handleBulkErrors(res.errors); // tandai draft gagal
}
```

### 4.3 Validasi sebelum POST — `GET /issue/createmeta/{projectKey}/issuetypes`

Ambil schema project untuk memvalidasi:

- issuetype yang tersedia (`Story`, `Task`, `Bug`, `Epic`, …);
- field wajib (`required`) & nilainya;
- nilai `priority` yang valid;
- opsi `labels`/`components` yang ada.

Jalankan validasi ini **sebelum** kirim ke `POST /issue/bulk` untuk menghindari kegagalan massal.
Simpan schema per project (cache) dan refresh berkala.

---

## 5. Konversi Markdown -> ADF

`description` dan komentar v3 memakai ADF. Perlu converter (mis. `md-to-adf` atau implementasi
sendiri) yang mendukung minimal:

| Markdown                     | ADF node                                  |
| ---------------------------- | ----------------------------------------- |
| Heading `#`..`######`        | `heading` (attrs.level)                   |
| Paragraf                     | `paragraph`                               |
| **bold** / _italic_ / `code` | `text` + `marks` (strong/em/code)         |
| List `-` / `1.`              | `bulletList` / `orderedList` + `listItem` |
| Checklist `- [ ]`            | `taskList` + `taskItem`                   |
| Code block                   | `codeBlock`                               |
| Link `[t](u)`                | `text` + mark `link`                      |
| Tabel                        | `table` (opsional)                        |
| Blockquote `>`               | `blockquote`                              |

Contoh ADF sederhana:

```json
{
  "type": "doc",
  "version": 1,
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 2 },
      "content": [{ "type": "text", "text": "Acceptance Criteria" }]
    },
    {
      "type": "bulletList",
      "content": [
        {
          "type": "listItem",
          "content": [
            {
              "type": "paragraph",
              "content": [{ "type": "text", "text": "Validasi alamat tidak kosong" }]
            }
          ]
        }
      ]
    }
  ]
}
```

Praktik: simpan **keduanya** — markdown asli (untuk edit/rendering di aplikasi) dan ADF (untuk
dikirim ke Jira). Konversi dilakukan **hanya saat** create/update.

---

## 6. Distribusi tiket: epic / story / sub-task

Pemetaan dari output Planner (`PLAN.md` §3) ke Jira:

| Draft                         | Jira                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `epic`                        | issue `Epic` (parent = none)                                                       |
| `stories[].parent = "epic-0"` | issue `Story` dengan `parent` = key epic                                           |
| sub-task                      | issue `Sub-task` dengan `parent` = key story (atau `sub-task` field sesuai scheme) |

Urutan create: **Epic dulu** (dapat key) -> baru Story (pakai key epic sebagai `parent`) -> baru
Sub-task. Untuk efisiensi, gunakan `POST /issue/bulk` per level.

---

## 7. Sinkronisasi status (search + webhook)

### 7.1 Pull — `POST /search` / `GET /search/jql`

```jsonc
// POST /search
{
  "jql": "project = PROJ AND updated >= -1d ORDER BY updated DESC",
  "fields": ["summary", "status", "assignee", "priority", "sprint", "labels", "updated"],
  "maxResults": 100
}
```

- Gunakan **`nextPageToken`** (endpoint baru) untuk paginasi -> simpan di `sync_cursors`.
- JQL minimal: filter per project + `updated >= cursor` untuk sync inkremental.

### 7.2 Push — Webhook Jira

- Event: **`jira:issue_created`**, **`jira:issue_updated`**.
- Verifikasi **signature** sebelum memproses.
- **Dedup** berdasarkan `event id`/`issue key` + `updated` timestamp (idempotent).
- Simpan raw event ke `webhook_events` dengan status proses.

```json
{
  "webhookEvent": "jira:issue_updated",
  "issue": { "key": "PROJ-123", "fields": { "status": { "name": "In Progress" } } },
  "changelog": {
    "items": [{ "field": "status", "fromString": "To Do", "toString": "In Progress" }]
  }
}
```

> **Trigger coding loop**: saat `changelog` menunjukkan status -> `In Progress`, aplikasi membuat
> `WorkflowRun` (lihat `CODE_EDITING_LOOP.md`). Gunakan **lock per tiket** agar event ganda tidak
> memicu dua worker (§11).

---

## 8. Transitions (menggerakkan Kanban)

Untuk memindahkan tiket antar status, **bukan** PUT status langsung — pakai transition:

1. `GET /issue/{key}/transitions` -> daftar `{ id, name, to.status }` yang tersedia untuk **status
   saat ini** (transisi bersifat kontekstual).
2. `POST /issue/{key}/transitions` dengan `{ "transition": { "id": "<id>" } }`.
3. Opsional: `GET /issue/{key}/transitions?expand=transitions.fields` untuk field wajib pada screen
   transisi (mis. resolution saat `Done`).

```ts
const { transitions } = await jira.getTransitions(key);
const t = transitions.find((x) => x.to.name === targetStatus);
if (!t) throw new Error(`Transisi ${key} -> ${targetStatus} tidak tersedia`);
await jira.transition(key, t.id);
```

Pemetaan Kanban: kolom UI <-> status Jira disimpan di `kanban_columns` (`status_to_column`), lihat
`PLAN.md` §5b.

---

## 9. State machine tiket <-> status Jira

Selaras `PLAN.md` §9.3 & `CODE_EDITING_LOOP.md`:

```
DRAFT -> APPROVED -> QUEUED -> CODING <-> TESTING -> READY_FOR_REVIEW
                                   |  (gagal, di bawah limit)
                                   +-> CODING
   -> IN_REVIEW -> MERGED -> DONE
   -> BLOCKED / ESCALATED / FAILED   (limit/budget habis -> butuh manusia)
```

Pemetaan default (dapat dikonfigurasi 1:1 di `status_to_column`):

| State aplikasi                 | Status Jira (default)   |
| ------------------------------ | ----------------------- |
| `DRAFT`                        | (belum ada tiket)       |
| `QUEUED`                       | `To Do`                 |
| `CODING`                       | `In Progress`           |
| `TESTING`                      | `In Review` / `Testing` |
| `READY_FOR_REVIEW`             | `Ready for Review`      |
| `IN_REVIEW`                    | `In Review`             |
| `MERGED`                       | `Done` / `Merged`       |
| `DONE`                         | `Done`                  |
| `BLOCKED`/`ESCALATED`/`FAILED` | `Blocked` / `Escalated` |

Setiap perubahan state aplikasi -> `POST /issue/{key}/transitions` (idempotent: lewati bila sudah
berada di status target).

---

## 10. Sumber kebenaran & anti echo-loop

Risiko: tiket ada di **aplikasi dan** Jira -> dua arah bisa saling menimpa.

- **Pilih satu SoT status: Jira.** Aplikasi = mirror + orkestrasi (lihat `PLAN.md` §9.9).
- Semua write balik ke Jira diberi **idempotency key**.
- **Dedup** webhook + **lock per tiket** agar tidak ada dua worker menangani tiket sama.
- Aplikasi **tidak** menulis status yang berasal dari eventnya sendiri (loop guard: bandingkan
  `updated`/`changelog` sebelum apply).

---

## 11. Konkurensi & idempotency

- **1 tiket = 1 branch = 1 sandbox**, dengan **distributed lock** selama diproses
  (`CODE_EDITING_LOOP.md` §12).
- Trigger webhook di-dedup dengan `(issueKey, changelogId/hash)`.
- Transition di-skip bila status saat ini sudah == target (mencegah error transisi).
- Bulk create idempotent via `draftId` yang sudah `pushed` -> jangan buat ulang.

---

## 12. Penanganan error & rate limit

| Situasi                   | Penanganan                                                                        |
| ------------------------- | --------------------------------------------------------------------------------- |
| 400 validation error      | Tandai draft gagal + tampilkan field yang ditolak (dari `createmeta`)             |
| 401/403                   | Kredensial invalid/expired -> tandai integrasi `unavailable`; refresh OAuth token |
| 404 issue                 | Tiket dihapus -> tandai `ticket_links` stale                                      |
| **429**                   | Hormati `Retry-After`; exponential backoff + jitter                               |
| `issue/bulk` partial fail | Simpan `issues[]` sukses, tandai `errors[]` gagal per-item                        |
| Transisi tidak tersedia   | Refresh daftar transitions; bila tetap tidak ada -> `ESCALATE`                    |
| 5xx                       | Retry terbatas lalu tandai `degraded`                                             |

Catatan: Jira mengembalikan **`429`**; GitHub memakai `Retry-After` (lihat `PLAN.md` §8).

---

## 13. Keamanan

- Token **encrypted at rest** (AES-256-GCM), hanya didekripsi di server.
- **Least privilege**: OAuth scope / PAT dibatasi ke project yang dipakai.
- **Verifikasi signature** webhook (HMAC) sebelum memproses event.
- **Audit log** semua aksi write AI (create/transition/comment) ke `ai_runs`/`ai_tool_calls`.
- Redact token & data sensitif di log.
- Rate limit + backoff.

---

## 14. Konfigurasi (contoh)

```jsonc
// project_integrations (kind = "jira")
{
  "kind": "jira",
  "mode": "api", // "api" | "mcp"
  "config": {
    "baseUrl": "https://acme.atlassian.net",
    "cloudId": "xxxxxxxx-xxxx-xxxx", // untuk OAuth 3LO
    "deployment": "cloud", // "cloud" | "data-center"
    "projectKey": "PROJ",
    "issueTypes": { "epic": "Epic", "story": "Story", "task": "Task", "subtask": "Sub-task" },
    "priorityMap": { "must have": "High", "should have": "Medium", "nice": "Low" }
  },
  "secret": {
    // salah satu:
    "email": "bot@example.com",
    "apiTokenEnc": "…", // Basic (cloud)
    "patEnc": "…", // Data Center
    "oauth": { "accessTokenEnc": "…", "refreshTokenEnc": "…", "expiresAt": "…" }
  }
}
```

Mapping Kanban & status:

```jsonc
// kanban_columns / status_to_column
{
  "TODO": "To Do",
  "CODING": "In Progress",
  "TESTING": "In Review",
  "READY_REVIEW": "Ready for Review",
  "DONE": "Done"
}
```

---

## 15. Pemetaan ke skema data

| Tabel                       | Peran untuk Jira                                                                 |
| --------------------------- | -------------------------------------------------------------------------------- |
| `project_integrations`      | `kind="jira"`, mode + config + secret                                            |
| `ticket_drafts`             | status `draft`/`approved`/`pushed`; simpan `jiraKey` setelah push                |
| `tickets`                   | mirror tiket Jira: `key, summary, status, assignee, sprint, priority, updatedAt` |
| `ticket_links`              | relasi tiket <-> branch <-> PR <-> commit (link GitHub)                          |
| `kanban_columns`            | kolom UI + `status_to_column`                                                    |
| `webhook_events`            | raw event + status proses (idempotent)                                           |
| `sync_cursors`              | posisi terakhir sync (`nextPageToken`/`updated`)                                 |
| `ai_runs` / `ai_tool_calls` | audit tool Jira                                                                  |

Relasi:

```
Project (root)
  └─ project_integrations(kind=jira)
  └─ ticket_drafts ──(push)── tickets ──(1:N)── ticket_links ── GitHub (branch/PR/commit)
```

---

## 16. Linking Jira <-> GitHub

Strategi: branch/commit/PR yang memuat **Jira key** (`PROJ-123`) otomatis ter-link.

- **Branch**: `POST /repos/{o}/{r}/git/refs` `{ ref: "refs/heads/PROJ-123", sha }`.
- **PR**: judul/body memuat `PROJ-123` -> tampil di kartu Kanban.
- **Deteksi**: webhook `pull_request`/`push`/`check_run` (GitHub) **atau**
  `GET /search/issues?q=repo:o/r+PROJ-123` (GitHub search).
- Simpan relasi di `ticket_links` (`branch`, `prNumber`, `commitSha`).
- Kembali ke Jira: komentar PR link -> `POST /issue/{key}/comment` (opsional).

Detail sisi GitHub ada di `PLAN.md` §1C (dapat dipecah ke `github.md` bila perlu).

---

## 17. Tools yang diekspos ke AI (Jira group)

Selaras `PLAN.md` §4:

| Tool                      | Argumen                    | Akses | Catatan                            |
| ------------------------- | -------------------------- | ----- | ---------------------------------- |
| `jira_get_project_schema` | `project_key`              | read  | valid issuetypes/fields/priorities |
| `jira_create_issue`       | `fields`                   | write | approval-gated                     |
| `jira_bulk_create`        | `issues[]`                 | write | maks 50/call                       |
| `jira_search`             | `jql`                      | read  | untuk sync                         |
| `jira_transition`         | `issue_key, target_status` | write | cari id transisi                   |
| `jira_comment`            | `issue_key, body`          | write | markdown -> ADF                    |

Aturan: default AI **read-only**; write hanya setelah approval. Semua call dicatat.

---

## 18. Contoh alur pemakaian (kode semu)

```ts
const integ = await resolveProjectIntegrations(projectId);
const jira = createJiraClient(integ.jira);

// 1. validasi schema sebelum push
const meta = await jira.getCreateMeta(integ.jira.projectKey);
const valid = approvedDrafts.filter((d) => validateAgainst(meta, d));

// 2. create epic dulu, lalu story/sub-task (bulk, <=50/call)
const epics = await jira.bulkCreate(valid.filter(isEpic).map(toJiraFields));
const stories = await jira.bulkCreate(valid.filter(isStory).map((d) => toJiraFields(d, epics)));
await persistPushedMappings([...epics.issues, ...stories.issues]);

// 3. saat loop coding selesai (lihat CODE_EDITING_LOOP.md):
await transitionByStatus(jira, "PROJ-123", "Ready for Review");

// 4. komentar link PR (opsional)
await jira.comment("PROJ-123", mdToAdf("PR: https://github.com/o/r/pull/42"));
```

---

## 19. Checklist implementasi

- [ ] `ProjectIntegration` untuk `kind="jira"` (Basic/PAT/OAuth 3LO) + enkripsi secret.
- [ ] `TicketProvider` + `RestJiraProvider` + `McpJiraProvider` + `MockJiraProvider`.
- [ ] `createJiraClient(cfg)` factory + `testIntegrationAction("jira")`.
- [ ] **Markdown -> ADF** converter + test unit.
- [ ] `getCreateMeta` (validasi) + bulk create (batch 50) + persist `draftId -> jiraKey`.
- [ ] Transition helper (`getTransitions` + `transition`) + pemetaan `status_to_column`.
- [ ] Webhook receiver: verifikasi signature, dedup, simpan `webhook_events`, lock per tiket.
- [ ] Sync pull via JQL + `nextPageToken` ke `sync_cursors`.
- [ ] Linking GitHub (`ticket_links`) via Jira key.
- [ ] Error handling (429/Retry-After), rate limit, retry, idempotency, loop guard.

---

## 20. Pertanyaan terbuka

1. **Jira Cloud atau Data Center?** (menentukan auth & handler ADF/transitions)
2. **OAuth 3LO** (multi-user) atau Basic/PAT (single-service)?
3. **Issue type & workflow** yang dipakai? (untuk schema validation & mapping kolom)
4. Apakah field wajib saat transisi ke `Done` (mis. `resolution`)?
5. Apakah AI boleh **auto-transition** (mis. `In Progress -> Testing`) atau perlu human gate?
6. Satu project Jira per project aplikasi, atau berbagi project?
