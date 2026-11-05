# Dokumentasi Workflow

Workflow engine lokal dengan definisi **YAML**, dependency graph (DAG), eksekusi shell paralel,
step AI, retry/timeout, log per step, dan riwayat run. Run bisa **manual** (tombol Run),
**cron** (`schedule`), atau **event** (`on`). Detail jadwal: menu **Cron** / wiki cron.

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
| `type` | string | Opsional (mis. `graph`); disimpan, tidak mengubah eksekusi. |
| `params` | array | Parameter Dagu-style (`name`, `type`, `default`, `description`); default ikut ke env. Saat Run, dialog meminta nilai param. |
| `env` | map / list map | Environment variable untuk semua step (nilai diubah ke string). |
| `working_dir` | string | Direktori kerja default, relatif terhadap workspace. |
| `timeout_sec` | number | Timeout default semua step (bisa dioverride per step / `defaults`). |
| `llm` | object | Konfigurasi default step AI (`provider`, `model`, `role`, `session`, `system`, `temperature`). |
| `defaults` | object | Default semua step: `env`, `working_dir`, `retry_policy`, `timeout_sec`. |
| `schedule` | object | Jadwal cron: `cron`, `enabled?`, `timezone?`. |
| `on` | array | Pemicu event (`string` atau `{ event, status? }`). |
| `steps` | array | Daftar step (wajib, minimal 1). |

Field lain ditolak saat validasi.

## Schedule & event

```yaml
schedule:
  cron: "0 2 * * *"
  enabled: true
  timezone: Asia/Jakarta
on:
  - ticket.transitioned
  - event: ticket.transitioned
    status: In Progress
```

- Cron: 5 field; ticker in-process (±30s) saat app berjalan; `trigger` run = `cron`.
- Event: cocokkan nama event bus (+ filter `status` opsional); `trigger` = `event:<nama>`.
- Toggle enable tanpa edit YAML: menu **Cron** atau `PATCH .../workflows/:slug/schedule`.
- AI tidak boleh auto-run; lihat wiki cron di menu Cron → Dokumentasi.

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
| `output` / `outputs` | Nama variabel stdout, atau list `{ name }` (isi lewat `DAGU_OUTPUT_FILE`). |

## Router (`action: router.route`)

```yaml
steps:
  - id: check
    run: printf 'status=success\n' >> "$DAGU_OUTPUT_FILE"
    outputs:
      - name: status
  - id: route
    depends: check
    action: router.route
    with:
      value: ${steps.check.outputs.status}
      routes:
        success: [ok]
        failed: [bad]
  - id: ok
    run: echo ok
  - id: bad
    run: exit 1
```

Target di `routes` otomatis bergantung pada router dan hanya dijalankan jika value cocok.
Di graph, router digambar **belah ketupat**; label edge = key route (`success` / `failed`).

### Loop (retry body)

Dua pola:

1. **`next`** setelah fix — kembali ke step awal:
```yaml
  - id: route
    depends: check
    action: router.route
    with:
      value: ${steps.check.outputs.STATUS}
      max_loops: 5
      routes:
        success: [done]
        failed: [fix]
  - id: fix
    action: agent
    with:
      prompt: Fix issues in rubocop.log
    next: rubocop
  - id: done
    run: echo ok
```

2. **Loop-back route** langsung ke step sebelumnya (`failed: [rubocop]`) — edge putus-putus di graph.

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
- `${params.NAME}` → default param / env.
- `${steps.<id>.output}` → stdout step tersebut (tersedia untuk step yang sudah sukses).
- `${steps.<id>.outputs.<name>}` → named output dari `DAGU_OUTPUT_FILE`.
- `${env.KEY}` → environment variable workflow/step.
- Interpolasi berlaku di `run`, `prompt`, `system`, `messages`, `message` (notification), dan nilai
  `env` step.

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
| `max_steps` | 1–200, opsional; default unlimited (langkah terakhir = text-only). |

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

## Notification (`action: notification`)

Kirim pesan ke channel yang didaftarkan di **Global Settings → Notifications** (Slack, Google Chat,
Discord, atau webhook generik). Notifikasi **tidak** otomatis di akhir run — hanya jika ada step
ini.

### 1. Daftarkan channel

1. Buka **Global Settings → Notifications**.
2. **Tambah channel**: isi nama (mis. `team-slack`), tipe, dan Incoming Webhook URL.
3. Opsional: **Test** untuk memastikan webhook aktif.

Nama channel dipakai di YAML sebagai `with.channel` (id channel juga diterima).

### 2. Step di workflow

```yaml
name: build-and-notify
params:
  - name: TASK
    type: string
    default: ship it
steps:
  - id: work
    run: echo done
    output: RESULT
  - id: ping
    depends: work
    action: notification
    with:
      channel: team-slack
      message: |
        Workflow selesai.
        Task: ${params.TASK}
        Result: ${RESULT}
```

| Field `with` | Wajib | Keterangan |
| --- | --- | --- |
| `channel` | ya | Nama atau id channel di Global Settings. |
| `message` | ya* | Isi pesan. Alias: `text` / `prompt`. Mendukung interpolasi `${...}`. |

Catatan:
- Step tidak boleh memakai `run`.
- Channel tidak ditemukan / nonaktif → step **gagal** (log `[notify error] …`).
- Payload Slack / Google Chat: `{ text }`; Discord: `{ content }`; webhook generik: JSON
  `{ event: "workflow.notification", text, projectId, … }`.

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
| `PATCH` | `/api/projects/:id/workflows/:slug/schedule` | `{ enabled }` toggle |
| `POST` | `/api/projects/:id/workflows/:slug/run` | Mulai run → `{ runId }` |
| `GET` | `/api/projects/:id/workflow-runs` | Riwayat run |
| `GET` | `/api/projects/:id/workflow-runs/:runId` | Detail + step + log |
| `POST` | `/api/projects/:id/workflow-runs/:runId/cancel` | Cancel run |

## Keamanan

- Perintah shell dijalankan dengan hak user di `workspace_path` — perlakukan file workflow sebagai kode.
- `working_dir` divalidasi agar tetap di dalam workspace (termasuk symlink).
- Run lewat tombol Run, cron, atau event terdaftar; AI tidak bisa menjalankan workflow otomatis.
- Jangan simpan secret langsung di YAML; gunakan environment/secret provider yang tersedia.

## Troubleshooting

- **“Workspace belum diatur”** → set workspace di Project Settings → Workspace.
- **Provider/role tidak ditemukan** → cek Global Settings → LLM Providers / Roles.
- **Step AI gagal** → lihat log step; periksa baseUrl/apiKey/model provider.
- **Channel notification tidak ditemukan** → cek Global Settings → Notifications (nama/id & aktif).
- **Notify gagal HTTP** → Test channel di settings; periksa Incoming Webhook URL.
- **Run 409** → masih ada run aktif; tunggu atau buka run lalu Cancel.
- **Dependency cycle** → periksa `depends`.
