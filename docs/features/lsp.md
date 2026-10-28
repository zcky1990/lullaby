# Language Server Protocol (LSP)

Monaco bisa terhubung ke language server lokal untuk diagnostics, completion, hover, signature
help, go to definition/declaration/implementation, references, document highlight/symbol, folding,
rename, code action, dan formatting.

## Arsitektur

- Client: `web/src/lib/lsp.ts` memakai `monaco-lsp-bridge` (dynamic import).
- Transport: WebSocket `/api/projects/:id/lsp?language=<monaco-language-id>`.
- Backend: `src/server/lsp.ts` menjalankan server dengan `Deno.Command` dan menjembatani
  **stdio LSP ↔ WebSocket** (frame `Content-Length`, byte UTF-8).
- Model file workspace memakai URI `file:///absolute/path` agar cocok dengan LSP.
- Satu proses server per file tab yang terbuka; proses dimatikan saat tab ditutup / LSP dimatikan.
- LSP hanya aktif untuk file workspace, bukan Workflow YAML/MCP/Markdown.
- `MonacoViewer` reconnect otomatis saat `lsp` config berubah (settings fetch selesai, path
  berubah, atau event `rnd:lsp-settings-changed` setelah Simpan di Global Settings).

## Konfigurasi

Global Settings → **Language Servers**.

| Field | Keterangan |
| --- | --- |
| `enabled` | Master switch LSP. Default nonaktif. |
| `name` | Label server. |
| `languages` | Monaco language ID: `typescript`, `javascript`, `python`, `go`, `rust`, `yaml`, `shell`, `c`, `cpp`, `lua`. |
| `command` | Executable (nama di PATH atau absolute path). |
| `args` | Argumen, satu per baris. |
| `env` | Environment tambahan (`KEY=value` per baris). |
| `mode` | `local` atau `npx` (metadata; command tetap yang dipakai). |
| `initializationOptions` | Objek JSON opsional, dikirim saat `initialize`. |

Disimpan di `app_settings` key `lsp_settings`.

Preset tersedia: TypeScript/JS, Python (pyright), YAML, Bash, Go (gopls), Rust (rust-analyzer),
C/C++ (clangd), Lua. Preset Node punya varian lokal dan `npx`.

Setelah **Simpan**, tab file yang terbuka me-refetch settings dan reconnect tanpa menutup file.

## Status UI

- Badge di header tab file: `LSP Connecting…` / `Ready` / `Error` (+ pesan singkat saat error).
- Status bar (kanan): `LSP · Ready · typescript` (atau Connecting/Error); hilang saat LSP off.

## Contoh

TypeScript lokal:

```json
{
  "name": "TypeScript",
  "languages": ["typescript", "javascript"],
  "command": "typescript-language-server",
  "args": ["--stdio"],
  "env": {},
  "enabled": true,
  "mode": "local"
}
```

Python via npx:

```json
{
  "name": "Python",
  "languages": ["python"],
  "command": "npx",
  "args": ["--yes", "pyright-langserver", "--stdio"],
  "env": {},
  "enabled": true,
  "mode": "npx"
}
```

## API

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/api/settings/lsp` | Settings + preset |
| PUT/POST | `/api/settings/lsp` | Simpan settings |
| POST | `/api/settings/lsp/probe` | Cek command ditemukan (`{ command }`) |
| WS | `/api/projects/:id/lsp?language=` | Koneksi LSP |

## Keamanan

- Language server adalah proses lokal dengan hak user; hanya jalankan command tepercaya.
- Command hanya berasal dari settings tersimpan, bukan query string.
- WS memakai session cookie yang sama dengan HTTP API.
- Batas frame 8 MB dan maksimal 3 koneksi LSP per project.
- stderr server diteruskan sebagai `window/logMessage`, bukan stdout.

## Troubleshooting

- **Command tidak ditemukan**: install server atau isi absolute path. Aplikasi desktop yang dibuka
  dari Finder bisa punya PATH minim; resolusi mencoba login shell dan common bin dirs.
- **npx gagal**: butuh Node/npm dan koneksi internet saat pertama dipakai. Tombol **Cek** hanya
  memverifikasi binary `npx`, bukan package di args.
- **Tidak ada diagnostics**: pastikan master switch + server aktif, bahasa cocok, dan status badge
  menunjukkan Ready. Simpan settings lalu tunggu reconnect.
- **TypeScript menampilkan saran ganda**: Monaco sudah punya TS worker internal; matikan server TS
  eksternal jika tidak diperlukan.
- **LSP error di header tab / status bar**: buka tooltip badge untuk pesan; cek command/args di
  Global Settings.
- **`no views` / `no views in session`**: biasanya language server (mis. gopls) belum menerima
  notifikasi `initialized` setelah `initialize`, atau workspace path invalid. App mengirim
  `initialized` dengan `params: {}` otomatis; buka ulang file setelah update. Pastikan
  `workspace_path` adalah folder project yang valid.
- **`JSON RPC cancelled`**: request completion/hover yang dibatalkan saat mengetik — diabaikan
  oleh status UI (bukan error fatal). Jika badge tetap Error, buka ulang file.
