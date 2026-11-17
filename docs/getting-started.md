# Getting started

## Prasyarat

- **Deno 2.9+** (dengan dukungan `deno desktop`)
- **Node.js + npm** (hanya untuk build client Vite di `web/`)
- macOS / Windows / Linux sesuai target `deno.json` → `desktop.output`

## Langkah setup (sekali)

Dependensi client **tidak** ikut ter-commit, jadi `web/node_modules` harus dipasang dulu sebelum
build pertama:

```bash
deno task web:install   # = npm --prefix web ci (pakai web/package-lock.json)
```

Build Vite memakai `vite.config.ts` yang mengimpor plugin dari `web/node_modules`
(`@vitejs/plugin-react`, `@tailwindcss/vite`). Bila langkah ini dilewati, Vite gagal saat memuat
config dengan pesan seperti:

```
vite.config.ts (2:18) [UNRESOLVED_IMPORT] Could not resolve "@vitejs/plugin-react"
vite.config.ts (3:24) [UNRESOLVED_IMPORT] Could not resolve "@tailwindcss/vite"
```

Itu **bukan** bug konfigurasi/kode — hanya dependensi client belum ada di mesin itu (atau perintah
dijalankan dari root repo sehingga `web/node_modules` tidak terlihat). Perbaikan: jalankan
`deno task web:install`, lalu `deno task build`. Bila perlu bersih total:
`rm -rf web/node_modules && deno task web:install`.

## Perintah utama

| Perintah | Fungsi |
| --- | --- |
| `deno task web:install` | Pasang dependensi client (`npm --prefix web ci`) |
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

- macOS: `~/Library/Application Support/Lullaby/`
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
