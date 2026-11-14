# Improvement backlog

Saran peningkatan untuk **Lullaby**, disusun dari temuan nyata di repo (ukuran bundle, ukuran file,
isian CI, dan drift dokumentasi). Dokumen ini menggantikan [`IMPROVEMENTS.md`](../IMPROVEMENTS.md)
di root dan menjadi satu tempat untuk ide engineering + produk.

Ini **bukan roadmap resmi** — tidak ada item di sini yang otomatis dikerjakan. Anggap sebagai
backlog yang diprioritaskan; setiap item punya bukti, cara kerja, dan dampak yang bisa diukur.

Skala yang dipakai:

| Label | Arti |
| --- | --- |
| **Dampak** | `Tinggi` = terasa langsung oleh pengguna/rilis · `Sedang` = kecepatan kerja tim · `Rendah` = polish |
| **Effort** | `S` < ½ hari · `M` 1–2 hari · `L` > 2 hari |
| **Status** | `Open` · `Sebagian` (sudah ada fondasinya) · `Selesai` |

---

## 1. Ringkasan prioritas

| ID | Item | Area | Dampak | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| PERF-1 | Ganti favicon 1,5 MB PNG → WebP | Bundle | Tinggi | S | Open |
| PERF-2 | Tree-shake bahasa Monaco (~90 bahasa ter-bundle) | Bundle | Tinggi | M | Open |
| PERF-4 | Mermaid hanya dimuat bila ada blok diagram | Bundle | Tinggi | S | Open |
| PERF-5 | Kompresi aset embedded (brotli) di `build-assets` | Bundle | Tinggi | M | Open |
| PERF-6 | Cache header + memoize decode di `static.ts` | Runtime | Sedang | S | Open |
| CI-1 | Jalankan unit test `web/` (vitest) di CI | Kualitas | Tinggi | S | Open |
| CI-5 | Lint/format untuk `web/` (Biome) | Kualitas | Sedang | M | Open |
| REL-1 | Persist chat run + `pendingChanges` | Keandalan | Tinggi | L | Open |
| SEC-1 | CSP + header keamanan pada shell HTML | Keamanan | Tinggi | M | Open |
| ARCH-1 | Pecah `src/server/router.ts` (77 KB) per domain | Arsitektur | Sedang | L | Sebagian |
| ARCH-2 | Pecah `web/src/App.tsx` (69 KB) jadi hooks | Arsitektur | Sedang | L | Sebagian |
| DOC-1 | Sinkronkan drift dokumentasi (7 temuan §11) | Dokumentasi | Sedang | S | Open |

Urutan eksekusi yang disarankan ada di [§12](#12-rencana-eksekusi).

---

## 2. Baseline dan cara mengukur

Angka di bawah diambil dari repo saat dokumen ini ditulis. Ukur ulang sebelum dan sesudah
perubahan agar klaim "lebih cepat/lebih kecil" bisa dibuktikan.

| Metrik | Nilai sekarang | Cara ukur |
| --- | --- | --- |
| `src/ui/assets.generated.ts` | **24,0 MB** (23.998.363 B) | `ls -lh src/ui/assets.generated.ts` |
| Chunk editor `MonacoViewer-*.js` | **4,1 MB** | `ls -S web/dist/assets \| head` |
| `ts.worker-*.js` | **7,0 MB** | idem |
| `css.worker` / `html.worker` / `json.worker` | 1,06 MB / 719 KB / 409 KB | idem |
| Chunk utama `index-*.js` | **1,19 MB** | idem |
| CSS utama | 98 KB | idem |
| Chunk `MarkdownView-*.js` (mermaid) | **778 KB** + chunk diagram (elk 1,48 MB, cynefin 658 KB, cytoscape 444 KB, katex 262 KB) | idem |
| `web/public/lullaby.png` (favicon) | **1,54 MB** (`.webp` yang sudah ada: 72 KB) | `ls -lh web/public` |
| File sumber terbesar | `router.ts` 77 KB · `App.tsx` 69 KB · `ChatSidebar.tsx` 58 KB · `api.ts` 36 KB | `ls -S` |
| Test backend / web | 15 file `test/` · 11 file `web/src/lib/*.test.ts` | hitung file |

Target yang disarankan (bukan janji): aset embedded **≤ 10 MB**, chunk utama **≤ 500 KB**,
favicon **≤ 100 KB**, dan vitest ikut CI.

---

## 3. Performa & ukuran distribusi

Karena UI di-embed ke binary (`scripts/build-assets.ts` → `src/ui/assets.generated.ts`), setiap
kilobyte chunk = kilobyte binary + waktu build + diff 24 MB di git. Ini area dengan ROI tertinggi.

### PERF-1 — Favicon 1,5 MB ikut ter-embed

**Bukti**: `web/public/lullaby.png` = 1.542.309 B dan tersalin ke `web/dist/lullaby.png`, lalu
di-base64 ke `assets.generated.ts`. Padahal `web/public/lullaby.webp` (72 KB) sudah ada di repo.

**Cara**: pakai `lullaby.webp` di `web/index.html`, hapus PNG dari `web/public/` (ikon packaging
tetap di `icons/`), dan tambahkan guard di `scripts/build-assets.ts` yang gagal/warn bila ada aset
non-JS > 500 KB.

**Dampak**: −1,4 MB binary, satu baris HTML.

### PERF-2 — Semua bahasa Monaco ter-bundle

**Bukti**: `web/src/lib/monaco.ts` memakai `import * as monaco from "monaco-editor"`, sehingga
`web/dist/assets` berisi ~90 modul bahasa (`abap`, `apex`, `azcli`, `solidity`, …). Padahal
`web/src/lib/languages.ts` hanya memakai ~25 id.

**Cara**:
1. Impor inti saja: `monaco-editor/esm/vs/editor/editor.api`.
2. Daftarkan hanya bahasa dari `LANGUAGE_BY_EXTENSION` + `dockerfile`/`makefile`/`markdown`/`yaml`
   (`import "monaco-editor/esm/vs/basic-languages/python/python.contribution"`, dst).
3. Simpan daftar id di satu modul (`web/src/lib/monaco-languages.ts`) supaya `languages.ts` dan
   registrasi tidak drift.
4. Verifikasi: jumlah file `web/dist/assets/*.js` turun drastis, `MonacoViewer-*.js` turun.

**Dampak**: estimasi −3 sampai −6 MB aset; editor tetap mendukung semua ekstensi yang dipetakan.

### PERF-3 — Worker editor dimuat eager semua

**Bukti**: `getWorker` di `web/src/lib/monaco.ts` meng-import 5 worker secara statis; `ts.worker`
(7 MB) ikut terbawa walau proyek hanya berisi Markdown.

**Cara**: `MonacoEnvironment.getWorker` boleh mengembalikan `Promise<Worker>`; ubah ke dynamic
`import()` per label sehingga worker hanya di-fetch saat bahasa itu dipakai. Tambahkan opsi
"disable TypeScript service" di Global Settings bila TS worker tidak diperlukan.

**Dampak**: waktu buka editor pertama turun signifikan; aset binary tidak berubah bila tetap
di-embed, jadi kombinasikan dengan PERF-5.

### PERF-4 — Mermaid dimuat untuk setiap tampilan Markdown

**Bukti**: `web/src/components/MarkdownView.tsx` meng-import `Mermaid` secara statis; akibatnya
chunk 778 KB + seluruh renderer diagram ikut terunduh walau dokumen tidak punya blok mermaid.

**Cara**:
1. `const Mermaid = React.lazy(() => import("@/components/Mermaid"))` + `<Suspense>` di blok
   `language-mermaid` saja.
2. Audit tipe diagram yang benar-benar dipakai di dokumen wiki (`flowchart`, `sequence`, `er`).
   Bila cuma 2–3 tipe, ganti `import mermaid from "mermaid"` dengan registrasi terbatas
   (`mermaid/core` + diagram yang dipakai) sehingga `elk`/`cynefin`/`cytoscape` tidak ikut.
3. Untuk diagram statis di dokumen bawaan, pertimbangkan menyimpan SVG hasil render.

**Dampak**: −778 KB pada jalur baca dokumen biasa; −2 sampai −3 MB bila renderer dipangkas.

### PERF-5 — Kompresi aset embedded

**Bukti**: `scripts/build-assets.ts` menyimpan teks apa adanya dan biner sebagai base64 (+33%).
File hasil 24 MB; JS/CSS teks biasanya kompres ~3–4×.

**Cara**:
1. Di `build-assets.ts`, hitung `CompressionStream("gzip"/"deflate-raw")` (brotli belum ada di
   Deno std; gunakan gzip atau pre-compute `.br` saat build Vite).
2. Simpan `{ encoding: "base64", compression: "gzip" }`; decode + decompress di `static.ts`
   (memoized, lihat PERF-6), kirim `content-encoding: gzip` + `vary: accept-encoding`.
3. Alternatif/damping: `.gitignore` untuk `src/ui/assets.generated.ts` dan generate di
   `deno task build` (CI + release), supaya diff 24 MB hilang dari histori. Konsekuensi: `deno run`
   dari checkout bersih butuh `deno task build` dulu — catat di `getting-started.md`.

**Dampak**: binary turun ~3–4×; build/commit jauh lebih ringan.

### PERF-6 — `static.ts` decode per request & `no-store`

**Bukti**: `src/server/static.ts` memanggil `decode()` (base64 → `Uint8Array`) pada setiap request
dan mengirim `cache-control: no-store` untuk semua aset, termasuk file ber-hash.

**Cara**:
1. Memoize hasil decode di `Map<string, Uint8Array>` (lazy, cukup 1×).
2. Aset ber-hash (`/assets/*`): `cache-control: public, max-age=31536000, immutable`.
3. `index.html`: `no-store` (tetap), plus `ETag` untuk aset non-hash.

**Dampak**: reload/HMR terasa instan; CPU render proses turun saat webview refresh.

### PERF-7 — Code split panel berat

**Bukti**: chunk utama 1,19 MB; beberapa panel berat di-import statis di shell (`TicketKanban`
dengan `@dnd-kit` + `@base-ui`, `TerminalPanel`/xterm, `GlobalSettingsView`, `GitTab` 30 KB).

**Cara**: `React.lazy` per tab (pola yang sudah dipakai `WorkflowTab`, `MarkdownView`,
`MonacoViewer`), skeleton dari `ui/skeleton` sebagai fallback.

**Dampak**: time-to-interactive awal lebih cepat; chunk utama turun ke kisaran 500–700 KB.

---

## 4. Arsitektur & maintainability

### ARCH-1 — `src/server/router.ts` masih 77 KB

**Bukti**: `src/server/routes/` sudah ada (`backup`, `llm`, `roles`, `settings`, `workflows`),
tetapi `router.ts` masih 77.439 B (~1.700 LOC) dan memuat files, git, tickets, documents, chat,
terminal, projects sekaligus.

**Cara**: pindahkan sisa domain dengan pola yang sudah ada — handler di `routes/<domain>.ts`,
`router.ts` hanya tabel rute + auth + fallback:
`routes/projects.ts`, `routes/files.ts`, `routes/git.ts`, `routes/tickets.ts`,
`routes/documents.ts`, `routes/chat.ts`, `routes/events.ts`. Tambahkan test request-level untuk
tiap domain setelah dipindah (auth 401 + happy path).

**Dampak**: review lebih kecil, konflik merge turun, waktu `deno check` lokal lebih nyaman.

### ARCH-2 — `web/src/App.tsx` (69 KB) sebagai state hub

**Bukti**: `web/src/hooks/` baru berisi `useEditorTabs`, `useDirtyPaths`, `useLayoutMode`; state
tiket, git, dokumen, chat, dan project masih menumpuk di `App.tsx`.

**Cara**: lanjutkan ekstraksi: `useProjects`, `useTickets`, `useGit`, `useChatRun`,
`useDocuments`, `useActivity`. Aturan sederhana: hook memiliki fetch + state + efek; `App.tsx`
hanya komposisi dan routing tab.

**Dampak**: perubahan fitur tidak lagi menyentuh file 69 KB; testing hook jadi mungkin.

### ARCH-3 — `ChatSidebar.tsx` (58 KB) dan `api.ts` (36 KB)

**Cara**: pecah `ChatSidebar` menjadi `ChatMessageList`, `ChatComposer`, `ChatRunControls`,
`ChatAttachments` (logika non-UI sudah ada di `lib/chat-*.ts` — tinggal dipindah). Pecah `api.ts`
menjadi `lib/api/{client,projects,files,git,tickets,documents,chat,settings}.ts` dengan
`client.ts` sebagai satu-satunya tempat `fetch`/`ApiError`/timeout.

### ARCH-4 — Tipe API ditulis tangan di dua tempat

**Bukti**: `src/config/schema.ts` (Zod) dan `web/src/lib/api.ts` (tipe manual) mendeskripsikan
payload yang sama; drift hanya ketahuan saat runtime.

**Cara**: buat `shared/` berisi tipe hasil inferensi Zod (tanpa dependensi Deno-only), atau
generate `web/src/lib/api-types.ts` dari schema (`zod-to-ts`) sebagai langkah build. Vite sudah
mendukung impor lintas folder via alias.

**Dampak**: kontrak API tervalidasi compiler, bukan manual.

---

## 5. Keandalan & observability

### REL-1 — Run chat hanya di memori

**Bukti**: `src/server/chat/state.ts` menyimpan `runs` di `Map` dengan TTL 10 menit. Restart
aplikasi (atau crash) menghilangkan `pendingChanges` sehingga Review tidak bisa dilakukan lagi,
padahal perubahan sudah diterapkan ke disk pada mode review `end`.

**Cara**: tabel `chat_runs` (`id`, `session_id`, `status`, `pending_changes` JSON, `created_at`,
`finished_at`); tulis saat run selesai/berhenti; rehidrasi saat bootstrap; tandai `interrupted`
seperti pola `workflow_runs`. UI Review membaca dari API, bukan dari state stream.

**Dampak**: tidak ada lagi "perubahan hilang tanpa bisa di-revert" setelah restart.

### REL-2 — SSE tanpa `id`/resume

**Bukti**: `src/server/sse.ts` hanya mengirim `data:` + heartbeat `: ping`; tidak ada `id:`,
`retry:`, atau dukungan `Last-Event-ID`. Klien yang reconnect kehilangan event di antaranya.

**Cara**: pakai `events.id` sebagai `id:`, kirim `retry: 3000`, dan saat request membawa
`Last-Event-ID` kirim event tertinggal dari tabel `events` (query `id > last`). Tambahkan backoff
eksponensial di sisi klien.

### REL-3 — Cache tools MCP

**Bukti**: `listMcpToolsHandler` memanggil `clearMcpToolsCache()` sebelum setiap discovery, dan
run chat melakukan discovery tools saat mulai. Server MCP stdio = spawn proses.

**Cara**: cache ber-TTL (mis. 60 s) + invalidasi hanya saat config berubah; reuse daftar tools
dalam satu run.

### REL-4 — Retry/backoff untuk integrasi

**Bukti**: `src/server/http.ts` menyediakan helper JSON/body; integrasi memakai `request()`
dengan timeout, tanpa retry terukur.

**Cara**: retry 2× dengan jitter untuk `GET`/idempoten pada 429/5xx, hormati `Retry-After`,
permukaan `lastError` di UI integrasi, dan hentikan retry bila kredensial 401/403.

### REL-5 — Log ke file + request id

**Bukti**: `src/core/logger.ts` menulis ke console; tidak ada rotasi atau korelasi request.

**Cara**: tulis ke `{appDataDir}/logs/app.log` dengan rotasi ukuran, tambahkan `requestId` +
durasi untuk route lambat (> 500 ms), dan tombol "Open log" di Global Settings.

### REL-6 — `/api/health` lebih informatif

**Cara**: tambahkan `version`, `db: ok`, `schemaVersion`, `uptime`, dan status scheduler cron
(tanpa membocorkan `dataDir` — lihat SEC-M3 di audit).

---

## 6. Keamanan & privasi

### SEC-1 — CSP & header keamanan belum ada

**Bukti**: `src/server/static.ts` hanya mengirim `content-type` + `cache-control`. Shell HTML
tidak punya CSP, `nosniff`, atau `referrer-policy`, padahal renderer memuat HTML dari integrasi
(Jira/Notion) setelah disanitasi.

**Cara**: di respons `/index.html` kirim
`content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' ws://127.0.0.1:*`,
plus `x-content-type-options: nosniff` dan `referrer-policy: no-referrer`. Uji manual: Monaco
worker, xterm, mermaid, dan WS terminal/LSP harus tetap jalan (tambahkan catatan di
`docs/ui.md`).

### SEC-2 — Kebijakan SSRF `baseUrl` (INT-M2 di audit, masih open)

**Bukti**: `AUDIT_CHECKLIST.md` §5 menandai INT-M2 belum selesai (sengaja, untuk Ollama/LAN).
**Cara**: allowlist privat yang eksplisit — blokir IP privat secara default, tampilkan konfirmasi
"ini alamat jaringan lokal" saat `baseUrl` privat dipakai, dan simpan pilihan itu di config.

### SEC-3 — Backup dengan `secrets=1`

**Bukti**: `src/server/routes/backup.ts` mengembalikan nilai rahasia apa adanya bila `?secrets=1`.
File hasil unduhan berisi API key plaintext.
**Cara**: (1) konfirmasi eksplisit di UI + catat `backup.exported { includeSecrets: true }` ke
audit (sudah ada), (2) opsi enkripsi passphrase (`enc:v1` dengan key turunan PBKDF2/scrypt) untuk
bundle, (3) hapus file di `{appDataDir}/backups` otomatis setelah N hari.

### SEC-4 — Permission task terlalu lebar

**Bukti**: `deno.json` → `dev`/`start`/`desktop` memakai `--allow-read --allow-write --allow-net --allow-env --allow-run --allow-ffi` tanpa batas path, dan `test` memakai `-A`.
**Cara**: untuk `test`, ganti `-A` dengan permission minimum + `RND_APP_DATA_DIR` sementara; untuk
`start`, batasi `--allow-read`/`--allow-write` ke `appDataDir` + workspace yang dipilih. Dokumentasikan
pengecualian yang memang perlu (`--allow-ffi` untuk PTY).

### SEC-5 — Regression test kebocoran secret

**Cara**: satu test yang memanggil serializer (`serializeLlm`, `serializeIntegration`,
`maskMcpServers`, `maskNotificationChannels`) dan gagal bila string `enc:v1:` atau pola key
(`sk-`, `xoxb-`) muncul di respons. Murah dan mencegah regresi besar.

---

## 7. Data & backup

### DATA-1 — Versi skema eksplisit

**Bukti**: migrasi memakai `ensureColumn` idempotent; tidak ada nomor versi yang bisa dibaca.
**Cara**: tambah `PRAGMA user_version` + daftar migrasi berurutan di `src/db/db.ts`; tolak start
bila DB lebih baru dari aplikasi (downgrade tidak didukung). Berguna juga untuk backup/restore
lintas versi.

### DATA-2 — Perawatan SQLite

**Cara**: `PRAGMA optimize` saat bootstrap, `PRAGMA wal_checkpoint(TRUNCATE)` saat idle,
`PRAGMA integrity_check` saat export backup, dan tombol `VACUUM` di Global Settings → Backup.

### DATA-3 — Backup terjadwal + rotasi

**Bukti**: fitur backup/restore sudah lengkap (`src/server/routes/backup.ts`,
`web/src/components/BackupSettings.tsx`) dan scheduler cron sudah ada, tetapi tidak terhubung.
**Cara**: step workflow `action: backup` (pakai `buildGlobalBackup`) atau schedule bawaan; simpan
N file terakhir; tampilkan ukuran + tanggal terakhir di UI.

### DATA-4 — Visibilitas ukuran & retensi

**Cara**: tampilkan ukuran `data.db`, jumlah `events`, `chat_messages`, `workflow_runs` di Global
Settings, plus pengaturan retensi (default: `events` 1000 baris seperti sekarang).

---

## 8. Testing & CI

### CI-1 — Unit test `web/` tidak dijalankan di CI

**Bukti**: `.github/workflows/ci.yml` menjalankan `deno test` + coverage, tetapi **tidak**
`npm --prefix web run test` — padahal `web/package.json` punya script `test` dan ada 11 file
`*.test.ts`. AGENTS.md juga tidak menyebut vitest di checklist.
**Cara**: tambahkan step `npm --prefix web run test` setelah typecheck client, dan update checklist
di `AGENTS.md` + `docs/getting-started.md`.

### CI-2 — Smoke test end-to-end

**Cara**: Playwright headless melawan `deno task start` dengan `RND_APP_DATA_DIR` sementara:
health → buat project → buat tiket lokal → edit file → Git status → buka dokumen lokal. Mock LLM
dengan server lokal kecil. Jalankan 1 shard di CI (nightly bila lambat).

### CI-3 — Coverage threshold + artefak

**Cara**: `deno coverage --detailed` di-upload sebagai artefak, dan tetapkan ambang minimum
(mis. 55% baris) supaya regresi terlihat; untuk `web/` pakai `vitest --coverage` dengan ambang
khusus `web/src/lib/**`.

### CI-4 — Cache, concurrency, dan rilis

**Cara**: cache `~/.cache/deno` + `~/.npm`; `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`;
workflow `release.yml` matrix macOS/Windows/Linux yang menjalankan `deno task desktop` dan
mengunggah artefak (catat kebutuhan codesign/notarization macOS di `docs/getting-started.md`).

### CI-5 — Lint/format untuk `web/`

**Bukti**: `deno lint` mengecualikan `web/**`, dan `web/` tidak punya ESLint/Prettier/Biome.
**Cara**: tambahkan Biome (`biome check`) untuk `web/src` — satu tool, cepat, tanpa konfigurasi
besar — dan jalankan di CI + pre-commit.

### CI-6 — Parity dokumentasi API

**Cara**: test yang mengekstrak path dari `docs/api.md` dan membandingkannya dengan tabel rute
program (`router.ts` + `routes/*`). Gagal bila ada rute baru tanpa dokumentasi. Ini menghentikan
drift yang sekarang terjadi (§11).

---

## 9. Developer experience

| ID | Item | Cara |
| --- | --- | --- |
| DX-1 | Satu perintah verifikasi | `deno task verify` = `build` → `check` → `lint` → `fmt --check` → `test` → `web typecheck` → `web test`; CI memanggil task yang sama |
| DX-2 | Data dev terisolasi | `deno task dev:reset` yang menghapus/mengganti `RND_APP_DATA_DIR` sementara berisi project contoh + provider mock |
| DX-3 | Provider LLM palsu | Mode `mock` di `llm_providers` untuk mengembangkan chat tanpa biaya/API key |
| DX-4 | Seed workspace | Script pembuat workspace contoh (beberapa file + git repo) untuk uji Explorer/Git/Terminal |

---

## 10. Produk & UX (ide lanjutan)

Item yang belum dikerjakan dari daftar lama (yang sudah selesai dihapus agar dokumen ini tidak
basi):

| ID | Ide | Mengapa | Effort |
| --- | --- | --- | --- |
| PROD-1 | PR flow | Branch → commit → push → buka PR dari Review/chat; Git CLI sudah lengkap | M |
| PROD-2 | Automation penuh | Auto-accept Review (opsional) + pindah tiket ke Test/Done setelah Build sukses | M |
| PROD-3 | Timeline aktivitas | Satu feed kronologis: sync tiket, run workflow, write chat, notifikasi (`events` sudah ada) | S |
| PROD-4 | Provider Linear | Melengkapi Jira + ClickUp (normalisasi status sudah terpusat di `src/tickets/status.ts`) | M |
| PROD-5 | Project templates | Project baru = workspace + integrasi + workflow starter + skills | M |
| PROD-6 | PRD → epic breakdown | Hierarki tiket + dependency graph, bukan list datar | L |
| PROD-7 | Sleep report | Ringkasan harian: tiket selesai, file berubah, workflow gagal, PR terbuka | S |
| PROD-8 | Release checklist agent | Changelog, version bump, tag, notifikasi channel | M |

---

## 11. Dokumentasi: drift yang perlu diperbaiki

Ditemukan saat menyusun dokumen ini; semuanya perbaikan kecil tapi menyesatkan pembaca.

| ID | File | Klaim sekarang | Kenyataan di kode | Fix |
| --- | --- | --- | --- | --- |
| DOC-1 | `docs/getting-started.md` | "token/API key disimpan plaintext di config" | Sudah terenkripsi `enc:v1:` AES-256-GCM (`src/secrets/`) | Ganti kalimat, tautkan `data-model.md` §Secrets at-rest |
| DOC-2 | `docs/getting-started.md` | `deno task desktop` → `./dist/RNDWorkflow.app` | `deno.json` mengeluarkan `./dist/Lullaby` | Perbaiki nama output |
| DOC-3 | `docs/api.md` | Documents remote: "Create (Docmost)", "Update (Docmost)" | Create/update juga untuk Notion & Confluence | Ubah keterangan |
| DOC-4 | `docs/api.md` | `local-documents/sync` → "Sync ke Docmost" | Mendukung `target` docmost/notion/confluence | Ubah + sebut body `target` |
| DOC-5 | `docs/api.md` | Settings table tidak memuat beberapa rute | Ada `/api/settings/prompts`, `/api/settings/lsp`, `/api/settings/lsp/probe`, `/api/settings/ui-preferences` (lihat `src/server/routes/settings.ts`) | Tambahkan baris |
| DOC-6 | `docs/data-model.md` | `app_settings` hanya 12 key | Kode juga memakai `chat_auto_approve_tools`, `chat_write_review_mode`, `lsp_settings`, `system_prompt`, `plan_prompt`, `ui_preferences`, `skills_defaults_installed` | Lengkapi tabel |
| DOC-7 | `docs/README.md` + `docs/features/` | Tidak ada halaman Backup | Fitur ada: `routes/backup.ts`, `BackupSettings.tsx`, `test/backup.test.ts` | Tambah `docs/features/backup.md` + baris TOC |
| DOC-8 | `AUDIT_CHECKLIST.md` | Angka LOC & "2 test files / 25 case" | Sudah usang (15 file test, router/chat sudah dipecah) | Tandai "snapshot historis" + tanggal re-audit |

Catatan: `IMPROVEMENTS.md` di root sebelumnya mencantumkan backup/export dan focus mode sebagai
ide, padahal keduanya sudah ada — isinya sudah dilebur ke dokumen ini.

---

## 12. Rencana eksekusi

| Sprint | Fokus | Item | Definition of done |
| --- | --- | --- | --- |
| 1 (½–1 hari) | Quick wins | PERF-1, PERF-6, CI-1, DOC-1…DOC-8 | Aset turun ≥ 1 MB, vitest jalan di CI, tidak ada drift di §11 |
| 2 (2–3 hari) | Ukuran distribusi | PERF-2, PERF-3, PERF-4, PERF-5 | `assets.generated.ts` ≤ 10 MB, chunk utama ≤ 700 KB, editor & mermaid tetap berfungsi |
| 3 (3–5 hari) | Struktur kode | ARCH-1, ARCH-2, ARCH-3, CI-5 | `router.ts` ≤ 300 LOC, `App.tsx` ≤ 400 LOC, Biome di CI |
| 4 (3–5 hari) | Keandalan & keamanan | REL-1, REL-2, SEC-1, SEC-5 | Review tetap bisa dilakukan setelah restart, CSP aktif, test kebocoran secret hijau |
| 5 (berkelanjutan) | Kualitas & produk | CI-2, CI-4, DATA-1…DATA-3, PROD-1…PROD-3 | Smoke e2e nightly, rilis otomatis, backup terjadwal |

Setiap item sebaiknya ditutup dengan bukti: angka sebelum/sesudah untuk PERF-*, screenshot/log
untuk REL-*, dan test baru untuk CI-*/SEC-*.

---

## 13. Referensi

- Perilaku terkini (sumber kebenaran): [`AGENTS.md`](../AGENTS.md)
- Audit keamanan/tooling sebelumnya: [`AUDIT_CHECKLIST.md`](../AUDIT_CHECKLIST.md)
- Ruang lingkup v1: [`overview.md`](overview.md)
- Data & path aplikasi: [`data-model.md`](data-model.md) · [`api.md`](api.md)
- Fitur: [`features/`](features/)
