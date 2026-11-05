# Workflow (DAG)

Workflow engine lokal bergaya [Dagu](https://docs.dagu.sh): definisi YAML, dependency graph, eksekusi
shell paralel, retry/timeout, log per step, dan riwayat run. Run bisa **manual** dari UI,
**cron** (`schedule`), atau **event** bus (`on`).

## Penyimpanan definisi

- Workspace project: `<workspace>/.workflows/<slug>.yaml`
- Fallback tanpa workspace: `{appDataDir}/<project-slug>/workflows/<slug>.yaml`
- Slug = nama file tanpa `.yaml` (`^[a-zA-Z0-9_.-]+$`), tidak boleh diawali titik.

## YAML (subset Dagu)

```yaml
name: build-test
description: Build lalu test
env:
  NODE_ENV: test
working_dir: .
defaults:
  retry_policy:
    limit: 2
    interval_sec: 5
  timeout_sec: 600
steps:
  - id: install
    run: npm ci
  - id: build
    run: npm run build
    depends: install
  - id: unit
    run: npm test
    depends: install
  - id: package
    run: echo "package"
    depends: [build, unit]
    continue_on: failure
```

Field yang didukung: `name`, `description`, `type`, `params`, `env`, `working_dir`,
`timeout_sec`, `llm`, `defaults` (`env`, `working_dir`, `retry_policy`, `timeout_sec`),
`schedule`, `on`, dan per step: `id`, `run`, `action`, `with`, `output` / `outputs`, `depends`,
`env` (map atau list map), `working_dir`, `retry_policy`, `timeout_sec`, `continue_on`. Field
lain ditolak.

## Schedule & event

Panduan penuh (menu Cron, contoh, troubleshooting): [workflow-cron.md](workflow-cron.md).

```yaml
name: nightly-test
schedule:
  cron: "0 2 * * *"          # 5 field: minute hour dom month dow
  enabled: true                # default true
  timezone: Asia/Jakarta       # opsional; default zona lokal mesin
on:
  - ticket.transitioned        # shorthand
  - event: ticket.transitioned # bentuk objek
    status: In Progress        # filter opsional pada payload.status
steps:
  - id: test
    run: npm test
```

- Cron dijalankan oleh ticker in-process (±30s) setelah bootstrap; `trigger` run = `cron`.
- Event memakai bus internal (`record` / `publish`); `trigger` = `event:<nama>`.
  Contoh: `ticket.transitioned` (payload `projectId`, `key`, `status`).
- Satu run aktif per slug tetap berlaku; jika bentrok, schedule dilewati (next cron tetap maju).
- Toggle enable tanpa edit YAML: menu **Cron** atau `PATCH .../workflows/:slug/schedule`.
- AI/chat **tidak** boleh auto-run workflow; hanya tombol Run, cron, atau event terdaftar.

Step `action: notification` mengirim pesan ke channel yang didaftarkan di Global Settings →
Notifications — lihat [notifications.md](notifications.md).

Subset Dagu tambahan:
- `params` → default masuk env / `${params.NAME}`; saat **Run**, UI menampilkan dialog isi param
  (dikirim sebagai body `POST .../run` `{ params }`). Tipe: `string` | `integer` | `number` |
  `boolean` | `agent`. Param `type: agent` membuka composer seperti chat (teks + lampiran file +
  pilih provider/model); nilai prompt masuk `${params.NAME}`, plus companion
  `${params.NAME__provider}` / `${params.NAME__model}` (dan lampiran gambar via payload internal).
  Step `agent` / `chat.completion` yang tidak set `with.provider`/`with.model` memakai companion
  itu otomatis jika param agent direferensikan di prompt (atau hanya ada satu param agent).
- `outputs: [{ name }]` + `DAGU_OUTPUT_FILE` (key=value) → `${steps.<id>.outputs.<name>}`
- `action: router.route` dengan `with.value` + `with.routes` (if/else; di graph berbentuk
  belah ketupat). Target maju mendapat `routeGate`; target yang kembali ke step sebelumnya
  dianggap **loop-back** (garis putus-putus). `with.max_loops` (default 10) membatasi berapa kali
  entry loop boleh dijalankan.
- `next: <step>` setelah sukses me-reset dan menjalankan ulang step tersebut (pola
  failed→fix→`next: rubocop`).

- Step **tanpa `depends`** berjalan paralel.
- Step dengan dependency menunggu semua dependency `success` (atau `failed` yang `continue_on`
  failure/exit_code).
- Cycle / dependency tidak dikenal / id duplikat → error validasi.
- `working_dir` wajib berada di dalam workspace.

## AI step (`action: chat.completion`)

Satu completion tanpa tools. Pakai provider LLM **global** (Global Settings → LLM Providers) atau
**role** (persona + provider).

```yaml
name: ai-review
llm:
  provider: My Provider      # id atau nama provider (opsional; default provider pertama)
  model: gpt-4.1-mini        # opsional
  role: Backend              # opsional; memakai persona + provider role
steps:
  - id: review
    action: chat.completion
    with:
      system: "Kamu reviewer senior."
      prompt: |
        Ringkas risiko perubahan ini:
        ${steps.diff.output}
      temperature: 0.3
      max_tokens: 800
    output: REVIEW
  - id: post
    depends: review
    run: echo "${REVIEW}"
```

## Agent step (`action: agent`)

Loop tool-calling penuh (seperti chat Build/Plan): skills, file tools, document tools
(local/Docmost/Notion/Confluence), dan ticket tools (local + Jira/ClickUp). Write file/doc/ticket di
workflow **langsung diterapkan** (tanpa Review tab).

```yaml
name: implement-ticket
llm:
  provider: My Provider
  role: Backend
steps:
  - id: implement
    action: agent
    with:
      mode: build            # default build; opsional plan (skills only)
      skill: code-review     # opsional; alias skill_name
      prompt: |
        Implementasikan ticket berikut:
        ${steps.ticket.output}
      max_steps: 8           # 1–200, opsional; default unlimited
      variant: medium        # short | medium | long (temperature preset)
    output: RESULT
  - id: done
    depends: implement
    run: echo "${RESULT}"
```

Prompt + model dari dialog Run (param `agent`):

```yaml
name: agent-from-params
params:
  - name: TASK
    type: agent
    description: Prompt, lampiran, dan model untuk agent
steps:
  - id: run
    action: agent
    with:
      mode: build
      prompt: "${params.TASK}"
      # provider/model opsional — diisi otomatis dari pilihan di dialog
    output: RESULT
```

- `with`: sama seperti completion (`prompt`/`messages`, `system`, `provider`, `role`, `session`,
  `model`, `temperature`, `max_tokens`) plus `mode`, `skill`/`skill_name`, `variant`, `max_steps`.
- Output step = teks assistant akhir; tool calls masuk log step (`[tool] …`).
- Cancel run menghentikan loop antar round (panggilan LLM yang sedang berjalan mungkin selesai dulu).

### Sesi AI

AI/agent step bisa memilih sesi percakapan lewat `session` (top-level `llm.session` atau
`with.session`):

```yaml
llm:
  provider: My Provider
  session: review-thread
steps:
  - id: first
    action: chat.completion
    with:
      prompt: "Buat checklist review."
  - id: second
    depends: first
    action: chat.completion
    with:
      prompt: "Lanjutkan dengan risiko keamanan."
      session: review-thread
```

- Sesi disimpan per project di `workflow_sessions` + `workflow_session_messages`.
- Step dengan nama sesi yang sama akan **melanjutkan riwayat** (user/assistant), termasuk antar-run.
- `with.session` menimpa `llm.session`; tanpa `session` step bersifat stateless.
- Riwayat yang dikirim dibatasi 50 pesan terakhir; persona/system tidak disimpan di sesi.

- `output` menyimpan jawaban ke variabel; dependents bisa memakai `${NAMA}` atau
  `${steps.<id>.output}`. Shell step juga menyimpan stdout sebagai `${steps.<id>.output}`.
- Persona role dipakai sebagai system prompt default; provider role dipakai otomatis.
- Timeout mengikuti `timeout_sec` (mencakup seluruh loop agent).
- Jika provider/role/skill tidak ditemukan, step gagal dengan log yang jelas.

## Eksekusi (`src/server/workflow/runner.ts`)

- `Deno.Command` via `/bin/sh -lc` (POSIX; bukan zsh login shell), cwd workspace/step, env proses +
  workflow + step.
- Layer topologis dijalankan paralel (maks 8 per batch); retry `limit`/`interval_sec`; timeout
  `SIGTERM` → `SIGKILL` (exit 124).
- Log stdout/stderr disimpan per step (cap ±200 KB, penanda dipotong) dan di-poll UI tiap detik
  saat run berjalan.
- Cancel menghentikan child aktif; step tersisa ditandai `canceled`.
- Satu run aktif per workflow (run kedua → HTTP 409).
- Run yang masih `running` saat app restart ditandai `interrupted` (bootstrap).

## Tabel

- `workflow_runs`: snapshot YAML, path, status (`running|success|failed|canceled|interrupted`),
  trigger (`manual` | `cron` | `event:…`), error, timestamp.
- `workflow_run_steps`: status per step, command, exit code, log, timestamp.
- `workflow_schedules`: cron/timezone/enabled/events JSON, `next_run_at`, last run (sync dari YAML
  saat create/save).

## API

| Method | Path | Keterangan |
| --- | --- | --- |
| `GET`/`POST` | `/api/projects/:id/workflows` | List (file + last run + schedule) / create |
| `GET`/`PUT`/`DELETE` | `/api/projects/:id/workflows/:slug` | Detail / simpan YAML / hapus |
| `PATCH` | `/api/projects/:id/workflows/:slug/schedule` | `{ enabled }` toggle tanpa edit YAML |
| `POST` | `/api/projects/:id/workflows/:slug/run` | Mulai run → `{ runId }` (202) |
| `GET` | `/api/projects/:id/workflow-runs?workflow=&limit=` | Riwayat run |
| `GET` | `/api/projects/:id/workflow-runs/:runId` | Detail run + steps/log |
| `POST` | `/api/projects/:id/workflow-runs/:runId/cancel` | Batalkan run aktif |

## UI

- Menu **Workflows** (activity bar) → `WorkflowPanel` di sidebar: daftar file, status run terakhir,
  recent runs, tombol **Workflow baru**, dan **Dokumentasi** (ikon buku / link) yang membuka tab
  **Workflow Docs** berisi panduan YAML lengkap di dalam aplikasi.
- Menu **Cron** → `CronPanel` + tab `Cron`: daftar jadwal, toggle enable, next/last run;
  **Dokumentasi** membuka wiki cron in-app (`wiki-cron.md`). Lihat [workflow-cron.md](workflow-cron.md).
- Tab `WorkflowTab`:
  - Editor YAML Monaco (dirty, Save)
  - Graph React Flow (node per step, edge dependency, warna status)
  - Run / Cancel, riwayat run (badge trigger cron/event), daftar step, log per step
  - Bar schedule: cron / on / next run + Switch enable
- Chat/aktivitas menyaring event `workflow.step.*` agar tidak membanjiri Activity feed.

## Kode

- `src/server/workflow/parse.ts`, `store.ts`, `runner.ts`, `cron.ts`, `scheduler.ts`,
  `schedule-sync.ts`, `types.ts`
- `src/server/routes/workflows.ts`
- `web/src/components/WorkflowPanel.tsx`, `WorkflowTab.tsx`
- `web/src/lib/workflow-status.ts`

## Belum termasuk

Queue/workers, sub-DAG, human approval, webhook HTTP masuk, container/SSH/SQL, retry backoff
eksponensial, dan eksekusi otomatis oleh AI (chat tidak memanggil `run`).
