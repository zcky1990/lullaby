# Plan: AI Orchestrator (Docmost + Jira + GitHub + Kanban)

> Asumsi: "docmos" = **Docmost** (open-source wiki). Kalau ternyata tool internal lain, bagian A
> tinggal diganti.

> **Status implementasi (F0).** Aplikasi dibangun sebagai **Deno Desktop** app.
> **Sudah:** project + workspace, integrasi Docmost/Jira/GitHub/LLM (config + health-check + list
> document/ticket), Explorer (file tree + Monaco), **Kanban tiket** (drag = transition, dialog detail,
> filter assignee), menu ala VSCode (Workspace/Explorer/
> Document/Ticket/Project Settings/Global Settings), SSE activity, theming.
> **Belum:** §3 (generate tiket AI), §4 tools AI, M3 push Jira, Kanban geser-sinkron penuh (board
> tampilan Kanban sudah ada), §9 autonomous coding loop,
> MCP. Lihat `README.md` §Status & `STACK_RECOMMENDATION.md` §0.

---

## 0. Alur besar (end-to-end)

```
Docmost (PRD)  --read-->  AI Engine  --draft-->  Review UI  --approve-->  Jira (tickets)
                                                  |
                            Kanban UI  <--sync----+---->  GitHub (branch/PR/commit)
```

1. Ambil PRD dari Docmost.
2. AI baca PRD -> pecah jadi epic/story/sub-task + acceptance criteria.
3. User review & edit draft (belum push ke Jira).
4. Push ke Jira (bulk create).
5. Kanban menarik status dari Jira + aktivitas GitHub.
6. Aktivitas GitHub (branch/PR/commit) otomatis ter-link ke tiket via Jira key.

---

## 1. API yang dipakai

### A. Docmost — sumber PRD

- **Auth**: `Authorization: Bearer <API_KEY>` (Setting -> API keys) atau **OAuth via MCP**. Catatan:
  API & MCP = **fitur enterprise** (butuh lisensi Business/Enterprise).
- **Base**: `https://<docmost-host>/api` (global prefix `api`).

| Kegunaan                    | Endpoint                        | Body utama                       |
| --------------------------- | ------------------------------- | -------------------------------- |
| Cari PRD                    | `POST /api/search`              | `{ query, spaceId? }`            |
| Baca isi page (PRD)         | `POST /api/pages/info`          | `{ pageId, format: "markdown" }` |
| List spaces                 | `POST /api/spaces/`             | `{}` (pagination)                |
| List page dalam space       | `POST /api/pages/sidebar-pages` | `{ spaceId }`                    |
| Tulis balik (link Jira key) | `POST /api/pages/update`        | `{ pageId, content, format }`    |
| Komentar balik ke PRD       | `POST /api/comments/create`     | `{ pageId, content }`            |

- `format` bisa `json` (editor doc), `markdown`, atau `html` — pakai `markdown` agar mudah dikirim
  ke LLM.
- **Alternatif MCP**: server `https://<docmost-host>/mcp`, tools siap pakai: `search_pages`,
  `get_page`, `list_spaces`, `create_page`, `update_page`, `create_comment`, dll. Kalau AI kita
  mendukung MCP, ini menghindari bikin adapter REST sendiri.

### B. Jira — target tiket

- **Auth**: Cloud -> Basic auth `email:api_token` (base64), atau **OAuth 2.0 (3LO)** untuk
  multi-user. Data Center -> PAT/Basic.
- **Base**: `https://<site>.atlassian.net/rest/api/3` (OAuth 3LO:
  `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3`)

| Kegunaan                          | Endpoint                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| Buat tiket                        | `POST /issue` (fields: project, issuetype, summary, description/**ADF**, labels, priority, parent) |
| Bulk buat                         | `POST /issue/bulk` (maks 50/call)                                                                  |
| Ambil metadata field & issue type | `GET /issue/createmeta/{projectKey}/issuetypes`                                                    |
| Search untuk sync                 | `POST /search` atau `GET /search/jql` dengan `jql`, `fields`, `maxResults`, `nextPageToken`        |
| Detail/update                     | `GET/PUT /issue/{key}`                                                                             |
| Pindah kolom kanban               | `GET/POST /issue/{key}/transitions`                                                                |
| Transisi yang tersedia            | `GET /issue/{key}/transitions?expand=transitions.fields`                                           |
| Komentar                          | `POST /issue/{key}/comment`                                                                        |
| Realtime                          | **Webhook**: `jira:issue_created`, `jira:issue_updated`                                            |

Catatan penting: API v3 pakai **ADF (Atlassian Document Format)** untuk `description`/komentar —
perlu converter markdown -> ADF.

### C. GitHub — kode

- **Auth**: GitHub App (disarankan, installation token) atau fine-grained PAT.
- **Header**: `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`.
- **Base**: `https://api.github.com`

| Kegunaan                  | Endpoint                                                             |
| ------------------------- | -------------------------------------------------------------------- |
| Info repo                 | `GET /repos/{owner}/{repo}`                                          |
| Cari PR/issue by Jira key | `GET /search/issues?q=repo:o/r+PROJ-123`                             |
| Buat branch dari tiket    | `POST /repos/{o}/{r}/git/refs` `{ ref: "refs/heads/PROJ-123", sha }` |
| List PR                   | `GET /repos/{o}/{r}/pulls?state=all`                                 |
| Status PR                 | `GET /repos/{o}/{r}/pulls/{number}`                                  |
| Komentar di PR            | `POST /repos/{o}/{r}/issues/{number}/comments`                       |
| Realtime                  | **Webhook**: `pull_request`, `push`, `check_run`, `issues`           |

**Strategi linking**: branch/commit/PR yang memuat Jira key (`PROJ-123`) -> deteksi via
webhook/search -> tampilkan di kartu kanban.

---

## 2. Komponen sistem (stack-agnostic)

```
+-----------------------------------------------------+
|  Web UI: Kanban | PRD Viewer | Ticket Review | Config|
+--------------+--------------------------------------+
               | (REST/WS internal)
+--------------v--------------------------------------+
|  Orchestrator Service (business logic + API internal)|
|   |- Adapter Docmost   (interface DocProvider)       |
|   |- Adapter Jira      (interface TicketProvider)    |
|   |- Adapter GitHub    (interface CodeProvider)      |
|   +- AI Engine (LLM + tool-calling loop)             |
+--------------+--------------------------------------+
      +--------+----------+-------------+
   Postgres   Queue/Worker  Secret Store  Webhook Receiver
```

Semua provider di belakang **interface seragam** supaya bisa ganti doc tool / tracker lain nanti:

```
DocProvider:    listSpaces, search, getDocument, annotate
TicketProvider: listProjects, getSchema, createIssues, search, transition, comment
CodeProvider:   getRepo, createBranch, listPRs, searchLinks
```

---

## 3. Alur & kontrak AI

**Input**: markdown PRD + konteks project (Jira field yang valid, label yang ada, template
definition-of-done).

**Output**: JSON terstruktur (structured output / JSON schema), contoh kontrak:

```json
{
  "epic": { "title": "...", "summary": "..." },
  "stories": [
    {
      "type": "Story",
      "title": "...",
      "description": "...",
      "acceptance_criteria": ["...", "..."],
      "priority": "High",
      "labels": ["backend"],
      "story_points": 5,
      "parent": "epic-0",
      "depends_on": []
    }
  ],
  "open_questions": ["..."]
}
```

**Prinsip**:

- **Human-in-the-loop**: AI menghasilkan _draft_, user approve baru push ke Jira. Wajib untuk
  hindari spam tiket.
- **Idempotency**: simpan hash PRD + `draft_id`; PRD yang belum berubah tidak digenerate ulang.
- **Chunking** untuk PRD panjang, lalu merge.
- **Validation**: cek field wajib Jira (project, issuetype, priority valid) sebelum POST.
- **Markdown -> ADF** converter untuk `description`.

---

## 4. Tools yang AI boleh pakai (function calling)

AI bukan sekadar prompt -> text; ia diberi **tools** dengan JSON schema, permission, dan audit.
Agent loop: pilih tool -> eksekusi -> observasi -> lanjut.

**Docmost group**

- `doc_search(query, space_id?)`
- `doc_get_page(page_id, format="markdown")`
- `doc_list_spaces()`
- `doc_write_back(page_id, content)` _(opsional, untuk link Jira key balik ke PRD)_

**Jira group**

- `jira_get_project_schema(project_key)` — valid issuetypes/fields/priorities
- `jira_create_issue(fields)` / `jira_bulk_create(issues[])`
- `jira_search(jql)`
- `jira_transition(issue_key, target_status)`
- `jira_comment(issue_key, body)`

**GitHub group**

- `gh_get_repo(owner, repo)`
- `gh_create_branch(repo, name, from_sha)`
- `gh_list_pull_requests(repo, state)`
- `gh_search_issues(repo, query)`

**Internal / control**

- `draft_save(...)`, `draft_request_approval(...)`, `link_jira_to_github(...)`

Aturan:

- Tiap tool punya **scope** (read/write) yang dikonfigurasi per project. Default AI = read-only;
  write hanya setelah approval (atau di mode auto kalau user izinkan).
- Semua tool call dicatat (`ai_runs`, `ai_tool_calls`) untuk audit & replay.
- Bisa juga **mengekspos orchestrator sebagai MCP server** agar agent eksternal (Claude/Cursor)
  dapat memicu alur yang sama.

---

## 5. Konfigurasi

**a. Koneksi integrasi** (secret terenkripsi, bukan plaintext):

```
docmost:  { base_url, auth_type: api_key|oauth, token(enc), workspace }
jira:     { base_url, auth_type: basic|oauth2, email, token(enc), cloud_id? }
github:   { auth_type: app|pat, app_id, private_key(enc)|token(enc), org }
ai:       { provider, model, api_key(enc), temperature, max_tokens }
```

**b. Mapping per project** (inti fleksibilitas):

```
project_mapping {
  docmost_space_id  ->  jira_project_key  ->  github_repo
  issue_type_scheme   (Story/Task/Bug default)
  priority_map        (PRD "must have" -> Jira "High")
  label_map
  status_to_column    (Jira status -> Kanban column)
  auto_push           (bool)
}
```

**c. Prompt templates** (editable, versioned): prompt untuk generate epic, story, acceptance
criteria, estimasi.

**d. Tool policy per project**: allowlist tool + read/write.

**e. Webhook config**: generate & simpan secret; untuk Jira & GitHub.

---

## 6. Skema data (PostgreSQL, garis besar)

| Tabel                          | Isi                                                        |
| ------------------------------ | ---------------------------------------------------------- |
| `integrations` / `credentials` | koneksi & secret (encrypted)                               |
| `project_mappings`             | peta space->project->repo + rules                          |
| `prd_documents`                | cache PRD (docmost page id, hash, markdown, versi)         |
| `ticket_drafts`                | hasil AI (JSON), status: draft/approved/pushed             |
| `tickets`                      | mirror tiket Jira (key, summary, status, assignee, sprint) |
| `ticket_links`                 | relasi tiket <-> branch <-> PR <-> commit                  |
| `kanban_columns`               | definisi kolom & mapping status                            |
| `ai_runs` / `ai_tool_calls`    | audit prompt, model, tool calls, biaya                     |
| `webhook_events`               | raw event + status proses (idempotent)                     |
| `sync_cursors`                 | posisi terakhir sync per integrasi                         |

---

## 7. API internal (dipakai UI)

```
POST /api/orchestrations            # { prd_page_id, mapping_id } -> jalankan AI
GET  /api/orchestrations/{id}       # status + progress
GET  /api/drafts?status=draft
PUT  /api/drafts/{id}               # edit manual
POST /api/drafts/{id}/approve       # push ke Jira
GET  /api/kanban?mapping_id=        # kolom + kartu
POST /api/webhooks/jira | /github   # receiver (verifikasi signature)
```

Kanban memperbarui kartu via polling ringan atau WebSocket; perubahan Jira/GitHub masuk lewat
webhook -> update `tickets`/`ticket_links` -> push ke UI.

---

## 8. Keamanan

- Secret **encrypted at rest**; jangan pernah simpan token di frontend.
- Token **least privilege** (Jira project-scoped, GitHub App dengan repo terbatas).
- **Verifikasi signature** webhook (HMAC) untuk Jira & GitHub.
- **Audit log** semua aksi AI & write ke sistem eksternal.
- Rate limit + backoff/retry untuk Jira/GitHub/Docmost.
- Rate limit file: `Retry-After` GitHub, `429` Jira.

---

## 9. Autonomous Coding Loop (In Progress -> Done)

Ini bukan sekadar "orkestrator tiket" lagi, melainkan **autonomous coding loop**. Alur yang dituju:

```
create PRD (Docmost)
  -> AI generate tiket di aplikasi
  -> user setuju -> push ke Jira
  -> tiket jadi In Progress -> LLM baca tiket & mulai coding
  -> coding selesai -> pindah ke Test -> AI jalankan test
  -> gagal -> update tiket dengan info bug -> coding lagi -> test lagi (loop)
  -> tidak ada bug -> tiket Done
```

### 9.1 Prinsip utama

- **Jangan bikin coding agent dari nol.** Bungkus coding agent yang sudah ada (Claude Code headless,
  Codex CLI, Aider, OpenHands, SWE-agent) sebagai "tangan".
- **Pisahkan otak (LLM) dan tangan (sandbox).** Tiap tiket dapat branch + container terisolasi.
- **3 peran agent terpisah**: Planner, Coder, **Verifier** (independen — jangan biarkan AI menilai
  pekerjaannya sendiri).
- **Loop wajib punya stop condition**: max iterasi, budget token/$, time cap, deteksi "no progress".
- **Test berlapis & dilindungi** (anti reward-hacking).
- **Auto sampai PR siap, tapi merge tetap human gate.** Jangan auto-merge by default.

### 9.2 Workflow engine (durable execution)

Prosesnya lama, berulang, menunggu event eksternal (webhook Jira), dan harus resume setelah crash —
itu definisi durable execution.

- Rekomendasi: **Temporal** (paling cocok) atau **Inngest / Restate**.
- Alternatif ringan (MVP): queue (Postgres `SKIP LOCKED` / Redis) + tabel state. Cukup untuk mulai,
  tapi cepat menyulitkan saat loop kompleks.

### 9.3 State machine tiket

```
DRAFT -> APPROVED -> QUEUED -> CODING <-> TESTING -> READY_FOR_REVIEW
                                   |  (gagal, masih di bawah limit)
                                   +-> CODING
   -> IN_REVIEW -> MERGED -> DONE
   -> BLOCKED / ESCALATED / FAILED   (limit atau budget habis -> butuh manusia)
```

Map tiap state ke status Jira (1:1), simpan di `status_to_column`.

### 9.4 Pisahkan otak & tangan

- **Tangan (execution)**: sandbox per tiket = `git worktree`/clone + container (Docker;
  gVisor/Firecracker untuk isolasi kuat). Isi sandbox: filesystem, shell, test runner, deps
  (docker-compose + DB seed).
- **Otak (LLM)**: hanya memanggil tool (`read_file`, `apply_patch`, `run_test`, `git_commit`).
- Sandbox **tanpa kredensial prod**; egress jaringan dibatasi; secret test di-inject terpisah.

### 9.5 Peran agent

| Peran        | Tugas                                                      | Kenapa terpisah                                        |
| ------------ | ---------------------------------------------------------- | ------------------------------------------------------ |
| **Planner**  | Baca PRD -> draft tiket + acceptance criteria              | Sekali, saat generate                                  |
| **Coder**    | Eksekusi AC -> buat diff + test baru                       | Loop utama                                             |
| **Verifier** | Jalankan test + static check, tulis bug report terstruktur | **Independen**; kalau Coder menilai sendiri, bug lolos |

Bug report **harus JSON**: `{ file, line, test_name, error, expected, actual, repro }`. Umpan balik
ini yang membuat loop konvergen, bukan "coba lagi saja".

### 9.6 Kontrak loop & stop conditions (wajib)

- Max iterasi (default **5**), budget token/$ per tiket, time cap.
- **No-progress detection**: error sama muncul 2x -> stop & **ESCALATE** ke manusia.
- Setiap iterasi = diff kecil yang bisa di-review; commit per iterasi.
- Idempotent & resumable (simpan cursor state).

Tanpa ini, loop `coding -> test -> coding` akan menghabiskan biaya tanpa henti.

### 9.7 Strategi test & anti reward-hacking

Definition of Done = semua hijau:

1. Existing test suite (regression gate — wajib).
2. Test baru yang ditulis AI untuk fitur.
3. Static: lint, typecheck, build.
4. Opsional: AI semantic review (bukan pengganti test).

Anti reward-hacking (AI "memperbaiki" test dengan menghapusnya):

- Coder **tidak boleh** mengubah/menghapus file test existing -> Verifier menolak diff yang
  menyentuh test lama.
- Deteksi anomali: jumlah test turun, `.skip`/`xfail` bertambah, assertion dilemahkan.
- Diff size limit; tolak perubahan di luar scope tiket.
- Karantina test flaky (jangan sampai false-fail memicu loop).

### 9.8 Git/PR flow & human gate

- Branch `PROJ-123` -> commit per iterasi -> push -> **buka PR** (link ke Jira).
- **Jangan commit ke main.**
- Gate manusia (default):
  - **Gate 1**: approve tiket hasil generate (sebelum push Jira).
  - **Gate 2**: approve **start coding** (opsional; bisa auto).
  - **Gate 3**: **approve merge** (wajib dipertahankan).
  - **Gate 4**: escalation saat limit/budget habis.

### 9.9 Sumber kebenaran & trigger

Risiko: tiket ada di aplikasi **dan** Jira -> dua arah bisa saling menimpa (echo loop).

- Pilih **satu** SoT status. Rekomendasi: **Jira = SoT status**, aplikasi = lapisan orkestrasi +
  Kanban.
- Trigger utama = **webhook Jira** (`issue_updated`), dengan **dedup + lock per tiket** agar tidak
  ada dua worker menangani tiket yang sama.
- Semua write balik ke Jira diberi idempotency key.

### 9.10 Konkurensi & isolasi

- 1 tiket = 1 branch = 1 sandbox, dengan **lock** selama proses.
- N worker paralel untuk tiket berbeda.
- Serialisasi perubahan pada file yang sama antar tiket (atau rebase otomatis + review).

### 9.11 Observability & biaya

- Log tiap: prompt, tool call, diff, hasil test, biaya -> tabel `ai_runs`, `ai_tool_calls`,
  `test_runs`.
- Dashboard: biaya per tiket, rata-rata iterasi, tingkat keberhasilan Verifier, tiket yang
  di-escalate.
- Cost cap per tiket -> hard stop.

### 9.12 Anti-pattern & mitigasi

| Anti-pattern              | Mitigasi                             |
| ------------------------- | ------------------------------------ |
| Loop tak berujung         | max iter + no-progress + budget      |
| AI hapus/lemahkan test    | proteksi file test + deteksi anomali |
| Flaky test memicu loop    | karantina + retry terbatas           |
| Diff raksasa              | diff size limit + scope check        |
| Menilai pekerjaan sendiri | Verifier independen                  |
| Auto-merge kode AI        | PR + human gate 3                    |
| Secret prod di sandbox    | sandbox tanpa kredensial prod        |

### 9.13 Diagram ringkas

```
PRD(Docmost) -> Planner -> Draft tiket -> [Gate1] -> Jira
                                          |
                       status=InProgress (Jira webhook)
                                          v
                     +--------------- Coder (sandbox) ---------------+
                     |                                               |
                     |        Verifier: run tests + static checks     |
                     |                  |                             |
                     |      pass? --no--> bug report(JSON) ----------+ (loop <= N)
                     |        |yes
                     +--------v
                        PR + [Gate3 review] -> merge -> DONE
                        (limit/budget habis -> ESCALATE)
```

### 9.14 Rekomendasi teknologi

- Workflow: **Temporal** (atau Inngest).
- Sandbox: **Docker + git worktree**; atau managed: E2B / Daytona / Modal / Fly Machines.
- Coding agent: **Claude Code headless / Codex CLI / Aider / OpenHands** (bungkus, jangan bikin).
- Verifier: runner test asli + LLM terpisah untuk bug report.
- AI provider: abstraksi agar bisa ganti (OpenAI/Claude/Gemini/local).

### 9.15 Skema data tambahan

| Tabel           | Isi                                                  |
| --------------- | ---------------------------------------------------- |
| `workflow_runs` | instance workflow per tiket (state, cursor, iterasi) |
| `agent_steps`   | tiap langkah agent (peran, prompt, tool call, hasil) |
| `sandboxes`     | environment run (branch, container id, status, TTL)  |
| `test_runs`     | hasil test per iterasi (suite, pass/fail, log)       |
| `bug_reports`   | bug report JSON dari Verifier + resolusi             |

---

## 10. Milestone

- **M0** — Connect & health-check ke Docmost, Jira, GitHub.
- **M1** — Fetch PRD dari Docmost, render markdown di UI.
- **M2** — AI generate draft tiket + layar review/edit.
- **M3** — Approve -> push ke Jira (bulk) + Kanban baca dari Jira.
- **M4** — GitHub link (branch/PR) + webhook sync dua arah.
- **M5** — Config UI, mapping rules, audit & monitoring.
- **M6** — Workflow engine (Temporal) + state machine tiket + sandbox per tiket.
- **M7** — Coder loop: branch -> coding -> Verifier test -> bug report -> retry (dengan stop
  conditions).
- **M8** — PR otomatis + human gate merge + dashboard biaya/iterasi.

---

## 11. Yang perlu dikonfirmasi sebelum implementasi

1. **Docmost punya lisensi Business/Enterprise?** API & MCP enterprise-only. Kalau tidak,
   alternatif: export/import markdown manual.
2. **Jira Cloud atau Data Center?** Menentukan auth (Basic/OAuth) dan ADF.
3. **Jira issue type & workflow** yang dipakai (untuk schema validation & mapping kolom).
4. **GitHub Cloud atau Enterprise Server?** Base URL berbeda.
5. **Provider AI** (OpenAI/Claude/Gemini/local) & di mana di-host.
6. Mode push: **selalu review** atau boleh **auto-push**.
