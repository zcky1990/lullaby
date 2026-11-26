# Checklist Performa & Best Practices

Dokumen kerja untuk memperbaiki **performa** dan **best practices** Lullaby. Isinya temuan yang
diverifikasi langsung di repo (ukuran file, pola kode, isi CI), bukan daftar keinginan.

Berbeda dari [`improvements.md`](improvements.md):

- Dokumen ini **hanya berisi item yang masih terbuka**, plus tabel item yang sudah selesai supaya
  tidak dikerjakan dua kali.
- Setiap item punya **bukti**, **cara perbaikan**, dan **kriteria selesai** yang bisa diukur.
- Format checklist (`- [ ]`) — centang saat sudah diverifikasi, bukan saat kode ditulis.

Cara pakai: kerjakan per seksi (A → E), centang item, dan tempel angka sebelum/sesudah ke kolom
bukti. Aturan verifikasi repo tetap berlaku: `deno task build` → `deno task check` →
`npm --prefix web run typecheck` → `deno task lint` → `deno task test` → `npm --prefix web run test`.

Skala:

| Label | Arti |
| --- | --- |
| **P0** | Terasa langsung oleh pengguna (startup, mengetik, buka editor, streaming chat) |
| **P1** | Beban perawatan/CI; mencegah regresi |
| **P2** | Polish / defense-in-depth |
| Effort | `S` < ½ hari · `M` 1–2 hari · `L` > 2 hari |

---

## 1. Baseline terukur

Diambil dari checkout ini (`web/dist` hasil build terakhir, `ls -S web/dist/assets | head`,
`ls -l` untuk sumber). Ukur ulang sebelum/sesudah setiap perubahan.

| Metrik | Nilai sekarang | Target | Catatan |
| --- | --- | --- | --- |
| `src/ui/assets.generated.ts` | **7.414.781 B** (±7,1 MiB) | ≤ 5 MiB | turun dari 24 MB setelah gzip + favicon WebP |
| Chunk utama `index-*.js` | **817.165 B** | ≤ 600 KB | semua panel non-lazy ikut di sini |
| `MonacoViewer-*.js` | **3.717.363 B** | ≤ 2,5 MB | chunk terbesar yang di-parse saat buka file |
| `MonacoViewer-*.css` | 169.546 B | — | ikut terunduh bersama editor |
| `ts.worker-*.js` | **7.046.033 B** | jangan di-ship / opt-in jelas | lazy, tapi tetap masuk binary |
| `css.worker` / `html.worker` / `json.worker` | 1.056.201 / 718.831 / 409.063 B | — | lazy per bahasa |
| `mermaid.core-*.js` | 617.449 B | — | lazy (PERF-4 selesai) |
| Renderer diagram `elk` / `cytoscape` / `katex` | 1.479.085 / 443.963 / 261.763 B | — | hanya di-fetch bila tipe dipakai |
| `MarkdownView-*.js` | 159.668 B | — | |
| `TerminalSession-*.js` | 372.503 B | — | lazy (PERF-7) |
| `WorkflowTab-*.js` | 172.787 B | — | lazy |
| CSS utama `index-*.css` | 93.190 B | — | |
| `web/public/lullaby.webp` | 72.300 B | ≤ 100 KB | PERF-1 selesai (PNG 1,5 MB sudah hilang) |
| `src/server/router.ts` | **80.584 B** | ≤ 30 KB | masih monolit |
| `web/src/App.tsx` | **70.818 B** | ≤ 40 KB | state hub |
| `web/src/components/ChatSidebar.tsx` | **60.360 B** | ≤ 30 KB | hot path streaming |
| `web/src/lib/api.ts` | **37.600 B** | — | satu `request()`, tipe manual |
| `web/src/components/GitTab.tsx` | 31.209 B | — | **statis** di chunk utama |
| `web/src/components/FileTreePanel.tsx` | 30.387 B | — | render rekursif tanpa memo |
| Test frontend | 18 file `web/src/**/*.test.ts` | dijalankan CI | CI belum memanggil vitest |

Jumlah file di `web/dist/assets` ± 130 (JS/CSS/font). Cara ukur cepat:

```bash
ls -S web/dist/assets | head -20        # 20 file terbesar
ls -l src/ui/assets.generated.ts        # ukuran binary-embedded UI
ls -l web/src/App.tsx web/src/components/ChatSidebar.tsx src/server/router.ts
```

---

## 2. Yang sudah selesai (jangan dikerjakan ulang)

`improvements.md` masih menandai item-item ini `Open`. Verifikasi di repo menunjukkan sudah
dikerjakan — perbarui statusnya di sana (lihat **E9**).

| ID lama | Item | Bukti selesai |
| --- | --- | --- |
| PERF-1 | Favicon 1,5 MB → WebP | `web/public/lullaby.webp` (72 KB), `web/index.html` memakai `type="image/webp"`, PNG sudah tidak ada |
| PERF-2 | Tree-shake bahasa Monaco | `web/src/lib/monaco.ts` mengimpor `monaco-editor/editor/editor.api` + daftar bahasa eksplisit di `web/src/lib/monaco-languages.ts`; guard `monaco-languages.test.ts` |
| PERF-3 | Worker editor lazy | `WORKER_LOADERS` memakai `import()` per jenis + memoize; `ts.worker` hanya bila `isMonacoTypeScriptServiceEnabled()`; guard `monaco-workers.test.ts` |
| PERF-4 | Mermaid hanya saat ada diagram | `MarkdownView` lazy + `Suspense`; `mermaid-render.ts` satu-satunya importer dinamis; cache SVG `mermaid-svg-cache.ts`; guard `mermaid-lazy.test.ts` |
| PERF-5 | Kompresi aset embedded | `scripts/build-assets.ts` gzip + base64 bila mengecil (`MIN_COMPRESSION_RATIO`), hasil 7,4 MB |
| PERF-6 | Cache header + memoize decode | `src/server/static.ts`: `decodedCache`/`inflatedCache`, `immutable` untuk `/assets/*` ber-hash, ETag + `304`, `vary: accept-encoding` |
| PERF-7 | Lazy panel berat | Lazy boundary di modul pemilik (`TerminalPanel`→`TerminalSession`, `TicketKanban`→board, section Global Settings, `BackupSettings`/`IntegrationForm`); guard `heavy-panels-lazy.test.ts` |
| REL-1 | Persist chat run + `pendingChanges` | tabel `chat_runs`, `upsertChatRun`, `findLatestPendingChatRun`, `rehydrateChatRuns()` di `bootstrap()`; sisa pekerjaan = verifikasi UI Review setelah restart |
| DB-M1/M2 | Index + transaksi | `db.ts` membuat 13 index dan memakai `withTransaction` untuk multi-step write |

Pola yang sudah benar dan harus dipertahankan (jangan "diperbaiki"):

- `web/src/lib/api.ts` — satu helper `request()` dengan timeout + `ApiError`; `chatStream` memakai
  `AbortSignal`, bukan `EventSource`.
- `loadGit`/`loadWorkflows` memakai `Promise.all` (tidak ada waterfall).
- `ChatSidebar`/`App` memakai ref untuk handler agar listener tidak perlu re-subscribe
  (`advanced-event-handler-refs`).
- `web/src/lib/i18n/I18nProvider.tsx` — contoh benar: `t` di-`useMemo` dan context value di-`useMemo`.
- Backend: secret terenkripsi + dimask, path guard di `src/fs/workspace.ts`, input Zod.

---

## 3. Seksi A — Bundle & waktu buka (P0)

### A1. Pangkas `MonacoViewer` 3,7 MB: audit fitur yang benar-benar dipakai

- [ ] **A1** Kurangi registrasi `features/*/register` di `web/src/lib/monaco.ts` (**M**)
  - **Bukti**: `monaco.ts` mendaftarkan ±45 modul fitur. Chunk `MonacoViewer-*.js` = 3.717.363 B
    dan `MonacoViewer-*.css` = 169.546 B, di-parse setiap kali tab file dibuka.
  - **Cara**: buat daftar fitur yang dipakai produk ini (find, suggest, hover, format, folding,
    bracketMatching, multicursor, clipboard, comment, contextmenu, gotoError, gotoSymbol,
    referenceSearch, rename, snippet, wordHighlighter, indentation, linesOperations,
    wordOperations, readOnlyMessage). Kandidat dibuang (ukur satu per satu, bukan sekaligus):
    `codelens`, `inlayHints`, `colorPicker`, `linkedEditing`, `stickyScroll`, `smartSelect`,
    `semanticTokens` (bila LSP tidak mengirim semantic tokens), `unicodeHighlighter`,
    `unusualLineTerminators`, `dropOrPasteInto`.
  - **Jangan** membuang: `codicon`, `codeEditor`, `find`, `suggest`, `hover`, `format`,
    `folding`, `multicursor`, `comment`, `clipboard`, `bracketMatching`, `cursorUndo`,
    `linesOperations`, `wordOperations`. LSP bergantung pada `codeAction`, `documentSymbols`,
    `rename`, `referenceSearch`, `semanticTokens`, `parameterHints`, `signatureHelp`-related.
  - **Kriteria selesai**: `ls -l web/dist/assets/MonacoViewer-*.js` turun ≥ 25%; manual: buka file
    `.ts`/`.json`/`.md`, cek find, suggest, hover, format, folding, LSP code action, rename,
    multi-cursor tetap jalan; `monaco-workers.test.ts` + `monaco-languages.test.ts` hijau.
  - **Catatan**: bila pemangkasan tidak cukup, alternatifnya pisahkan fitur ke chunk terpisah lewat
    `build.rollupOptions.output.manualChunks` — tapi Monaco tidak mendukung registrasi lazy per
    fitur dengan bersih, jadi ukur dulu sebelum memilih.

- [ ] **A2** Putuskan nasib `ts.worker` (7 MB) secara eksplisit (**S**)
  - **Bukti**: `web/dist/assets/ts.worker-*.js` = 7.046.033 B dan tetap ikut ter-embed ke
    `assets.generated.ts` walau layanan TypeScript dimatikan (baru *tidak di-fetch* saat runtime).
  - **Cara**: (1) pastikan default Global Settings → Editor untuk layanan TypeScript adalah
    **off** dan jelaskan konsekuensinya di `docs/features/settings.md`; (2) dokumentasikan bahwa
    IntelliSense TS tetap tersedia lewat LSP (`typescript-language-server`); (3) bila worker tetap
    dipertahankan, tambahkan catatan di `docs/ui.md` bahwa +7 MB binary adalah biaya opt-in.
  - **Kriteria selesai**: keputusan tertulis (pertahankan / hapus) + satu kalimat di docs + test
    `monaco-workers.test.ts` masih memverifikasi gating `isMonacoTypeScriptServiceEnabled()`.

- [ ] **A3** Audit renderer Mermaid yang tidak pernah dipakai (**S**)
  - **Bukti**: di `web/dist/assets` ada `elk-*.js` 1.479.085 B, `cynefin-*.js` 657.624 B,
    `cytoscape.esm-*.js` 443.963 B, `katex-*.js` 261.763 B. Semuanya hanya di-fetch bila diagram
    bertipe itu muncul — tapi tetap menambah ukuran binary.
  - **Cara**: catat tipe diagram yang benar-benar ada di dokumen repo + template
    (`grep -rn "```mermaid" -A2 web/src/docs src/fs docs | sort -u`). Bila hanya `flowchart`, jangan
    ubah kode (v12 tidak punya API unregister) tetapi catat di dokumen ini sebagai **diterima**,
    atau ganti diagram statis bawaan dengan SVG hasil render.
  - **Kriteria selesai**: daftar tipe diagram terdokumentasi; keputusan "terima" atau "ganti SVG"
    tertulis.

- [ ] **A4** Lazy per menu untuk panel yang sekarang statis (**S–M**)
  - **Bukti**: `web/src/App.tsx` mengimpor statis `GitTab` (31.209 B, tidak ada chunk `GitTab-*` di
    `web/dist/assets`), `FileTreePanel` (30.387 B), `DocumentPanel`, `GitPanel`, `TicketPanel`,
    `ChatSidebar` (60.360 B), `GlobalSettingsView`, `SettingsView`, `TicketDetailDialog`,
    `TicketCreateDialog`, `AddToChatDialog`, `QuickOpen`, `TerminalPanel`.
  - **Cara**: `const GitTab = lazy(() => import("@/components/GitTab").then(m => ({ default: m.GitTab })))`
    dengan `Suspense` + `Skeleton`; ulangi untuk panel yang hanya muncul pada satu menu
    (`GitTab`, `DocumentPanel`, `FileTreePanel`). `ChatSidebar` jangan di-lazy (dipakai terus) tapi
    lihat **B1**.
  - **Kriteria selesai**: `GitTab-*.js` muncul sebagai chunk sendiri; chunk utama turun; guard test
    di `heavy-panels-lazy.test.ts` diperluas agar `GitTab` tidak kembali statis.

- [ ] **A5** Pecah vendor chunk agar parse lebih murah (**M**)
  - **Bukti**: tidak ada `build.rollupOptions.output.manualChunks` di `web/vite.config.ts`; chunk
    utama 817.165 B memuat React + Radix + lucide + xyflow-adjacent + seluruh shell.
  - **Cara**: `manualChunks` per grup stabil: `react`, `radix` (`@radix-ui/*`, `radix-ui`,
    `@base-ui/react`), `icons` (`lucide-react`), `xyflow` (`@xyflow/react`). Kelompokkan berdasarkan
    paket, **jangan** berdasarkan path file aplikasi (hindari chunk yang berubah tiap commit karena
    cache jadi tidak berguna).
  - **Kriteria selesai**: minimal 3 chunk vendor; urutan load tetap benar; tidak ada warning
    `Circular dependency` baru; aplikasi start normal.

- [ ] **A6** Guard ukuran bundle di CI (**S**)
  - **Bukti**: `scripts/build-assets.ts` sudah punya guard aset biner > 500 KB, tapi tidak ada guard
    untuk ukuran chunk JS.
  - **Cara**: tambahkan script kecil (`scripts/check-bundle-size.ts`) yang gagal bila
    `web/dist/assets/index-*.js` > 900 KB, `MonacoViewer-*.js` > 4 MB, atau
    `src/ui/assets.generated.ts` > 8 MB; panggil dari `deno task build`.
  - **Kriteria selesai**: guard berjalan di `deno task build` dan mencetak angka aktual + ambang.

---

## 4. Seksi B — Render & interaksi (P0/P1)

### B1. `ChatSidebar` 60 KB: streaming chat masih me-render seluruh transkrip

- [ ] **B1.1** Ekstrak daftar pesan menjadi komponen `memo` (**M**)
  - **Bukti**: `web/src/components/ChatSidebar.tsx` (60.360 B) berisi ±22 `useState` dan merender
    `entries.map(...)` inline di JSX induk. Setiap perubahan state (ketikan composer, `steps`,
    `sending`, `width`, `dragging`, `skillQuery`, …) me-render ulang **semua** pesan, dan tiap pesan
    assistant menjalankan `MarkdownView` (chunk 159 KB) lagi.
  - **Cara**: `ChatMessageItem = memo(...)` (props primitif: `id`, `role`, `content`, `changes`,
    `fontFamily`, `fontSize`) + `ChatMessageList`. Handler per pesan (`openChangedFile`) sudah
    stabil (`useCallback`), jadi cukup dioper lewat props.
  - **Kriteria selesai**: React DevTools Profiler: mengetik di composer **tidak** me-render ulang
    item pesan (commit hanya pada subtree composer); guard test baru yang memastikan
    `ChatSidebar` tidak lagi memanggil `<MarkdownView>` di dalam `.map()` induk.

- [ ] **B1.2** Streaming step tidak boleh memicu re-render + scroll per event (**M**)
  - **Bukti**: `mergeStep` membuat array `steps` baru setiap event `chat.step`; efek
    `scrollRef.current?.scrollTo({ top: scrollHeight })` bergantung pada `[entries, sending,
    pending, steps]` sehingga berjalan setiap step/token.
  - **Cara**: (1) throttle `mergeStep` dengan `requestAnimationFrame` atau buffer di ref lalu flush
    per frame; (2) untuk token asisten, tulis ke buffer ref + `startTransition` saat commit;
    (3) scroll hanya saat jumlah pesan berubah atau saat user berada di bawah (jangan paksa scroll
    bila user scroll ke atas).
  - **Kriteria selesai**: dengan response panjang, tidak ada lebih dari 1 commit/frame; scroll
    tidak "melawan" saat user membaca history.

- [ ] **B1.3** Virtualisasi / `content-visibility` untuk sesi panjang (**M**)
  - **Bukti**: tidak ada virtualization di `ChatSidebar`, `FileTreePanel`, `GitTab` (history),
    `ActivityFeed`; `grep -rn "content-visibility" web/src` tidak menemukan apa pun.
  - **Cara**: mulai murah — beri `content-visibility: auto` + `contain-intrinsic-size` pada item
    pesan dan baris tree; bila sesi > 200 pesan, pakai windowing (mis. `@tanstack/react-virtual`).
  - **Kriteria selesai**: sesi 300 pesan tetap responsif saat scroll; ukur dengan profiler
    (long task < 50 ms).

- [ ] **B1.4** Pecah file menjadi hook + komponen (**M**, bagian dari ARCH-3)
  - **Cara**: `useChatSessions` (list/create/select/delete), `useChatStream` (send/stop/steps/
    abort), `useChatAttachments` (drag/drop/paste/limit), `useChatComposer` (input/skill menu).
    `ChatSidebar` tinggal komposisi.
  - **Kriteria selesai**: `ChatSidebar.tsx` ≤ 30 KB; hook punya unit test (`web/src/lib/*.test.ts`
    pola yang sudah ada).

### B2. Satu koneksi event, bukan dua

- [ ] **B2** Satukan `EventSource("/api/events")` (**S**)
  - **Bukti**: dua `new EventSource("/api/events")` terpisah — `web/src/App.tsx` (feed activity) dan
    `web/src/components/ChatSidebar.tsx` (event `chat.step`). Setiap koneksi mem-parse **semua**
    event; server membatasi 20 klien (`MAX_SSE_CLIENTS` di `src/server/sse.ts`).
  - **Cara**: buat `web/src/lib/events-provider.tsx` (satu `EventSource`, dispatch via
    `CustomEvent`/listener registry, reconnect dengan backoff), pasang di `main.tsx`. Hentikan
    langganan saat `document.hidden` atau saat chat tertutup (`hidden` prop).
  - **Kriteria selesai**: DevTools Network hanya 1 request `events`; tidak ada duplikasi parse;
    reconnect otomatis setelah server restart.

### B3. Listener keyboard global di `App.tsx`

- [ ] **B3** Gabungkan listener `keydown` di `App.tsx` menjadi satu (**S**)
  - **Bukti**: `App.tsx` memasang **5** `window.addEventListener("keydown", …, { capture: true })`
    terpisah (Cmd/Ctrl+Shift+V preview, Cmd/Ctrl+F find, Cmd/Ctrl+P + Cmd/Ctrl+Shift+F menu,
    Cmd/Ctrl+Shift+L add-to-chat, Cmd/Ctrl+S simpan) — ditambah 1 di `FileTreePanel.tsx` dan 2
    shortcut di `main.tsx` (`installZoomShortcuts`, `installLayoutShortcut`). Beberapa bergantung
    pada `[tabs, activeTabId]`; `patchTab` membuat array `tabs` baru pada **setiap ketikan** di
    editor → listener di-`remove`/`add` ulang per karakter.
  - **Cara**: satu handler dengan `Map<string, () => void>` shortcut (atau `switch`), dan baca
    state lewat ref (`tabsRef` sudah ada di `useEditorTabs`) supaya efek berjalan sekali
    (`[]`). Pindahkan aksi tab-specific ke `useEditorTabs`/`useHotkeys` hook.
  - **Kriteria selesai**: hanya satu registrasi listener di `App.tsx`; mengetik di `MonacoViewer`
    tidak memicu `removeEventListener` (verifikasi dengan breakpoint/`Performance` → Event
    Listeners).

### B4. `ThemeProvider` me-render ulang semua konsumen

- [ ] **B4** `useMemo` untuk context value + setter stabil (**S**)
  - **Bukti**: `web/src/components/ThemeProvider.tsx` membuat objek `value={{ …22 field… }}` inline
    pada setiap render, dan 10 setter (`setTheme`, `setAppFont`, …) dibuat ulang tiap render.
    Semua konsumen (`ChatSidebar`, `FileTab`, `DocumentTab`, komponen settings) ikut re-render saat
    provider re-render (mis. `systemDark` berubah / `hydrated` berubah).
  - **Cara**: ikuti pola `I18nProvider`: `useMemo` untuk `value` dengan deps yang tepat; bungkus
    setter dengan `useCallback` (atau satu `updatePreferences(patch)`); ganti `hydrated` state
    dengan `hydratedRef` (tidak perlu render).
  - **Kriteria selesai**: Profiler — ubah tema via OS tidak me-render ulang konsumen yang tidak
    membaca field tersebut lebih dari sekali; guard test kecil yang memastikan `value` di-`useMemo`
    (mis. pola `readFileSync` seperti `heavy-panels-lazy.test.ts`).

- [ ] **B4b** Kurangi 10 `useState` + 9 efek DOM menjadi satu objek preferensi (**M**)
  - **Bukti**: 10 `useState`, 9 `useEffect` (7 di antaranya hanya menulis `dataset`/CSS variable ke
    `document.documentElement`), dan 10 pembacaan `localStorage` sinkron terpisah.
  - **Cara**: satu state `UiPreferences` (`useReducer` atau satu `useState` objek) + satu efek
    `useLayoutEffect` yang menerapkan semuanya; baca `localStorage` sekali dengan satu key
    bervers (lihat **C4**).
  - **Kriteria selesai**: jumlah efek DOM ≤ 2; tidak ada FOUC (flash tema terang) saat start.

### B5. `FileTreePanel` me-render seluruh pohon pada setiap ketikan

- [ ] **B5** Komponen node tree yang di-`memo` (**M**)
  - **Bukti**: `web/src/components/FileTreePanel.tsx` mendefinisikan `renderNodes`,
    `renderEntryButton`, `renderEntryMenu` di dalam body komponen; state `renameName`,
    `createName`, `focusPath` berada di induk, sehingga setiap karakter yang diketik di input
    rename/create me-render ulang **seluruh** pohon yang terbuka.
  - **Cara**: `FileTreeNode = memo(...)` (props: `entry`, `depth`, `isOpen`, `mark`, `isFocused`,
    `onToggle`, `onOpen`, `onRenameStart`, …). Pindahkan state input rename/create ke komponen baris
    itu sendiri (uncontrolled + `defaultValue`, commit on blur/Enter).
  - **Kriteria selesai**: mengetik di input rename hanya me-render 1 baris; `marks` tetap
    di-`useMemo` (sudah).

### B6. Tulis `localStorage` saat drag = tulis sinkron per pointer event

- [ ] **B6** Debounce persist ukuran panel (**S**)
  - **Bukti**: `App.tsx` (`panelWidth` → `localStorage.setItem` di `useEffect`),
    `ChatSidebar` (`width`), `TerminalPanel` (`height`) menulis sinkron pada setiap `pointermove`
    saat resize.
  - **Cara**: simpan state di memori saat drag, tulis sekali di `pointerup` (atau debounce 150 ms);
    bungkus helper `writeStorage(key, value)` dengan cache (`js-cache-storage`).
  - **Kriteria selesai**: drag 3 detik tidak menghasilkan ratusan `localStorage.setItem`
    (verifikasi via Performance panel).

### B7. Turunkan state, jangan reset lewat efek

- [ ] **B7** Ganti reset massal di `App.tsx` dengan `key` pada subtree (**S**)
  - **Bukti**: efek `[currentId]` di `App.tsx` memanggil ±14 setter (`setAddingProvider`,
    `setAssigneeFilter`, `setDetailOpen`, `setLocalDocs`, `setGitStatusData`, …) dan men-set ulang
    `tabs` — semua terjadi setelah render pertama dengan data project lama (satu render "basi").
  - **Cara**: bungkus area project-specific dengan `key={currentId}` sehingga state turun otomatis;
    atau pindahkan state ke hook per domain (**E8**) yang di-reset lewat initializer.
  - **Kriteria selesai**: tidak ada efek yang tugasnya "reset 10+ state"; tidak ada kedipan data
    project sebelumnya saat ganti project.

- [ ] **B7b** Hapus efek turunan yang bisa dihitung saat render (**S**)
  - **Bukti**: contoh di `App.tsx` (`activeTab`, `activeFileLanguage` sudah render-time — bagus) vs
    `docSource` fallback lewat efek, dan `activeLspStatus` yang di-reset lewat efek
    `[activeTabId]` (satu render menampilkan status tab sebelumnya).
  - **Cara**: hitung nilai turunan langsung di render atau `useMemo`; untuk `activeLspStatus`
    simpan `Record<tabId, status>` atau reset saat `selectTab` (event handler) —
    `rerender-derived-state-no-effect`, `rerender-move-effect-to-event`.
  - **Kriteria selesai**: tidak ada efek yang isinya hanya `setX(...)` dari nilai yang bisa
    diturunkan.

---

## 5. Seksi C — Data fetching klien (P1)

- [ ] **C1** Dedupe `GET /api/settings/ui` saat startup (**S**)
  - **Bukti**: `ThemeProvider` dan `I18nProvider` masing-masing memanggil `api.getUiPreferences()`
    di mount → dua request identik pada boot.
  - **Cara**: satu provider preferensi (atau `request()` dengan cache in-flight per path selama
    beberapa detik — pola `client-swr-dedup` tanpa menambah dependensi).
  - **Kriteria selesai**: satu request `GET /api/settings/ui` saat start (DevTools Network).

- [ ] **C2** Perbaiki semantik abort/timeout di `request()` (**S**)
  - **Bukti**: `web/src/lib/api.ts` — `init?.signal?.addEventListener("abort", onAbort)` tidak
    menangani signal yang **sudah** aborted sebelum listener dipasang; dan `AbortError` selalu
    dipetakan ke `ApiError(408, "Request timeout")`, termasuk saat user sendiri membatalkan.
  - **Cara**: cek `signal.aborted` lebih dulu; bedakan abort dari pemanggil vs timeout internal
    (flag boolean); tambahkan retry 2× dengan jitter untuk GET idempoten pada 429/5xx (hormati
    `Retry-After`) — sejalan dengan REL-4 di `improvements.md`.
  - **Kriteria selesai**: unit test baru: signal pre-aborted → `AbortError`/pesan "dibatalkan",
    timeout internal → 408; GET 503 → retry lalu sukses.

- [ ] **C3** Hilangkan refetch berulang saat pindah menu (**S**)
  - **Bukti**: efek `[menu, currentId, docSource, …]` di `App.tsx` memanggil
    `loadGit(currentId)` setiap kali `menu` menjadi `files` **atau** `git`, `loadDocuments` +
    `loadLocalDocuments` setiap masuk `document`, dan `loadWorkflows` untuk `workflow`/`cron`.
  - **Cara**: cache per project + invalidasi eksplisit setelah mutasi (commit/stage/save), atau
    pisahkan "fetch awal" dari "refresh manual" (tombol refresh sudah ada di semua panel).
  - **Kriteria selesai**: pindah menu bolak-balik 5× tidak memicu request baru; setelah aksi
    (commit/stage) data tetap segar.

- [ ] **C4** Satu skema `localStorage` bervers (**S**)
  - **Bukti**: minimal 12 key terpisah dengan suffix `:v1` (`rnd.theme:v1`, `rnd.chatWidth:v1`,
    `rnd.panelWidth:v1`, `rnd.terminalHeight:v1`, `rnd.chatMode:v1`, `rnd.chatRole:v1`,
    `rnd.activeProjectId:v1`, `rnd.layout:v1`, `rnd.editor*`, `lullaby:mermaid-svg:*`), tiap
    pembacaan memanggil `localStorage.getItem` sinkron.
  - **Cara**: satu record `rnd.prefs:v2` untuk preferensi UI (baca sekali saat boot, tulis
    debounce), sisakan key terpisah hanya untuk data besar (mermaid SVG cache). Sediakan migrasi
    dari `:v1` dan hapus key lama.
  - **Kriteria selesai**: jumlah key ≤ 4; migrasi diuji (set `:v1` lama → nilai terbaca, key lama
    dibersihkan).

---

## 6. Seksi D — Backend & data (P1)

- [ ] **D1** PRAGMA SQLite untuk beban desktop (**S**)
  - **Bukti**: `src/db/db.ts` hanya menyetel `journal_mode = WAL` dan `foreign_keys = ON`.
  - **Cara**: tambah `PRAGMA synchronous = NORMAL` (aman dengan WAL, jauh lebih cepat untuk write),
    `PRAGMA busy_timeout = 5000` (mencegah "database is locked" saat desktop + test/CLI jalan
    bersamaan), `PRAGMA optimize` saat bootstrap dan setelah migrasi.
  - **Kriteria selesai**: test DB tetap hijau; ukur waktu batch insert 1000 event sebelum/sesudah.

- [ ] **D2** Versi skema eksplisit (**M**, DATA-1 di `improvements.md`)
  - **Bukti**: migrasi hanya `ensureColumn` idempotent; tidak ada `PRAGMA user_version`, sehingga
    DB dari versi lebih baru tidak bisa ditolak.
  - **Cara**: `user_version` + daftar migrasi berurutan; tolak start bila `user_version` DB >
    versi aplikasi; catat di `docs/data-model.md`.
  - **Kriteria selesai**: test migrasi (DB v0 → vN) + test penolakan downgrade.

- [ ] **D3** SSE: `id`, `retry`, dan resume (**M**, REL-2)
  - **Bukti**: `src/server/sse.ts` mengirim `data:` + heartbeat `: ping`; tanpa `id:`, tanpa
    `retry:`, tanpa dukungan `Last-Event-ID`; klien tidak punya backoff (lihat **B2**).
  - **Cara**: kirim `events.id` sebagai `id:`, `retry: 3000`; saat `Last-Event-ID` ada, replay dari
    tabel `events` (`id > last`, batasi 200). Tambah backoff eksponensial klien.
  - **Kriteria selesai**: restart server saat chat berjalan → event `chat.step` tidak hilang;
    test untuk `Last-Event-ID`.

- [ ] **D4** Query scheduler event memakai `LIKE '%type%'` (**S**)
  - **Bukti**: `listEventWorkflowSchedules` memakai `events LIKE ?` dengan `%${eventType}%` pada
    kolom TEXT berisi JSON → full scan tanpa index, dan bisa salah cocok bila satu tipe adalah
    substring tipe lain.
  - **Cara**: simpan trigger di tabel relasional (`workflow_schedule_events(schedule, event,
    status)`), atau minimal gunakan `json_each(events)`/`LIKE '%"'+type+'"%'`.
  - **Kriteria selesai**: query memakai index; test untuk dua tipe yang mirip (`workflow.failed` vs
    `workflow.failed.retry`).

- [ ] **D5** MCP: cache daftar tools dengan TTL (**S**, REL-3)
  - **Bukti**: `saveMcpSettingsHandler` dan `listMcpToolsHandler` memanggil `clearMcpToolsCache()`
    sebelum *setiap* discovery; run chat melakukan discovery saat mulai. Server MCP `stdio` =
    spawn proses baru.
  - **Cara**: TTL 60 s + invalidasi hanya saat config berubah; reuse daftar tools dalam satu run
    chat.
  - **Kriteria selesai**: dua discovery berturut-turut tidak spawn proses dua kali (log/ps).

- [ ] **D6** Pecah `src/server/router.ts` (80 KB) per domain (**L**, ARCH-1)
  - **Bukti**: `router.ts` 80.584 B; `src/server/routes/` baru berisi `backup`, `chat-review`,
    `llm`, `roles`, `settings`, `workflows`.
  - **Cara**: pindahkan sisa domain dengan pola yang sudah ada: `routes/projects.ts`,
    `routes/files.ts`, `routes/git.ts`, `routes/tickets.ts`, `routes/documents.ts`,
    `routes/chat.ts`, `routes/events.ts`; `router.ts` tinggal tabel rute + auth + fallback.
  - **Kriteria selesai**: `router.ts` ≤ 30 KB; tiap domain punya test request-level (401 tanpa
    cookie + happy path).

- [ ] **D7** Verifikasi urutan boot window vs server (**S**)
  - **Bukti**: `main.ts` memanggil `createMainWindow()` **sebelum** `Deno.serve(...)`; `bootstrap()`
    (DB, migrasi, `pruneEvents`, `rehydrateChatRuns`, `installDefaultSkills`) di-`await` sebelum
    keduanya.
  - **Cara**: pastikan webview tidak menavigasi sebelum listener siap (retry/`listenThenOpen`),
    dan pindahkan pekerjaan non-kritis dari `bootstrap()` ke `bootstrapBackground()` bila durasinya
    > 300 ms.
  - **Kriteria selesai**: ukur durasi `bootstrap()` (log `bootstrap complete`) dan buktikan tidak
    ada request gagal pada 3× cold start.

- [ ] **D8** Kunci performa `static.ts` dengan test (**S**)
  - **Bukti**: `static.ts` sudah benar (memoize decode, `immutable` untuk aset ber-hash, ETag, gzip).
    Belum ada test yang menjaganya.
  - **Cara**: test: (1) dua request aset yang sama → `decode()` dipanggil sekali (spy/Mock),
    (2) `/assets/index-abc123.js` → `cache-control: public, max-age=31536000, immutable`,
    (3) `if-none-match` cocok → 304, (4) klien tanpa `accept-encoding` → body ter-inflate.
  - **Kriteria selesai**: test baru di `test/static.test.ts` hijau.

---

## 7. Seksi E — Best practices & quality gate (P1)

- [ ] **E1** Jalankan vitest di CI (**S**, CI-1)
  - **Bukti**: `.github/workflows/ci.yml` menjalankan `deno test -A --coverage` tapi **tidak**
    `npm --prefix web run test`, padahal ada 18 file `web/src/**/*.test.ts` dan
    `web/package.json` punya script `test`.
  - **Cara**: tambah step `npm --prefix web run test` setelah typecheck client; ganti
    `npm --prefix web install` → `npm --prefix web ci`; tambah cache Deno/npm dan
    `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`.
  - **Kriteria selesai**: PR yang merusak `web/src/lib/**` gagal di CI.

- [ ] **E2** Satu perintah verifikasi (**S**, DX-1)
  - **Cara**: `deno task verify` = `build` → `check` → `lint` → `fmt --check` → `test` →
    `web typecheck` → `web test`. CI memanggil task yang sama; sebut di `AGENTS.md` +
    `docs/getting-started.md`.
  - **Kriteria selesai**: satu perintah, exit code 0 di checkout bersih; CI memakai task itu.

- [ ] **E3** Lint/format untuk `web/` (**M**, CI-5)
  - **Bukti**: `deno.json` mengecualikan `web/**` dari lint; `web/` tidak punya Biome/ESLint/
    Prettier.
  - **Cara**: Biome (`biome check`) untuk `web/src` dengan aturan React hooks; jalankan di CI dan
    pre-commit.
  - **Kriteria selesai**: `biome check` hijau + jalan di CI.

- [ ] **E4** CSP & header keamanan (**M**, SEC-1)
  - **Bukti**: `src/server/static.ts` hanya mengirim `content-type`, `cache-control`, `etag`,
    `vary`.
  - **Cara**: untuk `/index.html` kirim `content-security-policy` (self + `worker-src blob:` +
    `connect-src` ws lokal), `x-content-type-options: nosniff`, `referrer-policy: no-referrer`.
    Uji: Monaco worker, xterm, mermaid, WS terminal/LSP tetap jalan.
  - **Kriteria selesai**: header ada di respons HTML; tidak ada error CSP di console untuk alur
    utama; catatan di `docs/ui.md`.

- [ ] **E5** Perketat izin Deno (**M**, SEC-4)
  - **Bukti**: `deno.json` — `dev`/`start`/`desktop` memakai `--allow-read/--allow-write/
    --allow-net/--allow-env/--allow-run/--allow-ffi/--allow-sys` tanpa batas path;
    `test` memakai `-A`.
  - **Cara**: batasi `--allow-read`/`--allow-write` ke `appDataDir` + workspace yang dipilih,
    `--allow-run` ke perintah yang memang dipakai (git, shell, npx), `--allow-net` ke
    loopback + host integrasi; untuk `test` ganti `-A` dengan izin minimum +
    `RND_APP_DATA_DIR` sementara. Dokumentasikan pengecualian (`--allow-ffi` untuk PTY).
  - **Kriteria selesai**: `deno task test` lulus tanpa `-A`; `deno task start` tetap bisa
    membuka workspace.

- [ ] **E6** Guard kebocoran secret (**S**, SEC-5)
  - **Cara**: test yang memanggil `serializeLlm`, `serializeIntegration`, `maskMcpServers`,
    `maskNotificationChannels` dan gagal bila muncul `enc:v1:` atau pola `sk-`, `xoxb-`.
  - **Kriteria selesai**: test ada dan hijau.

- [ ] **E7** Selesaikan i18n `App.tsx` + `ChatSidebar.tsx` (**L**, tiket `LOCAL-8A9A58`)
  - **Bukti**: masih ada string Indonesia hardcoded di `App.tsx` (`"Kosong"`,
    `"Pilih atau buat project di panel kiri."`, `"Simpan"`, `"Review changes"`) dan string chat di
    `ChatSidebar` (`"Memulai chat…”`, `"Belum ada provider LLM"`). `AGENTS.md` mencatat kedua file
    ini belum tercakup.
  - **Cara**: lanjutkan codemod `scripts/i18n-apply.ts` per blok, tambah key ke
    `web/src/lib/i18n/messages/{id,en}/`.
  - **Kriteria selesai**: `i18n.test.ts` memastikan key `id`/`en` identik; tidak ada string UI
    hardcoded di kedua file.

- [ ] **E8** Ekstraksi hook dari `App.tsx` (**L**, ARCH-2)
  - **Bukti**: `web/src/hooks/` hanya berisi `useEditorTabs`, `useDirtyPaths`, `useLayoutMode`;
    state project/tiket/git/dokumen/chat/workflow masih di `App.tsx` (70.818 B, ±40 `useState`).
  - **Cara** (urutan aman, satu per satu): `useProjects` → `useGit` → `useTickets` →
    `useDocuments` → `useWorkflows` → `useChatRun` → `useActivityFeed`. Aturan: hook memiliki
    fetch + state + efek; `App.tsx` hanya komposisi + routing tab.
  - **Kriteria selesai**: `App.tsx` ≤ 40 KB; hook yang murni punya unit test.

- [ ] **E9** Sinkronkan `improvements.md` dengan realita (**S**)
  - **Bukti**: §1 masih menandai PERF-1/2/3/4/5/6/7 dan REL-1 `Open`; §2 masih memakai baseline lama
    (24 MB, chunk utama 1,19 MB, favicon 1,5 MB, `router.ts` 77 KB).
  - **Cara**: perbarui tabel status + baseline dengan angka di §1 dokumen ini, dan tautkan dokumen
    ini sebagai "checklist eksekusi".
  - **Kriteria selesai**: tidak ada item selesai yang masih ditandai `Open`.

- [ ] **E10** Terapkan aturan React yang tersisa sebagai review checklist (**S**)
  - **Cara**: masukkan ke template PR/review: `bundle-dynamic-imports` (panel baru wajib lazy di
    modul pemilik), `rerender-memo` (list item > 50 baris wajib komponen `memo`),
    `client-event-listeners` (listener global hanya satu per tipe, baca state lewat ref),
    `rerender-derived-state-no-effect`, `client-localstorage-schema` (key bervers + helper),
    `async-parallel` (fetch independen → `Promise.all`), `rendering-content-visibility` untuk list
    panjang.
  - **Kriteria selesai**: checklist tercantum di `AGENTS.md` (bagian Conventions) — bukan dokumen
    baru yang tidak dibaca.

---

## 8. Urutan eksekusi

| Sprint | Fokus | Item | Definition of done |
| --- | --- | --- | --- |
| 1 (½ hari) | Gate & ukur | **E1, E2, A6, B6, D8** | vitest di CI; `deno task verify`; guard ukuran chunk; tidak ada tulis storage per pointermove |
| 2 (1–2 hari) | Hot path chat & shell | **B1.1, B1.2, B2, B3, B4** | mengetik tidak me-render transkrip; 1 koneksi SSE; 1 listener keyboard; context ThemeProvider stabil |
| 3 (1–2 hari) | Bundle | **A1, A4, A5, A2, A3** | `MonacoViewer` ≤ 2,5 MB; chunk utama ≤ 600 KB; keputusan `ts.worker` & renderer mermaid tertulis |
| 4 (2–3 hari) | Data & backend | **D1, D3, D4, D5, C1–C4** | SQLite PRAGMA; SSE resume; 1 request prefs saat boot; cache per project |
| 5 (3–5 hari) | Struktur & keamanan | **D6, E8, E4, E5, E6, B5, B7** | `router.ts` ≤ 30 KB; `App.tsx` ≤ 40 KB; CSP aktif; izin Deno minimum |
| 6 (berkelanjutan) | Kualitas & polish | **B1.3, B1.4, E3, E7, E9, E10** | list panjang responsif; Biome di CI; i18n selesai; docs tidak drift |

Aturan penutupan item: sertakan **angka sebelum/sesudah** untuk item performa, **test baru** untuk
item korektness, dan **kutipan log/screenshot** untuk item runtime.

---

## 9. Verifikasi cepat setelah perubahan

```bash
deno task build                      # build:web + embed aset (guard ukuran ikut jalan)
ls -S web/dist/assets | head -20     # chunk terbesar
ls -l src/ui/assets.generated.ts     # ukuran binary-embedded UI
deno task check                      # typecheck backend (desktop globals)
npm --prefix web run typecheck       # typecheck client
deno task lint && deno fmt --check
deno task test                       # backend
npm --prefix web run test            # client (vitest) — WAJIB setelah E1
```

Manual smoke (urutan yang paling sering rusak bila item performa disentuh):

1. Start aplikasi → tema/font/bahasa terakhir langsung terpakai (tidak ada flash).
2. Buka file `.ts` → editor muncul, find/suggest/hover/format/LSP badge jalan.
3. Buka dokumen Markdown tanpa diagram → tidak ada request `mermaid.core-*.js`.
4. Chat: kirim pesan panjang → step muncul bertahap, mengetik di composer tetap mulus, stop
   berfungsi, Review bisa dibuka setelah restart (**REL-1**).
5. Git: stage → commit → history + diff tampil; pindah menu bolak-balik tidak memicu refetch
   berlebihan (**C3**).
6. Terminal: buka/tutup panel, resize, dua sesi; xterm hanya diunduh sekali.

---

## 10. Referensi

- Backlog lengkap (arsitektur, produk, docs drift): [`improvements.md`](improvements.md)
- Audit keamanan/tooling historis: [`AUDIT_CHECKLIST.md`](../AUDIT_CHECKLIST.md)
- Perilaku terkini (sumber kebenaran): [`AGENTS.md`](../AGENTS.md)
- Arsitektur & modul: [`architecture.md`](architecture.md) · UI: [`ui.md`](ui.md)
- Data & path: [`data-model.md`](data-model.md) · API: [`api.md`](api.md)
- Aturan React/Vite yang dipakai sebagai acuan: skill `vercel-react-best-practices`
  (`bundle-dynamic-imports`, `rerender-memo`, `rerender-derived-state-no-effect`,
  `client-event-listeners`, `client-localstorage-schema`, `rendering-content-visibility`).
