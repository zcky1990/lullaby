# Audit & Rencana Perbaikan

Tanggal: 2026-10-16 · Lingkup: seluruh repo (`src/` backend Deno, `web/` React, tooling, docs).

## Status implementasi (2026-10-16)

**Selesai:** A1, A2, A3, A5, B1, B3, B4, B5, B6, B8, C1, C2, C3, C4, D1, D2, D3, D4, D6,
F1, F2, serta pembersihan D5 (modul `src/secrets` dihapus).

- **Fase 0** — `web/components.json` ditambah; script `typecheck` di `web/package.json`;
  `src/secrets` dihapus; conditional `&&` → ternary.
- **Fase 1** — task `check` = `deno check --desktop main.ts`; `window.ts` pakai tipe
  `Deno.BrowserWindow` asli (tanpa cast) + guard runtime untuk `deno run`; handler `bind` async.
- **Fase 2** — token semantik `--success`/`--info`; warna mentah dihapus; `space-y-*` → `flex flex-col gap-*`;
  `SelectGroup`/`DropdownMenuGroup`; ikon pakai `data-icon`; `Separator`/`Empty`/`Skeleton`/`Spinner`/
  `ToggleGroup` (via `npx shadcn add`) dipakai.
- **Fase 3** — Monaco jadi **lazy chunk** (`MonacoViewer`; main 4.5 MB → 522 KB); kolom Kanban
  di-derive (bukan effect) + `key` reset; localStorage ber-versi (`:v1`).
- **Fase 4** — token sesi per-proses (cookie/`x-app-token`) untuk `/api/*` (kecuali `/api/health`);
  `baseUrl` dibatasi http(s); prune `events` (1000); batas body 1 MB; batas klien SSE (20).
- **Fase 5** — GitHub Actions CI + test integrasi mock Docmost/Jira (`test/integrations.test.ts`).

**Ditunda (sengaja):** B7 (`Field`/`InputGroup` — migrasi form besar; UI saat ini tetap valid),
B2 sebagian (ikon dalam raw `<button>`, bukan komponen shadcn, tetap `size-*`), E1 ikon app,
E2 `codesignIdentity`, E3 `release.baseUrl` (butuh aset/keputusan distribusi).

**Metode:** diaudit terhadap skill di `.agents/skills`:
`deno-desktop`, `shadcn` (+ `rules/styling|composition|icons|forms`),
`tailwind-v4-shadcn` (+ `references/common-gotchas`), dan `vercel-react-best-practices`.

**Ringkasan temuan:** 4 Critical · 6 High · 10 Medium · 6 Low.

---

## A. Tooling & Type-safety

| # | Sev | Temuan | Bukti |
| --- | --- | --- | --- |
| A1 | **High** | `deno check` biasa **tidak** memuat tipe desktop; kita menutupinya dengan cast di `window.ts`. Skill `deno-desktop` mewajibkan `deno check --desktop main.ts`. | `src/desktop/window.ts` (cast `Deno.BrowserWindow`), task `check` = `deno check main.ts` |
| A2 | Medium | Di bawah `--desktop`, handler `bind` harus `Promise`-return; handler `appInfo` masih sinkron → akan gagal type-check bila A1 dibereskan. | `window.ts`: `win.bind("appInfo", () => ({...}))` |
| A3 | Medium | `web/components.json` **tidak ada** → CLI shadcn (`npx shadcn@latest add/docs/info`) tak jalan; skill shadcn mengandalkan file ini. | `ls web/components.json` → not found |
| A4 | Low | Root `deno fmt`/`lint` sempat menyapu `.agents/` & `web/dist`; sudah diperbaiki tapi rapuh. | `deno.json` `fmt.include`/`lint.exclude` |
| A5 | Low | `web/package.json` tak punya script `typecheck`/`lint`. | `web/package.json` |

## B. shadcn/ui & Tailwind v4 (skill: `shadcn/rules/*`, `tailwind-v4-shadcn`)

| # | Sev | Temuan | Bukti |
| --- | --- | --- | --- |
| B1 | **High** | **Warna mentah** untuk status: `text-emerald-500`, `bg-emerald-600`, `text-sky-400`. Harus pakai token semantik/varian `Badge`. | `ui/badge.tsx:15`, `IntegrationForm.tsx:150`, `LlmProviderForm.tsx:133`, `FileTreePanel.tsx:101-106`, `DocumentPanel.tsx:150-155` |
| B2 | Medium | Ikon dalam `Button`/menu memakai `size-4`/`size-5` dan **tanpa `data-icon`**. Skill: pakai `data-icon="inline-start|end"`, jangan set ukuran. | `ActivityBar.tsx:62`, `SettingsView.tsx:139,192,297`, `DocumentPanel.tsx:43`, dll (tidak ada `data-icon`) |
| B3 | Medium | `space-y-*` dipakai (~13 tempat). Skill: ganti `flex flex-col gap-*`. | `App.tsx:424,485,531`, `SettingsView.tsx:106,123,131,186,204,216,267`, `IntegrationForm.tsx:73`, `LlmProviderForm.tsx:86`, `GlobalSettingsView.tsx:30,44`, `WorkspacePanel.tsx:44`, `TicketDetailDialog.tsx:54,72` |
| B4 | Medium | `SelectItem` **tanpa** `SelectGroup`; `DropdownMenuItem` tanpa `DropdownMenuGroup` (skill: item selalu dalam group). | `IntegrationForm.tsx`, `LlmProviderForm.tsx`, `App.tsx`; `SettingsView.tsx` (dropdown) |
| B5 | Medium | Komponen shadcn standar belum dipakai untuk pola umum: **`Separator`** (kita pakai `border-b`/`border-t`), **`Empty`** (kita tulis `Empty()` manual), **`Skeleton`/`Spinner`** (kita pakai teks "Memuat…"). | `SettingsView.tsx` section divider; `App.tsx` `Empty()`; `*View*` loading |
| B6 | Medium | Pemilih 2–7 opsi (tema app & editor) memakai tombol + state aktif manual; skill: **`ToggleGroup`**. | `GlobalSettingsView.tsx` `OptionTile` |
| B7 | Low | Form memakai `div grid gap` + `Label`; skill merekomendasikan **`FieldGroup`+`Field`** (+ `InputGroup` untuk input+tombol). | `IntegrationForm.tsx`, `LlmProviderForm.tsx`, `SettingsView.tsx` (workspace) |
| B8 | Low | Varian `Badge` kustom `success` (warna mentah) — sebaiknya token semantik/varian resmi. | `ui/badge.tsx` |

**Sudah sesuai (tidak perlu diubah):** satu blok `@layer base`, ada `@theme inline`, token oklch
(shadcn modern), `cn()` dipakai, `Dialog` punya `DialogTitle`, alias `@/`, `vite.config` pakai
`@tailwindcss/vite` + `tailwind.config` kosong (tidak ada `tailwind.config.ts`).
Catatan: skill `tailwind-v4-shadcn` menyebut `tw-animate-css` "tidak ada" dan memakai `hsl()` —
itu **outdated**; build kita (oklch + `tw-animate-css`) berhasil, jadi dipertahankan.

## C. React / performa (skill: `vercel-react-best-practices`)

| # | Sev | Temuan | Bukti |
| --- | --- | --- | --- |
| C1 | **Critical** | **Monaco di-import statis** di `App.tsx` → masuk chunk utama (~4.5 MB). Skill: dynamic import komponen berat. | `App.tsx`: `import Editor from "@monaco-editor/react"` |
| C2 | Medium | **Derived state via effect**: `TicketKanban` menyimpan `columns` di state lalu rebuild lewat `useEffect([tickets])`. Skill: derive saat render / reset via `key`. | `TicketKanban.tsx:71` |
| C3 | Low | `{cond && <X/>}` untuk kondisi non-boolean; skill menyarankan ternary eksplisit. | `IntegrationForm.tsx`, `LlmProviderForm.tsx` (`saved &&`, `result &&`) |
| C4 | Low | localStorage tanpa versioning (`rnd.theme`, `rnd.editorTheme`). | `ThemeProvider.tsx` |
| C5 | Low | Barrel import `lucide-react` (banyak ikon). Vite umumnya OK; pertimbangkan `optimizeDeps`. | banyak file |

## D. Keamanan & ketahanan (backend)

| # | Sev | Temuan | Bukti |
| --- | --- | --- | --- |
| D1 | **High** | API loopback **tanpa token/origin guard** → proses/halaman lokal mana pun bisa memanggil (baca/menulis integrasi, memicu transition, membaca isi workspace). | `src/server/router.ts` (semua route `handleRequest`) |
| D2 | **High** | **SSRF**: `baseUrl`/`mcpUrl` bebas (docmost/jira/github/llm) tanpa allowlist host. | `src/config/schema.ts` (`z.string().url()`), `integrations/*` |
| D3 | Medium | Tabel `events` **tumbuh tanpa batas** (tak ada prune). | `src/db/db.ts` `appendEvent` |
| D4 | Medium | Tak ada batas ukuran body JSON (`req.json()`). | `router.ts` `readJson` |
| D5 | Low | Modul `src/secrets/store.ts` **dead code** (hanya dipakai test). | `grep resolveSecret` |
| D6 | Low | SSE tanpa batas jumlah klien/heartbeat; tak ada backpressure. | `src/server/sse.ts` |

## E. Deno Desktop / packaging (skill: `deno-desktop`)

| # | Sev | Temuan |
| --- | --- | --- |
| E1 | Medium | `desktop.app.icons` belum diisi → ikon default Deno. |
| E2 | Low | `macos.codesignIdentity` belum diisi (ad-hoc; belum distributable). |
| E3 | Low | `release.baseUrl` (auto-update) belum diisi. |
| E4 | Low | Backend `webview` default: **tanpa DevTools** (butuh `cef`). Sadari saat debug. |

## F. Proses / dokumentasi

| # | Sev | Temuan |
| --- | --- | --- |
| F1 | Low | Belum ada CI; gate `build → check → lint → test → web tsc` dijalankan manual. |
| F2 | Low | Test hanya unit config/secret; belum ada test integrasi (mock Docmost/Jira) yang dipakai manual. |

---

# Rencana Perbaikan

Urut prioritas. Setiap langkah: perubahan → verifikasi.

## Fase 0 — Quick wins (Low risk, cepat)
1. **A3** tambah `web/components.json` (`style/new-york`, `tailwind.config=""`, aliases, base radix) agar CLI shadcn aktif.
2. **A5** tambah script `typecheck` + `lint` di `web/package.json`.
3. **D5** hapus `src/secrets/` (atau tandai jelas) + bersihkan test terkait.
4. **C3** ganti `{c && <X/>}` → ternary pada IntegrationForm/LlmProviderForm.
5. **E1** tambah `desktop.app.icons` (siapkan `icons/`).

Verifikasi: `deno task build && deno check main.ts && deno lint && deno test -A && (cd web && npx tsc --noEmit)`.

## Fase 1 — Type-safety desktop (A1, A2)
1. Task `check` → `deno check --desktop main.ts`.
2. Hapus cast di `src/desktop/window.ts`; pakai tipe `Deno.BrowserWindow` asli.
3. Jadikan handler `appInfo` `async`; sesuaikan signature `bind` (`(...args) => Promise<unknown>`).
4. Update `AGENTS.md` (perintah check).
Verifikasi: `deno check --desktop main.ts` hijau; `deno desktop --hmr` tetap jalan.

## Fase 2 — Kepatuhan shadcn/Tailwind (B1–B8)
1. **B1/B8**: tambah token semantik `--success` (+ `--success-foreground`) di `web/src/index.css`
   `:root`/`.dark` + `@theme inline`; pakai `Badge variant="success"` berbasis token; ganti
   `text-emerald-500`/`text-sky-400` → `text-success`/token baru (mis. `--info`).
2. **B5**: `npx shadcn@latest add separator empty skeleton spinner toggle-group field input-group` lalu:
   - ganti `border-t/border-b` separator → `<Separator/>`;
   - ganti `Empty()` manual → `<Empty/>`;
   - ganti teks "Memuat…" → `<Skeleton/>`/`<Spinner/>`.
3. **B6**: ganti `OptionTile` → `ToggleGroup` + `ToggleGroupItem`.
4. **B7**: form pakai `FieldGroup`/`Field`/`FieldLabel`; input+tombol pakai `InputGroup`.
5. **B3**: semua `space-y-*` → `flex flex-col gap-*`.
6. **B4**: bungkus `SelectItem`→`SelectGroup`; `DropdownMenuItem`→`DropdownMenuGroup`.
7. **B2**: ikon dalam `Button`/menu → `data-icon`; hapus `size-*` ikon.
Verifikasi: `web tsc`; tinjau visual (light/dark); `deno task build`.

## Fase 3 — Performa React (C1, C2, C4)
1. **C1**: lazy-load editor — `const Editor = lazy(() => import("@monaco-editor/react"))` di
   `FileView` dibungkus `<Suspense fallback={<Skeleton/>}>`; pindahkan setup worker ke modul yang
   di-import saat lazy (atau tetap di `main.tsx`).
2. **C2**: `TicketKanban` derive kolom saat render (`useMemo`) + reset via `key={projectId}` di
   parent, bukan `useEffect` state.
3. **C4**: keys localStorage ber-versi (`rnd.theme:v1`).
Verifikasi: ukur chunk (`vite build`), pastikan Monaco terpisah; perilaku UI sama.

## Fase 4 — Keamanan (D1, D2, D3, D4, D6)
1. **D1**: token sesi acak di `bootstrap`; sisipkan ke `index.html` (mis. `<meta>` atau cookie) dan
   wajibkan header/cookie pada semua `/api/*` (kecuali `/api/health`); renderer memakainya otomatis.
2. **D2**: validasi `baseUrl` terhadap allowlist skema+host (blokir `localhost`/IP privat kecuali
   diizinkan), atau konfirmasi eksplisit saat simpan.
3. **D3**: prune `events` (mis. simpan 1000 terakhir / hapus > 30 hari) saat bootstrap.
4. **D4**: batas ukuran body (mis. 1 MB) di `readJson`.
5. **D6**: batasi jumlah klien SSE + tutup yang idle.
Verifikasi: test manual (curl tanpa token → 401/403); `deno test`.

## Fase 5 — Packaging & CI (E2–E4, F1, F2)
1. **E2/E3**: siapkan `codesignIdentity` + `release.baseUrl` (placeholder sampai siap rilis).
2. **E4**: dokumentasikan pemakaian `--backend cef` untuk DevTools.
3. **F1**: GitHub Actions: `deno task build`, `deno check --desktop`, `deno lint`, `deno fmt --check`,
   `deno test -A`, `cd web && npx tsc --noEmit`.
4. **F2**: jadikan mock Docmost/Jira (yang sudah dipakai manual) sebagai test integrasi di
   `test/integrations.test.ts`.

---

## Urutan eksekusi yang disarankan

`Fase 0 → Fase 1 → Fase 2 → Fase 3 → Fase 4 → Fase 5`

Fase 0–1 cepat & berisiko rendah (tooling & tipe). Fase 2–3 menyentuh UI/perf. Fase 4 menyentuh
keamanan (butuh keputusan produk soal token/sesi). Fase 5 opsional untuk distribusi.

## Definition of Done (per fase)

- `deno task build` · `deno check --desktop main.ts` · `deno lint` · `deno fmt --check` ·
  `deno test -A` · `(cd web && npx tsc --noEmit)` — semua hijau.
- Tidak ada regresi fitur (Workspace/Explorer/Document/Ticket/Settings, tema, drag-transition).
- Dokumen (`README.md`, `AGENTS.md`, `feature/*`) disinkronkan bila perilaku berubah.
