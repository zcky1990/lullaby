# Product Requirement Document (PRD) — Hybrid Architecture

**Nama Proyek:** Hybrid AI-Driven Agile Desktop Workspace
**Status:** Draft diperbarui (selaras implementasi F0)
**Target Platform:** Windows / macOS / Linux (Desktop Application, dibungkus Deno Desktop — `README.md`)
**Versi:** 1.2.0

Referensi teknis: `PLAN.md` (alur end-to-end), `CODE_EDITING_LOOP.md` (runtime & loop coding),
`STACK_RECOMMENDATION.md` (stack + status implementasi), `configuration.md` (bentuk config),
`docmost.md` (sumber PRD), `jira.md` (board/tiket).

> **Catatan implementasi:** dokumen ini adalah PRD; bagian yang sudah dibangun ditandai
> **[implemented]**, sisanya target. Lihat `README.md` §Status untuk ringkasan.

---

## 1. Ringkasan Eksekutif & Fleksibilitas Sistem

Aplikasi desktop untuk siklus pengembangan otomatis dengan dua sumbu kebebasan:

1. **AI Provider** — **Local** (Ollama/LM Studio) atau **Cloud** (Anthropic/OpenAI/DeepSeek/Gemini).
2. **Integrasi** — **MCP** (opt-in) atau **Direct REST API** (default).

Pengguna bebas memilih **100% offline/privacy-focused** (LLM lokal) atau **Cloud** (performa).
Setiap **role agent** (PM/Developer/Reviewer) dapat memakai provider & model berbeda.

**[implemented]** Backend berjalan di **main process Deno Desktop**; UI React di webview via HTTP
lokal. Kredensial & I/O sistem hanya di main process.

---

## 2. Model Data & Konfigurasi **[implemented]**

> Perubahan dari draft awal: konfigurasi **tidak** lagi file `config.json` dengan `secretRef`.
> Data disimpan **project-centric** di SQLite (`data.db`, `node:sqlite`). Kredensial diisi sebagai
> **teks biasa** dan disimpan di `config` integrasi.

Entitas inti:

```
Project (root)
  ├─ workspace_path, docmost_space_id, jira_project_key, github_repo
  ├─ project_integrations  (kind: docmost | jira | github, mode: api | mcp, config JSON)
  └─ llm_providers[]       (name, provider, model, base_url, api_key, mode)
```

Contoh isi `config` integrasi (di dalam `data.db`):

```json
{
  "docmost": { "mode": "api", "config": { "baseUrl": "https://docs.company.com", "apiToken": "…", "spaceId": "sp_123" } },
  "jira":    { "mode": "api", "config": { "baseUrl": "https://company.atlassian.net", "deployment": "cloud", "projectKey": "PROJ", "email": "dev@company.com", "apiToken": "…" } },
  "github":  { "mode": "api", "config": { "baseUrl": "https://api.github.com", "org": "acme", "repo": "app", "token": "…" } }
}
```

Contoh `llm_providers` (banyak per project):

```json
[
  { "name": "Anthropic Cloud", "provider": "anthropic", "model": "claude-sonnet-4", "baseUrl": "https://api.anthropic.com/v1", "apiKey": "…", "mode": "api" },
  { "name": "Ollama Local",    "provider": "ollama",    "model": "qwen2.5-coder:14b", "baseUrl": "http://localhost:11434/v1", "apiKey": null, "mode": "api" }
]
```

**Prinsip:**
- **`api` default; `mcp` opt-in** (tanpa fallback otomatis). Mode `mcp` tersimpan tetapi **belum
  dieksekusi** (lihat §4).
- Validasi input dengan **Zod** (`src/config/schema.ts`).
- Migrasi kolom ringan (`ensureColumn`) untuk DB lama.

---

## 3. Menu Aplikasi **[implemented]**

Shell ala VSCode: activity bar (kiri) + panel + area utama.

| Menu | Muncul bila | Isi |
| --- | --- | --- |
| **Workspace** | selalu | daftar/buat project (nama + workspace folder), overview |
| **Explorer** | project punya `workspace_path` | file tree folder workspace + viewer **Monaco** |
| **Document** | selalu | daftar halaman Docmost (+ isi markdown) |
| **Ticket** | selalu | **Kanban** tiket Jira full-width: kolom tetap (Backlog/To Do/In Progress/Test/Done), drag = transition, klik card = detail, filter assignee |
| **Project Settings** | ada project | Workspace · Integrations (section Document/Ticket/Code + tombol `+` pilih tipe) · LLM Providers · Activity |
| **Global Settings** | selalu | satu halaman: Appearance (tema app) · Editor (tema Monaco) · About |

---

## 4. Mode Integrasi

| Fitur | MCP | Direct REST API |
| --- | --- | --- |
| **Pengoperasian** | background process via `npx`/stdio (JSON-RPC 2.0) | HTTP/REST via `fetch` |
| **Kelebihan** | standar universal; tool siap pakai | cepat; tanpa runtime Node eksternal |
| **Kekurangan** | butuh runtime Node & manajemen proses | adapter + mapping field per vendor |
| **Status** | **[belum]** — mode tersimpan, eksekusi belum ada | **[implemented]** |

`api` default; `mcp` **selalu opt-in** per integrasi. Lihat `docmost.md` §3 & `jira.md` §2.

---

## 5. Multi-Provider & Agent Roles

- **[implemented]** **`llm_providers[]`** — banyak provider per project; `provider` menentukan adapter
  (`anthropic` | `openai` | `ollama` | `deepseek` | `gemini` | `local`). Tiap provider: `model`,
  `baseUrl`, `apiKey`, `mode`.
- **[belum]** **`agent_roles[]`** — pemetaan role → provider + model + system prompt.
  - `role` minimal: `pm` (Planner), `developer` (Coder), `reviewer` (Verifier).
  - **Verifier harus independen**: idealnya provider/model berbeda dari Coder
    (`CODE_EDITING_LOOP.md` §8).

---

## 6. Persyaratan Fungsional (FR)

- **FR-02 (Hybrid Integrator)** **[implemented]**: pilih mode `mcp`/`api` per integrasi Dokumen &
  Papan Tugas; `api` default, `mcp` opt-in.
- **FR-04 (Multi-Provider Manager)** **[implemented]**: banyak provider LLM per project (local/cloud).
- **FR-08 (Fallback Mechanism)** **[belum]**: failover satu hop Cloud → Local (rencana).
- **FR-09 (Config Validation)** **[implemented]**: validasi Zod untuk semua input API & config.
- **FR-10 (Connection Test)** **[implemented]**: aksi **Test Connection** per integrasi & provider.
- **FR-11 (Credential Handling)** **[revised]**: kredensial disimpan **plaintext** di `config`
  integrasi / `llm_providers.api_key` (keputusan saat ini; lihat §8). Tidak dikirim ke UI kecuali
  saat diedit.
- **FR-12 (Workspace & Explorer)** **[implemented]**: set folder workspace (native picker), file tree,
  viewer kode Monaco.
- **FR-13 (Theming)** **[implemented]**: Global Settings untuk tema app (Light/Dark/System) & tema
  editor (Auto/vs/vs-dark/hc-black/hc-light), persist di `localStorage`.
- **FR-14 (Ticket Kanban)** **[implemented]**: board kolom tetap (Backlog/To Do/In Progress/Test/Done;
  kolom kosong tetap tampil, card seragam), drag antar kolom memicu **Jira transition**, klik card
  membuka **dialog detail** (deskripsi ADF→teks), dan filter per **assignee**.

---

## 7. Keamanan & Penyimpanan Kredensial

| Aspek | Ketentuan (implementasi saat ini) |
| --- | --- |
| Penyimpanan | Kredensial **plaintext** di `data.db` (`config` / `api_key`) — `data.db` sensitif |
| Transport | Hanya di main process; tidak pernah dikirim ke renderer kecuali field yang sedang diedit |
| Filesystem | Hanya folder workspace; path-traversal diblokir (`src/fs/workspace.ts`) |
| Log | Redact field sensitif (`src/core/logger.ts`) |
| Audit | Aksi write/event dicatat (`events`) |

**[rencana]** Kembalikan ke OS keychain/secretRef bila diperlukan (perubahan di balik interface
yang sama). Lihat `configuration.md` §4.

---

## 8. Keputusan

1. **Lokasi backend:** **main process desktop** (semua I/O sistem & kredensial).
2. **Mode integrasi:** `api` default; `mcp` **opt-in**.
3. **Failover LLM:** **satu hop** Cloud → Local (rencana).
4. **Kredensial:** **plaintext di config** (keputusan produk saat ini); helper `src/secrets`
   (env/keychain) tidak dipakai.
5. **Tema:** dua tingkat — **app** (Light/Dark/System) & **editor** (Monaco) — di Global Settings.

---

## 9. Ruang Lingkup & Status

**In scope (F0, sudah dibangun):** project + workspace, integrasi Docmost/Jira/GitHub/LLM, health-check,
list document/ticket, Explorer (file tree + Monaco), live activity, Global Settings (tema).

**Belum:** generate tiket AI dari PRD, push/JQL bulk Jira, workflow engine, sandbox coding
loop, MCP transport, agent_roles.

**Non-goals saat ini:** auto-merge tanpa human gate, kolaborasi multi-user real-time, dan
sinkronisasi dua arah status di mana aplikasi menjadi SoT (**SoT status tetap Jira** — `jira.md` §10).
