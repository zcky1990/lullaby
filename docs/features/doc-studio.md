# Doc Studio (dokumen terpandu AI)

Menu **Doc Studio** membuat dokumen kerja (PRD, BRD, RFC, RCA, dst.) dengan cara **AI
mewawancarai user dulu**, lalu menulis dokumennya sesuai kerangka tipe dokumen. Hasilnya
disimpan sebagai file `.md` di *document workspace* project, sehingga langsung muncul di menu
**Document** (tab Document).

## Alur

1. Pilih project (menu Doc Studio hanya aktif bila ada project).
2. Pilih tipe dokumen pada daftar (PRD, BRD, RFC, RCA, ADR, Tech Spec, Postmortem, Runbook,
   atau tipe kustom).
3. AI bertanya **satu pertanyaan per giliran** (maks 2 kalimat). Semua topik interview milik
   tipe dokumen harus terjawab.
4. Setelah topik cukup, AI menandai `ready` (badge **Siap** + hint). Tombol **Buat dokumen**
   juga bisa ditekan manual setelah ada minimal satu jawaban.
5. **Buat dokumen** → AI menulis markdown penuh mengikuti outline → file `.md` dibuat di
   document workspace project → path ditampilkan. Buka menu **Document** untuk melihat/menyunting.
6. Draft interview tersimpan (`doc_drafts`), jadi bisa dilanjutkan setelah aplikasi restart
   atau setelah pindah menu.

## Tipe dokumen bawaan

| Id | Label | Outline (ringkas) |
| --- | --- | --- |
| `prd` | PRD | Problem, Goals, Target Users, Scope, User Stories, Requirements, UX, Dependencies, Risks, Rollout, Open Questions |
| `brd` | BRD | Business Context/Objectives, Scope, Stakeholders, As-Is/To-Be, Business Requirements, KPI, Risks, Cost & Benefit, Approval |
| `rfc` | RFC | Summary, Motivation, Guide/Reference-level Design, Alternatives, Drawbacks, Migration, Security, Observability, Open Questions |
| `rca` | RCA | Incident Summary, Impact, Timeline, Detection, Root Cause, Contributing Factors, Resolution, 5 Whys, Action Items |
| `adr` | ADR | Context, Decision, Options, Consequences, Status, References |
| `tech-spec` | Tech Spec | Overview, Goals/Non-Goals, Architecture, Data Model, API, Errors, Security, Testing, Rollout |
| `postmortem` | Postmortem | Summary, Impact, Timeline, Root Causes, Went Well/Wrong, Action Items, Lessons |
| `runbook` | Runbook | Service Overview, Preconditions, Symptoms, Diagnosis, Mitigation, Rollback, Escalation |

Tipe kustom (maks 20) bisa ditambahkan di **Global Settings → Doc Studio**; tipe kustom dengan id
sama menimpa tipe bawaan.

## Konfigurasi (Global Settings → Doc Studio)

Disimpan sebagai satu key `app_settings.doc_studio` (JSON):

| Field | Arti |
| --- | --- |
| `defaultRoleId` | Role default. Persona role di-*prepend* ke system prompt interview. |
| `defaultProviderId` | Provider default bila role terpilih tidak punya provider. |
| `language` | `auto` (ikut bahasa user) / `id` / `en` — bahasa output. |
| `types[<typeId>].roleId` | Override role per tipe dokumen. |
| `types[<typeId>].prompt` | Override system prompt interview per tipe (maks 20.000 karakter). |
| `customTypes[]` | Tipe dokumen kustom (`id`, `label`, `description`, `outline[]`, `interviewTopics[]`). |

Urutan resolusi provider: `role.provider_id` → `defaultProviderId` → provider pertama yang ada.
Urutan resolusi role: role draft → role tipe → role default.

Prompt bawaan interview ada di `src/server/docstudio/prompts.ts`
(`DEFAULT_DOC_STUDIO_PROMPT`); override menggantikan aturan bawaan, bukan menambahnya.
Prompt finalize selalu memakai aturan bawaan + outline tipe + override tipe (bila ada).

## Endpoint

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/api/doc-studio/templates` | Tipe dokumen (bawaan + kustom) + config efektif tipe |
| GET | `/api/settings/doc-studio` | Config + nama role + `defaultPrompt` + `customized` |
| PUT | `/api/settings/doc-studio` | Simpan config (partial-safe: field absen tidak menimpa) |
| POST | `/api/projects/:id/doc-studio/drafts` | Mulai interview `{ typeId, roleId? }` |
| GET | `/api/projects/:id/doc-studio/drafts` | Daftar draft (untuk resume) |
| GET | `/api/projects/:id/doc-studio/drafts/:draftId` | Detail draft + transkrip |
| POST | `/api/projects/:id/doc-studio/drafts/:draftId/turns` | Kirim jawaban `{ message }` |
| POST | `/api/projects/:id/doc-studio/drafts/:draftId/finalize` | Tulis dokumen `{ title? }` → `document.path` |
| DELETE | `/api/projects/:id/doc-studio/drafts/:draftId` | Hapus draft |

Semua endpoint butuh token aplikasi (cookie/header yang sama dengan API lain).
Error penting: `401 unauthorized`, `400 document_workspace_missing` (document workspace project
belum diatur), `400 llm_not_configured` (belum ada provider LLM), `400 template_not_found`,
`400 draft_already_saved`.

### Catatan routing

Handler modul ini (`src/server/routes/doc-studio.ts`) memetakan **path + method** lewat
`matchDocStudioRoute()`. Koleksi `drafts` melayani dua operasi berbeda pada path yang sama —
`GET` = daftar draft, `POST` = mulai interview — sehingga mode-nya ditentukan di fungsi itu
(bukan ditebak dari path saja). Menambah operasi baru pada path yang sudah ada wajib lewat
fungsi tersebut; sebelumnya `POST /drafts` ikut dirutekan ke handler daftar sehingga memulai
interview selalu gagal dengan `405 method_not_allowed`.

## Penyimpanan

- Tabel `doc_drafts` (dibuat lazy di `src/db/doc-drafts.ts`, cascade delete saat project dihapus):
  `id, project_id, type_id, role_id, title, transcript (JSON), status, document_path, created_at, updated_at`.
- `status`: `interviewing` → `ready` → `saved`.
- Dokumen final = file `.md` di `projects.document_path` (dibuat via `createLocalDocument` lalu
  diisi dengan `updateLocalDocument`, batas 500 KB per dokumen).

## Batasan

- Interview **non-streaming**: satu panggilan LLM per giliran (tanpa tool), jadi latensi terasa
  pada model lambat. Transkrip dikirim maksimal 24 giliran terakhir (masing-masing ≤8.000 karakter).
- Model kadang tidak mengikuti sentinel `[[READY]]`; karena itu tombol **Buat dokumen** selalu
  bisa dipakai manual setelah ada jawaban user.
- Dokumen dengan section yang datanya tidak ada tetap ditulis dengan `_TBD_` (tidak dikarang).
- Panel dirender dari `ActivityBar` (bukan `App.tsx`) supaya tidak menyentuh shell besar; karena
  itu tombol "buka dokumen" langsung di panel baru aktif bila `App.tsx` memberi prop
  `onSelectLocalDocument`. Tanpa itu, file baru tetap muncul di menu Document setelah panel
  ditutup/dibuka.

## Terkait

- Dokumentasi dokumen lokal/remote: [`documents.md`](documents.md)
- Prompt chat/plan/ticket: [`settings.md`](settings.md)
- Model data: [`../data-model.md`](../data-model.md), endpoint: [`../api.md`](../api.md)
