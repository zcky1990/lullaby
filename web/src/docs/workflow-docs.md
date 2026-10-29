# Dokumentasi Workflow

Workflow engine lokal dengan definisi **YAML**, dependency graph (DAG), eksekusi shell paralel,
step AI, retry/timeout, log per step, dan riwayat run. Semua run dijalankan **manual** dari UI.

## Lokasi file

- Workspace project: `.workflows/<slug>.yaml`
- Fallback tanpa workspace: `{appDataDir}/<project-slug>/workflows/<slug>.yaml`

`slug` = nama file tanpa `.yaml`, hanya `a-zA-Z0-9_.-`, tidak diawali titik. File bisa dibuat lewat
tombol **Workflow baru** atau ditulis langsung di folder tersebut.

## Struktur YAML

| Field | Tipe | Keterangan |
| --- | --- | --- |
| `name` | string | Nama workflow (opsional; default slug). |
| `description` | string | Deskripsi singkat. |
| `env` | map | Environment variable untuk semua step (nilai diubah ke string). |
| `working_dir` | string | Direktori kerja default, relatif terhadap workspace. |
| `llm` | object | Konfigurasi default step AI (`provider`, `model`, `role`, `session`, `system`, `temperature`). |
| `defaults` | object | Default semua step: `env`, `working_dir`, `retry_policy`, `timeout_sec`. |
| `steps` | array | Daftar step (wajib, minimal 1). |

Field lain ditolak saat validasi.

## Step shell

```yaml
steps:
  - id: build
    run: npm run build
    depends: install
    env:
      NODE_ENV: production
    working_dir: app
    retry_policy:
      limit: 2
      interval_sec: 5
    timeout_sec: 600
    continue_on: failure
    output: BUILD_LOG
```

| Field | Keterangan |
| --- | --- |
| `id` | Nama unik step (opsional; otomatis `cmd_1`, `cmd_2`, …). |
| `run` | Perintah shell (wajib untuk step shell). Multi-baris didukung. |
| `depends` | String atau array id step; kosong = jalan paralel. |
| `env` | Env khusus step. |
| `working_dir` | Direktori kerja step (harus di dalam workspace). |
| `retry_policy` | `{ limit, interval_sec }`; `limit` = jumlah percobaan ulang. |
| `timeout_sec` | Batas waktu; proses di-`SIGTERM` lalu `SIGKILL` (exit 124). |
| `continue_on` | `failure` / `exit_code`: kegagalan step tidak menggagalkan run & dependency tetap boleh lanjut. |
| `output` | Nama variabel untuk stdout (opsional). |

## Dependency & eksekusi

- Step tanpa `depends` berjalan **paralel**.
- Step berjalan setelah semua dependency `success` (atau gagal dengan `continue_on`).
- Dependency gagal → step ditandai `skipped`.
- Cycle, dependency tidak dikenal, dan id duplikat ditolak saat load.
- Maksimal 8 step per batch paralel.
- Satu run aktif per workflow; run kedua → HTTP **409**.
- Cancel menghentikan child aktif; step tersisa `canceled`.

## Variabel & output

- `${NAMA}` → nilai `output: NAMA`.
- `${steps.<id>.output}` → stdout step tersebut (tersedia untuk step yang sudah sukses).
- `${env.KEY}` → environment variable workflow/step.
- Interpolasi berlaku di `run`, `prompt`, `system`, `messages`, dan nilai `env` step.

```yaml
steps:
  - id: diff
    run: git diff
  - id: report
    depends: diff
    run: echo "Perubahan: ${steps.diff.output}"
```

## Step AI

```yaml
llm:
  provider: My Provider      # id/nama provider global
  model: gpt-4.1-mini        # opsional
  role: Backend              # opsional (persona + provider)
  session: review-thread     # opsional

steps:
  - id: review
    action: chat.completion
    with:
      system: "Kamu reviewer senior."
      prompt: |
        Ringkas risiko perubahan:
        ${steps.diff.output}
      temperature: 0.3
      max_tokens: 800
    output: REVIEW
  - id: post
    depends: review
    run: echo "${REVIEW}"
```

| Field `with` | Keterangan |
| --- | --- |
| `prompt` | Satu pesan user. Wajib jika `messages` tidak ada. |
| `messages` | Array `{ role: system\|user\|assistant, content }`. |
| `system` | System prompt; default persona role. |
| `provider` | Override provider (id/nama). |
| `role` | Override role (id/nama). |
| `session` | Nama sesi AI (lihat di bawah). |
| `model` | Override model. |
| `temperature` | 0–2. |
| `max_tokens` | Batas token jawaban. |
| `mode` | `plan` \| `build` (hanya `action: agent`; default `build`). |
| `skill` / `skill_name` | Skill aktif (hanya agent). |
| `variant` | `short` \| `medium` \| `long` (preset temperature agent). |
| `max_steps` | 1–12, default 6 (batas round agent). |

```yaml
steps:
  - id: implement
    action: agent
    with:
      mode: build
      skill: code-review
      prompt: "Implementasikan ${steps.ticket.output}"
      max_steps: 8
    output: RESULT
```

Catatan:
- `action: chat.completion` = **satu completion** (tanpa tools).
- `action: agent` = loop tool-calling (skills + file tools + create_ticket); write **auto-apply**
  (tanpa Review tab).
- Provider/role berasal dari **Global Settings**.
- Jika provider/role/skill tidak ditemukan → step gagal dengan log jelas.
- `output` menyimpan jawaban; stdout step shell juga tersedia sebagai `${steps.<id>.output}`.

## Sesi AI

```yaml
llm:
  session: review-thread
steps:
  - id: first
    action: chat.completion
    with: { prompt: "Buat checklist." }
  - id: second
    depends: first
    action: chat.completion
    with:
      prompt: "Lanjutkan dengan risiko keamanan."
      session: review-thread
```

- Sesi disimpan per project di `workflow_sessions` + `workflow_session_messages`.
- Nama sesi yang sama melanjutkan riwayat user/assistant, termasuk **antar-run**.
- `with.session` menimpa `llm.session`; tanpa sesi step bersifat stateless.
- Riwayat dikirim maksimal 50 pesan terakhir; persona/system tidak disimpan di sesi.

## Log, history, cancel

- Log stdout/stderr per step disimpan (cap ±200 KB, penanda dipotong) dan diperbarui saat run berjalan.
- Riwayat run menyimpan **snapshot YAML** sehingga edit definisi tidak mengubah histori.
- Run yang masih `running` saat aplikasi restart ditandai `interrupted`.
- UI: tab **Workflows** → Editor YAML, Graph (React Flow), Run/Cancel, daftar run, step, dan log.

## Contoh paralel

```yaml
name: ci
steps:
  - id: install
    run: npm ci
  - id: lint
    depends: install
    run: npm run lint
  - id: test
    depends: install
    run: npm test
  - id: build
    depends: [lint, test]
    run: npm run build
```

`lint` dan `test` berjalan paralel; `build` menunggu keduanya.

## API

| Method | Path | Keterangan |
| --- | --- | --- |
| `GET/POST` | `/api/projects/:id/workflows` | List / create |
| `GET/PUT/DELETE` | `/api/projects/:id/workflows/:slug` | Detail / save / delete |
| `POST` | `/api/projects/:id/workflows/:slug/run` | Mulai run → `{ runId }` |
| `GET` | `/api/projects/:id/workflow-runs` | Riwayat run |
| `GET` | `/api/projects/:id/workflow-runs/:runId` | Detail + step + log |
| `POST` | `/api/projects/:id/workflow-runs/:runId/cancel` | Cancel run |

## Keamanan

- Perintah shell dijalankan dengan hak user di `workspace_path` — perlakukan file workflow sebagai kode.
- `working_dir` divalidasi agar tetap di dalam workspace (termasuk symlink).
- Run **hanya** lewat tombol Run/manual; AI tidak bisa menjalankan workflow otomatis.
- Jangan simpan secret langsung di YAML; gunakan environment/secret provider yang tersedia.

## Troubleshooting

- **“Workspace belum diatur”** → set workspace di Project Settings → Workspace.
- **Provider/role tidak ditemukan** → cek Global Settings → LLM Providers / Roles.
- **Step AI gagal** → lihat log step; periksa baseUrl/apiKey/model provider.
- **Run 409** → masih ada run aktif; tunggu atau buka run lalu Cancel.
- **Dependency cycle** → periksa `depends`.
