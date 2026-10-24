# Getting started

## Prasyarat

- **Deno 2.9+** (dengan dukungan `deno desktop`)
- **Node.js + npm** (hanya untuk build client Vite di `web/`)
- macOS / Windows / Linux sesuai target `deno.json` → `desktop.output`

## Perintah utama

| Perintah | Fungsi |
| --- | --- |
| `deno task build` | Build Vite (`web/dist`) + embed ke `src/ui/assets.generated.ts` |
| `deno task dev` | Build lalu jalankan desktop + HMR |
| `deno task start` | Build lalu jalankan tanpa shell desktop (`deno run`) |
| `deno task desktop` | Build lalu package ke `./dist/RNDWorkflow.app` (macOS) |
| `deno task web:dev` | Vite HMR client saja (iterasi UI) |
| `deno task check` | Typecheck backend (`deno check --desktop main.ts`) |
| `deno task lint` / `deno task fmt` | Lint / format Deno (exclude `web/**`) |
| `deno task test` | `deno test -A test/` |
| `cd web && npx tsc --noEmit` | Typecheck client |

Permission yang dipakai task desktop/run: `--allow-read --allow-write --allow-net --allow-env --allow-run --allow-ffi`.

## Setup pertama di aplikasi

1. Jalankan `deno task dev` (atau buka `.app` hasil `desktop`).
2. **Workspace** → buat project; set folder workspace (kode) dan opsional document path (Markdown).
3. **Global Settings → LLM Providers** → tambah provider (OpenAI-compatible atau Anthropic).
4. **Project Settings → Integrations** → Docmost / Notion / Confluence / Jira / GitHub sesuai kebutuhan.
5. Buka **Document**, **Ticket**, **Explorer**, **Git**, **Terminal** dari activity bar.
6. Opsional: **Global Settings → Automation** untuk auto-build saat tiket masuk In Progress.

## Data aplikasi

Default app data dir (bisa dioverride `RND_APP_DATA_DIR`):

- macOS: `~/Library/Application Support/RND Workflow/`
- Berisi `data.db` (SQLite) dan folder skills (`skills/`, `project-<slug>/skills/`).

Treat `data.db` sebagai sensitif: token/API key disimpan plaintext di config.

## Checklist sebelum selesai mengubah kode

Sesuai [`AGENTS.md`](../AGENTS.md):

1. `deno task build`
2. `deno task check`
3. `deno task lint`
4. `deno task test`
5. `cd web && npx tsc --noEmit`

Jangan edit `src/ui/assets.generated.ts` secara manual.
