# Detail Plan: Runtime & Code-Editing Loop

> **STATUS: belum diimplementasikan.** Ini rencana untuk fase berikutnya. Implementasi saat ini
> adalah **desktop app**, bukan web app: main process berjalan di mesin user dan sudah punya akses
> folder workspace (menu **Explorer**). Rencana sandbox/worker pada dokumen ini berlaku untuk mode
> server (lihat `STACK_RECOMMENDATION.md` §0/§8); untuk desktop, loop akan berjalan lokal
> (`git worktree` + proses terbatas). Belum ada: LLM loop, tool executor, Verifier, sandbox, PR.

Dokumen ini menurunkan **Section 9 (Autonomous Coding Loop)** di `PLAN.md` menjadi rencana teknis
yang bisa langsung diimplementasikan. Fokus: **bagaimana LLM loop & tool calling mengedit kode**
saat aplikasi berbentuk **web app**.

> Prinsip inti: **web app TIDAK mengedit file di laptop user.** Web app mengedit **checkout repo di
> sandbox server**, lalu push **branch + PR** ke GitHub. LLM tidak menyentuh filesystem langsung —
> ia memanggil **tool**, dan server mengeksekusi tool itu **di dalam sandbox**.

---

## 1. Ringkasan alur (satu tiket)

```
Docmost PRD ──> Planner ──> Draft tiket ──[Gate1]──> Jira
                                                       │
                                    status = In Progress (webhook Jira)
                                                       ▼
                                          Workflow instance dibuat
                                                       │
                       ┌───────────────────────────────┴───────────────────────────────┐
                       │                      Worker (proses server)                    │
                       │  1. Provision sandbox + checkout branch PROJ-123               │
                       │  2. Coder loop: LLM <-> tool executor (di dalam sandbox)       │
                       │  3. Verifier: lint/typecheck/build + test suite                │
                       │  4. PASS?  tidak -> bug_report -> ulangi langkah 2 (<= N kali) │
                       │  5. PASS -> commit, push, open PR                              │
                       │  6. Destroy sandbox                                            │
                       └───────────────────────────────────────────────────────────────┘
                                                       │
                                          PR + [Gate3 review] -> merge -> DONE
```

---

## 2. Arsitektur runtime

```
┌──────────────┐   SSE/WS (status live)   ┌─────────────────────┐
│   Web UI     │ <─────────────────────── │  Web App API        │
│ (Kanban,     │                          │  (REST + WS + Auth) │
│  Review,     │ ───────────────────────► │                     │
│  Live Agent) │                          └─────────┬───────────┘
└──────────────┘                                    │ enqueue job
                                                    ▼
                                       ┌─────────────────────────┐
                                       │ Workflow Engine         │
                                       │ (Temporal / Inngest)    │
                                       └───────────┬─────────────┘
                                                   │ tasks
                                                   ▼
                                       ┌─────────────────────────┐
                                       │ Worker Pool (server)    │
                                       │  ├ Agent Orchestrator   │
                                       │  ├ LLM Gateway          │
                                       │  ├ Tool Executor        │
                                       │  └ Verifier             │
                                       └───────────┬─────────────┘
                                                   │ exec (docker exec / Sdk)
                                                   ▼
                                       ┌─────────────────────────┐
                                       │ Sandbox (per tiket)     │
                                       │  container + repo clone │
                                       │  + deps + test runner   │
                                       │  + branch PROJ-123      │
                                       └───────────┬─────────────┘
                                                   │ push
                                                   ▼
                                              GitHub (branch → PR)
```

Komponen utama:

| Komponen            | Tanggung jawab                                                            |
| ------------------- | ------------------------------------------------------------------------- |
| **Web App API**     | Auth, CRUD, trigger workflow, stream event, serve UI                      |
| **Workflow Engine** | Durable state machine per tiket (retry, resume, timer, signal)            |
| **Worker**          | Jalankan langkah agent, panggil LLM, eksekusi tool                        |
| **LLM Gateway**     | Abstraksi provider (OpenAI/Claude/Gemini/self-host), retry, cost tracking |
| **Sandbox Manager** | Bikin/hancurkan container, inject repo + secret test, limit resource      |
| **Tool Executor**   | Terjemahkan `tool_call` -> aksi di sandbox                                |
| **Verifier**        | Jalankan test & static check, hasilkan bug report terstruktur             |
| **Git/PR Adapter**  | Commit, push, buka PR, link ke Jira                                       |

---

## 3. Mode hosting sandbox

| Mode                      | Sandbox jalan di                                                        | Kapan dipakai                                |
| ------------------------- | ----------------------------------------------------------------------- | -------------------------------------------- |
| **Server-side (default)** | Cluster server (Docker/K8s) atau managed (E2B/Daytona/Fly/Modal)        | Paling sederhana untuk web app               |
| **Local runner**          | Mesin developer, lewat CLI/agent kecil yang tarik job dari orchestrator | Kalau repo/secret tidak boleh keluar network |

Desain worker harus **abstrak** soal lokasi sandbox: satu interface `SandboxProvider` dengan
implementasi `RemoteSandbox` dan `LocalRunnerSandbox`.

---

## 4. Cara mengedit kode: 3 pendekatan

| Pendekatan                  | Cara kerja                                                                                 | Kelebihan                                | Kekurangan                                          |
| --------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------- | --------------------------------------------------- |
| **A. Tool-calling agent**   | LLM pilih tool (`read_file`, `apply_patch`, `run_tests`), server eksekusi di sandbox, loop | Transparan, kontrol penuh, mudah diaudit | Kita yang maintain loop + prompt                    |
| **B. Bungkus coding agent** | Jalankan Claude Code headless / Codex CLI / Aider / OpenHands **di dalam sandbox**         | Cepat dibangun, kualitas edit tinggi     | Kurang granular, output lebih sulit distandardisasi |
| **C. Patch-based**          | LLM keluarkan diff sebagai teks, server apply                                              | Simpel                                   | Brittle untuk perubahan besar                       |

**Rekomendasi: hybrid B + A.**

- **Eksekusi edit file** diserahkan ke coding agent headless (B) → tidak perlu membangun loop edit
  dari nol.
- **Orkestrasi** tetap milik kita (A): tool level tinggi `start_agent`, `collect_diff`, `run_tests`,
  `open_pr`, plus **Verifier** terpisah.
- Sediakan **A penuh** sebagai opsi (mode "native"), dan **C** sebagai fallback untuk patch
  kecil/terarah.

Coding agent dijalankan **di dalam** sandbox, jadi ia memakai repo + deps yang sama dengan Verifier.

---

## 5. Desain sandbox

### 5.1 Spesifikasi

- **Isolasi**: container per tiket (Docker), opsi kuat: gVisor / Firecracker / microVM.
- **Repo**: clone shallow + checkout branch `PROJ-123` dari base branch (mis. `main`).
- **Deps**: image build/preinstalled (docker-compose untuk service pendukung + DB seed).
- **Filesystem**: writable workspace untuk repo; cache deps read-only.
- **Network**: egress **allowlist** — registry paket + API LLM saja; blokir internet bebas.
- **Resource limit**: CPU/RAM/disk/PID; timeout global.
- **Secrets**: **tanpa kredensial prod**; hanya secret test yang di-inject; token GitHub push
  berskop minimal.
- **TTL**: auto-destroy setelah selesai atau idle (mis. 30 menit).

### 5.2 Lifecycle

```
create -> provisioning -> ready -> running -> draining -> destroyed
   │                                              │
   └── gagal -> retry sekali -> FAILED            └── simpan artefak (diff, log) ke storage
```

### 5.3 Interface provider

```ts
interface SandboxProvider {
  create(spec: SandboxSpec): Promise<SandboxHandle>;
  exec(handle, cmd: string, opts?): Promise<ExecResult>; // { stdout, stderr, exitCode }
  readFile(handle, path): Promise<string>;
  writeFile(handle, path, content): Promise<void>;
  destroy(handle): Promise<void>;
  snapshot(handle): Promise<SnapshotId>; // opsional untuk resume cepat
}
```

---

## 6. Tool definitions (function calling)

Tool dikirim ke LLM tiap request. LLM **hanya** mengembalikan `name` + `arguments`; **eksekusi
dilakukan server di dalam sandbox**.

### 6.1 Tool edit & eksplorasi (mode A / fallback)

```json
[
  {
    "name": "list_files",
    "description": "List file/direktori di dalam sandbox.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": { "type": "string", "description": "Path relatif dari repo root." },
        "glob": { "type": "string", "description": "Opsional, pola glob, mis. src/**/*.ts" }
      },
      "required": ["path"]
    }
  },
  {
    "name": "read_file",
    "description": "Baca isi file. Gunakan offset/limit untuk file besar.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": { "type": "string" },
        "offset": { "type": "integer", "minimum": 0 },
        "limit": { "type": "integer", "minimum": 1 }
      },
      "required": ["path"]
    }
  },
  {
    "name": "search_code",
    "description": "Cari teks/regex di dalam repo.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": { "type": "string" },
        "glob": { "type": "string" }
      },
      "required": ["query"]
    }
  },
  {
    "name": "apply_patch",
    "description": "Terapkan patch unified diff ke repo.",
    "parameters": {
      "type": "object",
      "properties": {
        "patch": { "type": "string", "description": "Unified diff." }
      },
      "required": ["patch"]
    }
  },
  {
    "name": "run_shell",
    "description": "Jalankan perintah shell non-destruktif di sandbox.",
    "parameters": {
      "type": "object",
      "properties": {
        "cmd": { "type": "string" },
        "timeout_sec": { "type": "integer", "default": 120 }
      },
      "required": ["cmd"]
    }
  },
  {
    "name": "run_tests",
    "description": "Jalankan test suite (atau target tertentu).",
    "parameters": {
      "type": "object",
      "properties": { "target": { "type": "string" } },
      "required": []
    }
  },
  {
    "name": "git_diff",
    "description": "Ambil diff saat ini terhadap base branch.",
    "parameters": { "type": "object", "properties": {} }
  },
  {
    "name": "finish",
    "description": "Tandai pekerjaan coding selesai dan lanjut ke Verifier.",
    "parameters": {
      "type": "object",
      "properties": { "summary": { "type": "string" } },
      "required": ["summary"]
    }
  }
]
```

### 6.2 Tool orkestrasi level tinggi (mode B)

```json
[
  {
    "name": "start_agent",
    "parameters": { "agent": "claude-code|codex|aider|openhands", "prompt": "string" }
  },
  { "name": "agent_status", "parameters": { "agent_run_id": "string" } },
  { "name": "collect_diff", "parameters": { "agent_run_id": "string" } },
  { "name": "request_approval", "parameters": { "reason": "string" } }
]
```

### 6.3 Pemetaan tool -> eksekusi

| Tool                       | Eksekusi internal                                         |
| -------------------------- | --------------------------------------------------------- |
| `read_file` / `list_files` | `sandbox.readFile` / `exec("ls"/"find")`                  |
| `search_code`              | `exec("rg --json ...")`                                   |
| `apply_patch`              | tulis patch ke temp + `exec("git apply")` (validasi dulu) |
| `run_shell`                | `sandbox.exec` dengan allowlist perintah & timeout        |
| `run_tests`                | `exec(test_cmd)` dengan reporter JSON                     |
| `git_diff`                 | `exec("git diff")`                                        |
| `finish`                   | tandai loop selesai, ucapkan terima kasih ke LLM          |
| `start_agent`              | spawn coding agent headless di dalam sandbox              |

**Guardrail tool**:

- `apply_patch` **ditolak** jika menyentuh file test existing (lihat §9.3).
- `run_shell` dibatasi allowlist + larangan `sudo`, `rm -rf /`, akses jaringan bebas.
- Diff size limit: tolak patch yang melebihi `max_diff_lines` (scope check).

---

## 7. Agent loop (Coder)

```python
def run_coder(ticket, sandbox, cfg):
    messages = [
        SYSTEM_PROMPT,                                    # peran, aturan, DoD, larangan edit test
        CONTEXT_MESSAGE,                                  # tiket + AC + konvensi + file relevan
    ]

    for step in range(cfg.max_iters):                     # default 5
        resp = llm.chat(messages, tools=TOOLS, tool_choice="auto", temperature=cfg.temperature)
        messages.append(resp)

        # stop condition: LLM selesai
        if not resp.tool_calls:
            break

        for call in resp.tool_calls:
            if not tool_allowed(call.name, cfg.tool_policy):
                messages.append(tool_error(call.id, "tool not allowed"))
                continue
            result = tool_executor.run(sandbox, call)      # jalan DI dalam sandbox
            messages.append(tool_result(call.id, result))

        if budget_exceeded(step, tokens_used, usd_used, cfg):
            return Outcome.ESCALATE("budget")

    return Outcome.CODED(sandbox.git_diff())
```

### 7.1 Stop conditions (wajib)

| Kondisi                                    | Aksi                            |
| ------------------------------------------ | ------------------------------- |
| `max_iters` tercapai (default 5)           | `ESCALATE` — butuh manusia      |
| Budget token/$ per tiket habis             | `ESCALATE` — hard stop          |
| Time budget habis                          | `ESCALATE`                      |
| LLM memanggil `finish` / tak ada tool call | lanjut `verify()`               |
| **No progress**: error sama muncul 2x      | `ESCALATE` (jangan buang biaya) |

### 7.2 Konteks yang dikirim ke LLM

Yang **masuk**:

- Tiket (title, description, AC) + PRD terkait (ringkas).
- Konvensi repo (`AGENTS.md`, `CONTRIBUTING.md`, gaya kode).
- **File relevan** hasil retrieval (`search_code` / embedding index) — **bukan** seluruh repo.
- Riwayat bug report iterasi sebelumnya (kalau ada).

Yang **tidak masuk**:

- Seluruh repo, secret, log raksasa. Ini menjaga biaya & akurasi.

---

## 8. Verifier

Verifier adalah **agent terpisah dengan konteks terpisah** (idealnya model terpisah). Ia **tidak
memperbaiki** kode — ia hanya **menilai**.

```python
def verify(sandbox, ticket):
    static = sandbox.exec(cfg.build_cmd)          # lint + typecheck + build
    tests  = sandbox.run_tests()                  # reporter JSON

    if not integrity_ok(sandbox):                 # anti reward-hacking, §9.3
        return Bug(code="TEST_INTEGRITY_VIOLATION", detail=integrity_report(sandbox))

    if static.ok and tests.ok:
        return Pass(tests.summary)

    return BugReport = llm_extract_bug(
        logs=static.log + tests.log,
        changed_files=sandbox.git_diff_names(),
        schema=BUG_REPORT_SCHEMA,
    )
```

### 8.1 Bug report schema

```json
{
  "type": "object",
  "required": ["severity", "summary", "items"],
  "properties": {
    "severity": { "enum": ["blocker", "major", "minor"] },
    "summary": { "type": "string" },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["kind", "file", "test_name", "message", "repro"],
        "properties": {
          "kind": {
            "enum": ["test_failure", "compile_error", "lint", "type_error", "runtime_error"]
          },
          "file": { "type": "string" },
          "line": { "type": "integer" },
          "test_name": { "type": "string" },
          "message": { "type": "string" },
          "expected": { "type": "string" },
          "actual": { "type": "string" },
          "repro": { "type": "string" }
        }
      }
    }
  }
}
```

Bug report ini yang **di-append** ke konteks Coder pada iterasi berikutnya.

---

## 9. Test strategy & anti reward-hacking

### 9.1 Lapisan test (Definition of Done = semua hijau)

1. **Existing test suite** — regression gate, **wajib**.
2. **Test baru** buatan AI untuk fitur.
3. **Static**: lint, typecheck, build.
4. **Opsional**: AI semantik review (bukan pengganti test).

### 9.2 Mapping acceptance criteria

Setiap AC diverifikasi eksplisit; hasil disimpan agar bisa diaudit (`ac_results`).

### 9.3 Anti reward-hacking

| Ancaman                    | Deteksi                                 | Aksi                                            |
| -------------------------- | --------------------------------------- | ----------------------------------------------- |
| AI hapus/ubah test lama    | `git diff` menyentuh file test existing | Tolak patch / tandai `TEST_INTEGRITY_VIOLATION` |
| Assertion dilemahkan       | jumlah assertion turun                  | Review manual                                   |
| `.skip` / `xfail` ditambah | scan diff                               | Tolak                                           |
| Diff raksasa               | `lines_changed > max_diff_lines`        | Tolak / escalate                                |
| Perubahan di luar scope    | file di luar direktori terkait tiket    | Tandai untuk review                             |

---

## 10. Streaming & live view

Worker mem-publish event; UI berlangganan via **SSE** (atau WebSocket).

```json
{ "type": "agent.step",     "ticket": "PROJ-123", "step": 3, "role": "coder", "tool": "apply_patch", "status": "ok" }
{ "type": "agent.thinking", "ticket": "PROJ-123", "text": "Menambahkan validasi input..." }
{ "type": "test.result",    "ticket": "PROJ-123", "passed": false, "failed": 2, "summary": "..." }
{ "type": "bug.reported",   "ticket": "PROJ-123", "payload": { "...bug report..." } }
{ "type": "pr.opened",      "ticket": "PROJ-123", "url": "https://github.com/..." }
{ "type": "run.finished",   "ticket": "PROJ-123", "outcome": "READY_FOR_REVIEW" }
```

Semua event juga disimpan (`agent_events`) untuk replay & audit.

---

## 11. Durability & resumability

- **Workflow engine** menyimpan state tiap langkah; tahan crash & bisa resume.
- Tabel `workflow_runs` menyimpan: state, iterasi, cursor, `sandbox_id`, `budget_used`.
- Langkah idempotent: commit per iterasi; re-run tidak menggandakan efek.
- Timeout & retry di level worker; LLM call di-retry dengan backoff (rate limit).
- Sandbox hilang -> recreate dari branch + snapshot terakhir.

---

## 12. Konkurensi & resource

- **Lock per tiket** (distributed lock) → cegah dua worker menangani tiket yang sama.
- **N worker paralel** untuk tiket berbeda; sandbox terisolasi per tiket.
- Batas konkurensi per repo (hindari tabrakan pada file sama) + rebase otomatis.
- Quota CPU/RAM total; antri kalau penuh.

---

## 13. Keamanan

- Sandbox **tanpa kredensial prod**; egress allowlist.
- Token GitHub **scoped** (repo tertentu, izin minimal); jangan simpan di UI.
- Larangan commit ke `main`; selalu branch + PR.
- Audit semua tool call & write eksternal.
- Secret terenkripsi at rest (KMS/secret manager).
- Rate limit + backoff untuk GitHub/Jira/Docmost (hormati `Retry-After` / `429`).

---

## 14. Biaya & observability

- Catat tiap: prompt, model, tokens, biaya, tool call, durasi, hasil test.
- **Cost cap per tiket** → hard stop saat tercapai.
- Dashboard: biaya/tiket, rata-rata iterasi, tingkat keberhasilan Verifier, jumlah escalation.
- Alert kalau ada loop macet / budget terlampaui.

---

## 15. Skema data (PostgreSQL)

| Tabel           | Isi                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------- |
| `workflow_runs` | instance per tiket: `ticket_key`, `state`, `iteration`, `cursor`, `budget_used`, `sandbox_id` |
| `agent_steps`   | tiap langkah: `run_id`, `role`, `tool`, `input`, `output`, `tokens`, `cost`                   |
| `agent_events`  | stream event untuk replay UI                                                                  |
| `sandboxes`     | `run_id`, `provider`, `container_id`, `branch`, `status`, `ttl`, `created_at`                 |
| `test_runs`     | `run_id`, `iteration`, `suite`, `passed`, `failed`, `log_ref`                                 |
| `bug_reports`   | `run_id`, `iteration`, `payload(JSON)`, `resolved_at`                                         |
| `ac_results`    | `ticket_key`, `ac_id`, `status`, `evidence`                                                   |
| `llm_calls`     | `run_id`, `provider`, `model`, `tokens_in/out`, `cost`, `latency`                             |

Contoh DDL ringkas:

```sql
CREATE TABLE workflow_runs (
  id            UUID PRIMARY KEY,
  ticket_key    TEXT NOT NULL,
  state         TEXT NOT NULL,
  iteration     INT  NOT NULL DEFAULT 0,
  cursor        TEXT,
  budget_used   NUMERIC NOT NULL DEFAULT 0,
  sandbox_id    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_steps (
  id          BIGSERIAL PRIMARY KEY,
  run_id      UUID NOT NULL REFERENCES workflow_runs(id),
  iteration   INT  NOT NULL,
  role        TEXT NOT NULL,          -- planner|coder|verifier
  tool        TEXT,
  input       JSONB,
  output      JSONB,
  tokens      INT,
  cost        NUMERIC,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 16. Sequence diagram (satu iterasi)

```
UI            API          Workflow      Worker        Sandbox        LLM        GitHub
│              │              │             │             │            │           │
│ start coding │              │             │             │            │           │
├─────────────►│ create run   │             │             │            │           │
│              ├─────────────►│             │             │            │           │
│              │              ├─ task ─────►│ provision   │            │           │
│              │              │             ├────────────►│            │           │
│              │              │             │ checkout    │            │           │
│              │              │             │◄────────────┤            │           │
│              │              │             ├── chat ────────────────► │           │
│              │              │             │◄─ tool_call ──────────── │           │
│              │              │             ├─ exec tool ►│            │           │
│              │              │             │◄─ result ───┤            │           │
│              │              │             ├── (loop) ──────────────► │           │
│  ◄─ SSE ─────┤◄─ event ─────┤◄─ step ─────┤             │            │           │
│              │              │             ├─ run tests ►│            │           │
│              │              │             │◄─ pass? ────┤            │           │
│              │              │             ├─ (gagal) bug_report → loop│           │
│              │              │             ├─ push + open PR ───────────────────► │
│  ◄─ pr.opened┤◄─ event ─────┤◄─ finished ─┤             │            │           │
```

---

## 17. Konfigurasi (contoh)

```yaml
coding_loop:
  mode: hybrid # native | hybrid | patch
  agent: claude-code # backend coding agent (mode hybrid)
  max_iters: 5
  time_budget_sec: 3600
  cost_budget_usd: 8.00
  temperature: 0.1
  max_diff_lines: 800
  protect_test_globs:
    - "**/*.test.*"
    - "**/tests/**"
    - "**/__tests__/**"
  tool_policy:
    allow: [read_file, list_files, search_code, apply_patch, run_tests, git_diff, finish]
    require_approval: [run_shell]
  build_cmd: "pnpm lint && pnpm typecheck && pnpm build"
  test_cmd: "pnpm test -- --reporter=json"
  sandbox:
    provider: docker # docker | e2b | daytona | fly | local-runner
    cpu: 2
    mem_gb: 4
    egress_allow: ["registry.npmjs.org", "api.anthropic.com", "api.openai.com"]
    ttl_min: 30
```

---

## 18. Milestone komponen ini

- **C0** — Sandbox manager (Docker) + provider interface + lifecycle.
- **C1** — LLM Gateway (abstraksi provider) + cost tracking.
- **C2** — Tool executor + tool set edit + guardrails (protect test, diff limit).
- **C3** — Coder loop native (mode A) + stop conditions + persist state.
- **C4** — Verifier + bug report schema + anti reward-hacking.
- **C5** — Integrasi coding agent headless (mode B) di dalam sandbox.
- **C6** — Git/PR adapter + streaming SSE + UI live view.
- **C7** — Durable workflow (Temporal) + resumability + konkurensi/lock.
- **C8** — Budget/cost cap + dashboard + alert.

---

## 19. Pertanyaan terbuka

1. Bahasa/runtime repo target (menentukan `build_cmd`/`test_cmd` & image sandbox).
2. Boleh mengirim kode ke LLM cloud, atau harus **self-host model** (mis. vLLM)?
3. Sandbox di **server** atau perlu **local runner** karena kebijakan jaringan?
4. Coding agent headless mana yang dipakai (Claude Code / Codex / Aider / OpenHands)?
5. Batas diff & jumlah iterasi yang nyaman untuk tim.
6. Apakah PR AI boleh **auto-merge** untuk kasus tertentu, atau selalu human gate?
