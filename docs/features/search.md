# Quick Open & Find

Dua cara mencari di workspace, mirip VS Code.

## Quick Open — `Cmd/Ctrl+P`

- Modal palette untuk mencari **nama/path file**.
- Indeks file diambil dari `GET /api/projects/:id/files/index` (di-cache per project, refresh
  diam-diam saat dibuka).
- Pencarian fuzzy: nama file diprioritaskan, lalu substring path, lalu subsequence.
- `↑`/`↓` memilih, `Enter` membuka, `Esc` menutup.
- Folder yang diabaikan: `.git`, `node_modules`, `dist`, `build`, `target`, `.venv`, `__pycache__`,
  `.next`, `.nuxt`, `.svelte-kit`, dan cache umum lain. Maksimal 5000 file / 12 level.

## Find — menu Find atau `Cmd/Ctrl+Shift+F`

- Tab **Find** berisi pencarian teks di seluruh file workspace.
- Opsi **Match case** dan **Regex**.
- Debounce 180 ms; hasil dikelompokkan per file dengan nomor baris dan preview.
- Klik hasil → file dibuka pada baris tersebut (Monaco `revealLine`).
- Batas: 3000 file / 8 MB teks per pencarian, 200 hasil. Jika terpotong, UI menampilkan indikator.
- File biner dan file > 200 KB (dipotong `readWorkspaceFile`) dilewati/dicari pada bagian awal.

## API

| Method | Path                                           | Keterangan                                |
| ------ | ---------------------------------------------- | ----------------------------------------- |
| GET    | `/api/projects/:id/files/index`                | `{ files, truncated }`                    |
| GET    | `/api/projects/:id/files/find?q=&case=&regex=` | `{ matches, scanned, truncated, error? }` |

`case=1` untuk case-sensitive, `regex=1` untuk regex. Query maksimal 300 karakter.

## Implementasi

- Backend: `src/fs/workspace.ts` (`listWorkspaceFiles`, `findInWorkspace`) + route di
  `src/server/router.ts`.
- Frontend: `web/src/components/QuickOpen.tsx`, `web/src/components/FindTab.tsx`.
- Shortcut didaftarkan di `web/src/App.tsx`; hasil Find membuka tab file dengan `line`.
- Tests: `test/files.test.ts`.
