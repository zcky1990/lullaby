# Rekomendasi Stack — Hybrid AI-Driven Agile Desktop Workspace

Turunan dari `overview.md` (PRD hybrid, backend di **main process desktop**), `PLAN.md`,
`CODE_EDITING_LOOP.md`, `STACK_TS.md`, dan `configuration.md`.

Dokumen ini merekomendasikan **stack konkret** beserta alternatif & trade-off, dengan dua profil
runtime:

- **Profile D — Desktop (default):** single-user, offline-capable, secret di OS keychain, DB lokal,
  LLM bisa lokal.
- **Profile S — Server (opsional, tim):** multi-user, secret di KMS, Postgres, sandbox remote,
  workflow durable.

Keduanya berbagi **kode domain yang sama**; yang berbeda hanya adaptor (storage, secret, queue).

---

## 0. Status implementasi (F0) — yang benar-benar dibangun

| Layer | Dipilih & dipakai sekarang | Catatan vs rekomendasi |
| --- | --- | --- |
| Shell desktop | **Deno Desktop** (`deno desktop`) | sesuai; Next.js/Tauri ditunda |
| Bahasa | **TypeScript strict**, Deno 2.9+ | sesuai |
| Renderer UI | **Vite + React 19 + Tailwind v4 + shadcn/ui** | Vite dipilih (bukan Next.js) |
| Editor kode | **Monaco** (`@monaco-editor/react`, bundle lokal + worker) | viewer read-only |
| Kanban | **ReUI** (`@reui/kanban`, vendored) + `@dnd-kit/*` + `@base-ui/react` | board tiket + drag = Jira transition |
| Dialog | **shadcn `dialog`** (`@radix-ui/react-dialog`) | detail tiket |
| Ikon | **lucide-react** | — |
| Main process | **Deno** (adapter pattern, `Deno.serve`) | sesuai |
| Transport renderer↔main | **HTTP loopback + SSE** | sesuai |
| Secret | **plaintext di `config`/`api_key`** | ⟵ berbeda dari rekomendasi (keychain); helper `src/secrets` tak dipakai |
| DB | **SQLite (`node:sqlite`)** | driver built-in (bukan libSQL/Drizzle) |
| Validasi | **Zod** | sesuai |
| Integrasi | **adapter `fetch`** (docmost/jira/github/llm) | REST; MCP tersimpan, belum jalan |
| Filesystem | **`node:path` + `Deno.*`** (`src/fs/workspace.ts`) | path-traversal guarded |
| Realtime | **SSE** | sesuai |
| Konfigurasi UI | **localStorage** (tema app & tema editor) + `ThemeProvider` | — |
| Native dialog | **binding** `chooseDirectory` (osascript/zenity/PowerShell) | folder picker |

**Belum dibangun:** AI SDK/Vercel, workflow engine (Temporal), sandbox coding loop, MCP client,
Kanban, ORM.

---

## 1. TL;DR — keputusan per layer

| Layer               | Rekomendasi (Desktop)                          | Profile Server                | Alternatif                 |
| ------------------- | ---------------------------------------------- | ----------------------------- | -------------------------- |
| Bahasa              | **TypeScript (strict)** + **Deno 2**           | sama                          | Node 22                    |
| Shell desktop       | **Deno Desktop** (baseline sekarang)           | —                             | Tauri v2 / Electron        |
| Renderer UI         | **Next.js 16 App Router + React 19**           | sama                          | Vite + React Router        |
| Styling             | **Tailwind CSS v4 + shadcn/ui**                | sama                          | —                          |
| State/data klien    | **TanStack Query + Zustand**                   | sama                          | Redux Toolkit              |
| Kanban DnD          | **dnd-kit**                                    | sama                          | react-beautiful-dnd        |
| Main process (otak) | **Deno** (adapter pattern)                     | Node/Deno service             | —                          |
| IPC renderer<->main | **local HTTP + SSE** (`Deno.serve`)            | HTTP/WS                       | Deno Desktop IPC           |
| Secret              | **OS keychain** (`secretRef`)                  | KMS/secret manager            | env                        |
| DB                  | **SQLite (libSQL) + Drizzle**                  | **Postgres + Drizzle/Prisma** | Prisma (SQLite)            |
| Validasi            | **Zod**                                        | sama                          | Valibot                    |
| AI SDK              | **Vercel AI SDK v5** + adapter provider        | sama                          | SDK vendor langsung        |
| LLM lokal           | **Ollama** (`openai-compatible`)               | —                             | LM Studio, llama.cpp       |
| MCP                 | **`@modelcontextprotocol/sdk`** (stdio + HTTP) | sama                          | —                          |
| Git                 | shell ke **system git**                        | server-side git               | `dugite`, `isomorphic-git` |
| Patch/diff          | **`git apply` + `diff` (jsdiff)**              | sama                          | —                          |
| Sandbox coding loop | **`git worktree` + Docker (`dockerode`)**      | E2B/Daytona/Modal             | —                          |
| Queue/workflow      | DB-backed queue in-process                     | **Temporal TS SDK**           | Inngest, graphile-worker   |
| Realtime            | SSE                                            | WS                            | —                          |
| Logging/obs         | **pino** + tabel cost/token                    | + OpenTelemetry               | —                          |
| Test                | **Vitest** + **Playwright**                    | sama                          | `deno test`                |
| Lint/format         | **Biome** (atau `deno lint`/`fmt`)             | sama                          | ESLint + Prettier          |
| Packaging           | **Deno Desktop** bundle + code signing         | kontainer                     | Tauri bundler              |

---

## 2. Runtime & shell desktop

| Opsi                          | Bagus untuk                                                                  | Catatan                                                                |
| ----------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Deno Desktop** (baseline)   | Cepat mulai, TS native, aman-by-default, sudah dipakai repo                  | Menjalankan Next.js perlu Node-compat; keychain butuh native addon/FFI |
| **Tauri v2** (Rust + WebView) | Aplikasi desktop ringan & aman, updater + keychain bawaan (`tauri-plugin-*`) | Wajib Rust; integrasi Node/`npx` MCP perlu dikemas                     |
| **Electron**                  | Ekosistem Node matang, keychain (`safeStorage`), MCP stdio mudah             | Bundle besar, konsumsi RAM tinggi                                      |

**Rekomendasi:** lanjutkan **Deno Desktop** untuk MVP (sesuai scaffold), tapi isolasi semua logika
non-UI ke **modul domain murni TypeScript** agar bisa pindah ke Tauri/ Electron/server tanpa menulis
ulang. Pertimbangkan Tauri v2 bila butuh updater & keychain yang lebih matang.

---

## 3. Renderer UI (frontend)

- **Next.js 16 App Router** + **React 19** (baseline repo).
- **Tailwind CSS v4** + **shadcn/ui** + **Radix UI** untuk komponen (Kanban, form, dialog).
- **TanStack Query** untuk data server-state (sync status, list tiket), **Zustand** untuk UI-state
  lokal.
- **dnd-kit** untuk drag-and-drop Kanban -> memicu transition Jira (`jira.md` §8).
- Renderer **hanya** bicara ke main process via API lokal (§4); **tidak** menyimpan secret.

> Jika dirasa Next.js terlalu berat untuk desktop, alternatifnya **Vite + React Router** (SPA) yang
> disajikan main process. Pertahankan App Router bila butuh RSC/route handlers.

---

## 4. Main process — jembatan & batas kepercayaan

Main process adalah **tempat semua secret & I/O sistem** (keychain, git, docker, MCP, panggilan
LLM). Renderer terisolasi.

| Kebutuhan              | Rekomendasi                                                                |
| ---------------------- | -------------------------------------------------------------------------- |
| Server internal        | **`Deno.serve`** di `127.0.0.1:<port acak>`, bind ke loopback saja         |
| Streaming status agent | **SSE** (`text/event-stream`) — selaras `CODE_EDITING_LOOP.md` §10         |
| Auth lokal             | token acak per-sesi (header) agar proses lain tak bisa memanggil API lokal |
| IPC alternatif         | channel native Deno Desktop/Electron (bila tidak ingin HTTP)               |

Kontrak: renderer memanggil `POST /api/*` -> main process menjalankan adapter -> mengembalikan DTO
tervalidasi Zod. **Secret tidak pernah** masuk payload balik.

---

## 5. Data & persistensi

| Profil      | DB                                                   | ORM                         | Alasan                                                |
| ----------- | ---------------------------------------------------- | --------------------------- | ----------------------------------------------------- |
| **Desktop** | **SQLite** (via `@libsql/client` / `better-sqlite3`) | **Drizzle**                 | Tanpa server, file tunggal, tipe kuat, migrasi ringan |
| **Server**  | **Postgres**                                         | **Drizzle** atau **Prisma** | Skala, konkurensi, `SKIP LOCKED` untuk queue          |

- **Zod** memvalidasi semua input API & output AI (JSON schema tool).
- Migrasi: **drizzle-kit**.
- Skema inti (lihat `STACK_TS.md` §3 & `PLAN.md` §6/§9.15): `projects`, `project_integrations`,
  `prd_documents`, `ticket_drafts`, `tickets`, `ticket_links`, `kanban_columns`, `workflow_runs`,
  `agent_steps`, `test_runs`, `bug_reports`, `ai_runs`/`ai_tool_calls`, `webhook_events`,
  `sync_cursors`.
- **Secret** disimpan terpisah (keychain), bukan di DB/file config.

---

## 6. Lapisan AI

- **Vercel AI SDK v5** (`ai`) sebagai abstraksi: `generateText`, `generateObject` (structured
  output), `streamText`, **tool calling**.
- Adapter provider: `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`.
- **LLM lokal**: **Ollama** via provider `openai-compatible` (atau `@ai-sdk/openai` dengan
  `baseURL: http://localhost:11434/v1`).
- **Routing per role** (`overview.md` §4): `pm`/`developer`/`reviewer` -> provider berbeda.
- **Verifier independen**: model/provider terpisah dari Coder (`CODE_EDITING_LOOP.md` §8).
- **Failover satu hop** (Cloud -> Local) via wrapper `chatJson()` dengan retry/backoff.
- **Cost & token tracking** per panggilan ke tabel `llm_calls`/`ai_runs`.

---

## 7. Integrasi (Docmost / Jira / GitHub)

- Satu **`fetch` wrapper** + **adapter pattern** di belakang interface (`DocProvider`,
  `TicketProvider`, `CodeProvider`) — `PLAN.md` §2.
- Factory berbasis config: `createDocmostClient(cfg)`, `createJiraClient(cfg)`,
  `createGithubClient(cfg)` — `configuration.md` §2.
- **REST** (default) & **MCP** (opt-in) — `docmost.md` §3, `jira.md` §2.
- **MCP client**: `@modelcontextprotocol/sdk` (transport **stdio** untuk `npx`, dan **streamable
  HTTP** untuk server remote).
- **Jira ADF**: converter markdown -> ADF (paket `@atlaskit/adf-utils` / `md-to-adf`) — `jira.md`
  §5.
- **Webhook receiver**: verifikasi signature + dedup (`webhook_events`).
- **Rate limit/backoff** menghormati `429`/`Retry-After`.

> Catatan: MCP `stdio` via `npx` menuntut **Node.js terpasang** di mesin user. Untuk desktop,
> siapkan opsi **(a)** bundle server MCP, **(b)** pakai MCP remote (HTTP), atau **(c)** fallback ke
> REST (`api`).

---

## 8. Git & coding loop

- **Git**: shell ke **system `git`** (child process) — paling andal & sudah terpasang di mesin
  developer. Alternatif: `dugite` (git ter-bundle) atau `isomorphic-git` (murni JS).
- **Patch**: `diff` (jsdiff) untuk membandingkan + `git apply` untuk menerapkan
  (`CODE_EDITING_LOOP.md` §6.3).
- **Isolasi**: **`git worktree` per tiket** (ringan, cepat) atau clone penuh.
- **Sandbox**:
  - Desktop: `git worktree` + proses terbatas + (opsional) **Docker** via `dockerode`.
  - Server: **E2B / Daytona / Modal / Fly Machines** (managed) atau Docker + gVisor.
- **Coding agent**: bungkus **Claude Code headless / Codex CLI / Aider / OpenHands** di dalam
  sandbox — jangan bangun loop edit dari nol (`CODE_EDITING_LOOP.md` §4).
- **Verifier**: jalankan `build_cmd` (lint+typecheck+build) + `test_cmd` (reporter JSON), lalu LLM
  terpisah mengekstrak bug report (`CODE_EDITING_LOOP.md` §8).

---

## 9. Queue & workflow

| Fase              | Rekomendasi                                                                             | Alasan                                                 |
| ----------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **MVP / Desktop** | Queue **in-process** + tabel job di SQLite (`workflow_runs`), worker dalam main process | Tanpa infra, cukup untuk 1 user                        |
| **Server**        | **Temporal TS SDK** (`@temporalio/client`/`worker`)                                     | Durable, resume, retry, timer, signal — `PLAN.md` §9.2 |
| Alternatif server | **Inngest**, **graphile-worker** (PG), **pg-boss**                                      | Lebih ringan dari Temporal                             |

- Lock per tiket (distributed lock di server; mutex lokal di desktop).
- Resume: simpan `cursor`, `sandbox_id`, `budget_used` (`CODE_EDITING_LOOP.md` §11).

---

## 10. Observability, testing, tooling

- **Log**: **pino** (JSON terstruktur) + redact secret.
- **Observability server**: **OpenTelemetry** (trace LLM/tool call) — opsional.
- **Metrik biaya**: tabel `llm_calls` + dashboard (biaya/tiket, iterasi, hasil Verifier).
- **Unit test**: **Vitest** (atau `deno test`).
- **E2E UI**: **Playwright** (juga untuk uji alur Kanban/Drafts).
- **Lint/format**: **Biome** (cepat, satu alat) — atau pertahankan ESLint + Prettier (repo sekarang
  memakai ESLint). Hindari duplikasi dua linter.

---

## 11. Keamanan

- Secret di **OS keychain** (macOS Keychain / Windows Credential Manager / libsecret), bukan
  plaintext seperti pola `~/.local/share/opencode/auth.json` (`overview.md` §8).
- **Least privilege**: OAuth scope / PAT / GitHub App dibatasi.
- **Verifikasi signature** webhook; **allowlist host** untuk `baseUrl` (anti-SSRF).
- Renderer **tanpa** akses secret & filesystem langsung; semua lewat main process.
- Sandbox **tanpa kredensial prod**; egress allowlist (`CODE_EDITING_LOOP.md` §13).
- **Audit** semua tool call & write eksternal.

---

## 12. Struktur repo (disarankan)

```
RND-workflow/
  docs/                        # PLAN.md, overview.md, docmost.md, jira.md, ...
  app/                         # Next.js (renderer UI)  <-- scaffold sekarang
  src/                         # (opsional) domain murni TypeScript
    core/                      #   schema Zod, tipe domain, use-cases
    integrations/             #   docmost.ts, jira.ts, github.ts (adapter)
    ai/                       #   provider + planner + coder + verifier
    workflow/                 #   state machine + runner
    secrets/                  #   keychain adapter + secretRef resolver
  desktop/                     # main process (Deno): serve, IPC, spawn git/docker/MCP
  prisma|drizzle/              # skema + migrasi
```

Naikkan ke **pnpm/Deno workspace** bila perlu: `apps/desktop`, `apps/server`, `packages/core`,
`packages/mcp`.

---

## 13. Dependensi konkret (usulan)

```jsonc
{
  "frontend": [
    "next",
    "react",
    "react-dom",
    "tailwindcss",
    "shadcn-ui",
    "@radix-ui/*",
    "@tanstack/react-query",
    "zustand",
    "@dnd-kit/core",
    "@dnd-kit/sortable"
  ],
  "ai": [
    "ai",
    "@ai-sdk/anthropic",
    "@ai-sdk/openai",
    "@ai-sdk/google",
    "ollama",
    "@modelcontextprotocol/sdk"
  ],
  "data": ["drizzle-orm", "drizzle-kit", "@libsql/client", "zod"],
  "infra": ["pino", "dockerode", "@temporalio/worker", "@temporalio/client"],
  "converter": ["@atlaskit/adf-utils", "diff"],
  "dev": ["vitest", "@playwright/test", "biome"]
}
```

---

## 14. Mapping ke milestone

| Milestone   | Stack yang dipakai                                               |
| ----------- | ---------------------------------------------------------------- |
| M0–M1       | Deno Desktop + Next.js + SQLite + Drizzle + adapter health-check |
| M2–M3       | Vercel AI SDK (generateObject) + Zod + REST Jira (bulk)          |
| M4          | Webhook receiver + `ticket_links` + GitHub API                   |
| M5          | Config UI + secret keychain + audit                              |
| M6          | Queue DB-backed + `git worktree` + state machine                 |
| M7          | Coder loop + Verifier + bug report                               |
| M8          | PR otomatis + human gate + dashboard biaya                       |
| Server mode | Postgres + Temporal + sandbox managed (E2B/Daytona)              |

---

## 15. Risiko & catatan

1. **Deno + Next.js + native addon** (keychain) bisa rewel -> bungkus secret di balik interface
   `SecretStore` agar bisa ganti implementasi.
2. **MCP stdio** butuh Node; sediakan jalur REST & MCP HTTP.
3. **SQLite -> Postgres**: jaga query tetap lewat ORM agar migrasi mulus.
4. **Auto-merge**: tetap human gate (`overview.md` §7).
5. **Ukuran bundle** desktop: awasi dependensi berat (Playwright hanya dev).

---

## 16. Pertanyaan terbuka

1. Tetap **Deno Desktop**, atau evaluasi **Tauri v2** (updater + keychain matang)?
2. Perlu **dockerode** di desktop, atau cukup sandbox managed/server?
3. Model default tiap role (Cloud vs Local) untuk biaya vs privasi?
