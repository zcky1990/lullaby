# Workflow (DAG)

Workflow engine lokal bergaya [Dagu](https://docs.dagu.sh): definisi YAML, dependency graph, eksekusi
shell paralel, retry/timeout, log per step, dan riwayat run. **Manual run** dari UI (tidak ada
scheduler/cron di v1).

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

Field yang didukung: `name`, `description`, `env`, `working_dir`, `llm`, `defaults` (`env`,
`working_dir`, `retry_policy`, `timeout_sec`), dan per step: `id`, `run`, `action`, `with`,
`output`, `depends`, `env`, `working_dir`, `retry_policy`, `timeout_sec`, `continue_on`.
Field lain ditolak.

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

Loop tool-calling penuh (seperti chat Build/Plan): skills, `read_file` / `write_file` /
`list_files` / `create_ticket`. Write di workflow **langsung diterapkan** (tanpa Review tab).

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
      max_steps: 8           # 1–12, default 6
      variant: medium        # short | medium | long (temperature preset)
    output: RESULT
  - id: done
    depends: implement
    run: echo "${RESULT}"
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

- `Deno.Command` via shell (`$SHELL -lc`), cwd workspace/step, env proses + workflow + step.
- Layer topologis dijalankan paralel (maks 8 per batch); retry `limit`/`interval_sec`; timeout
  `SIGTERM` → `SIGKILL` (exit 124).
- Log stdout/stderr disimpan per step (cap ±200 KB, penanda dipotong) dan di-poll UI tiap detik
  saat run berjalan.
- Cancel menghentikan child aktif; step tersisa ditandai `canceled`.
- Satu run aktif per workflow (run kedua → HTTP 409).
- Run yang masih `running` saat app restart ditandai `interrupted` (bootstrap).

## Tabel

- `workflow_runs`: snapshot YAML, path, status (`running|success|failed|canceled|interrupted`),
  trigger, error, timestamp.
- `workflow_run_steps`: status per step, command, exit code, log, timestamp.

## API

| Method | Path | Keterangan |
| --- | --- | --- |
| `GET`/`POST` | `/api/projects/:id/workflows` | List (file + last run) / create |
| `GET`/`PUT`/`DELETE` | `/api/projects/:id/workflows/:slug` | Detail / simpan YAML / hapus |
| `POST` | `/api/projects/:id/workflows/:slug/run` | Mulai run → `{ runId }` (202) |
| `GET` | `/api/projects/:id/workflow-runs?workflow=&limit=` | Riwayat run |
| `GET` | `/api/projects/:id/workflow-runs/:runId` | Detail run + steps/log |
| `POST` | `/api/projects/:id/workflow-runs/:runId/cancel` | Batalkan run aktif |

## UI

- Menu **Workflows** (activity bar) → `WorkflowPanel` di sidebar: daftar file, status run terakhir,
  recent runs, tombol **Workflow baru**, dan **Dokumentasi** (ikon buku / link) yang membuka tab
  **Workflow Docs** berisi panduan YAML lengkap di dalam aplikasi.
- Tab `WorkflowTab`:
  - Editor YAML Monaco (dirty, Save)
  - Graph React Flow (node per step, edge dependency, warna status)
  - Run / Cancel, riwayat run, daftar step, log per step
- Chat/aktivitas menyaring event `workflow.step.*` agar tidak membanjiri Activity feed.

## Kode

- `src/server/workflow/parse.ts`, `store.ts`, `runner.ts`, `types.ts`
- `src/server/routes/workflows.ts`
- `web/src/components/WorkflowPanel.tsx`, `WorkflowTab.tsx`
- `web/src/lib/workflow-status.ts`

## Belum termasuk

Cron/scheduler, queue/workers, sub-DAG, human approval, webhook, container/SSH/SQL, retry
backoff eksponensial, tool-calling/agent loop di AI step, dan eksekusi otomatis oleh AI.
