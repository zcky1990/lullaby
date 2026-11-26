# Documents

Panel **Document** mendukung empat sumber. State sumber di UI; remote memakai query `?source=`.

## Local

- Root: `projects.document_path` (diatur di **Project Settings → Workspace → Document workspace**)
- File `.md` di disk; buat/rename/simpan dari UI
- Badge sync: Local / Synced / Error
- **Sync** manual (`POST .../local-documents/sync` dengan `target`:
  `docmost` \| `notion` \| `confluence`) menyimpan `page_id` + `sync_target` di `local_documents`
- **Generate ticket** dari isi dokumen → `POST .../generate-tickets` (LLM + tool `create_ticket` saja)

  System prompt-nya bisa di-override di **Global Settings → Prompts → Ticket generation prompt**
  (`app_settings.ticket_prompt`, default `DEFAULT_TICKET_PROMPT` di `src/server/prompts.ts`).
  Judul + isi dokumen (maks 30.000 karakter) tetap dikirim sebagai pesan user, jadi prompt kustom
  cukup menjelaskan gaya tiket yang diinginkan (jumlah, bahasa, field wajib, dll).
  Reset ke default lewat tombol **Reset to default** di section yang sama.

### Menambah file dari luar UI

Daftar dokumen dibaca langsung dari disk (`listLocalDocuments`), jadi file `.md` baru langsung
terbaca — tetapi server **tidak** mem-push perubahan itu ke UI. Karena itu panel melakukan
auto-refresh selama tab Local aktif:

| Pemicu | Kapan |
| --- | --- |
| Polling | tiap `DOCS_POLL_INTERVAL_MS` (10 dtk), hanya saat tab terlihat & tidak sedang refresh |
| `focus` window | kembali ke app setelah mengedit file di editor lain |
| `visibilitychange` | window kembali terlihat |
| Tombol refresh | manual, kapan saja |

Implementasi: `web/src/hooks/useLocalDocsAutoRefresh.ts` + `web/src/lib/docs-poll.ts`
(gate `shouldPollLocalDocs`). Refresh berjalan diam-diam: indikator "Memuat dokumen lokal…"
hanya tampil saat daftar masih kosong.

Catatan performa: judul dokumen dibaca dari potongan awal file (`readDocumentHead`, 4 KB) di
`src/fs/documents.ts`, bukan seluruh isi file. Dengan ratusan dokumen, polling tetap murah.
Masih ada batas `MAX_DOCUMENTS = 500` per document workspace.

Tips kalau dokumen baru tidak muncul: pastikan file `.md` ada di bawah folder
**Document workspace** project (bukan workspace kode), lalu tekan refresh / tunggu satu siklus
polling. Tombol + pada panel selalu menulis ke folder tersebut.

## Docmost

- Config project: base URL + API token + opsional Space ID
- List tree (lazy children), buka markdown, **Create** / **Edit** halaman
- Client: `src/integrations/docmost.ts`

## Notion

- Auth: Internal Integration Token; opsional `parentPageId` (wajib untuk create tanpa parent UI)
- Host API tetap `https://api.notion.com`
- Tanpa parent: search pages; dengan parent / expand: block children bertipe page
- Konten: blocks ↔ markdown sederhana; **Create** / **Edit** didukung
- Client: `src/integrations/notion.ts`

## Confluence Cloud

- Auth: baseUrl + email + API token; opsional `spaceKey` (wajib untuk create tanpa space/parent)
- Tanpa space: daftar spaces (`space:KEY`); expand: pages / children
- Body storage HTML ↔ markdown sederhana; **Create** / **Edit** didukung
- Client: `src/integrations/confluence.ts`

Lihat juga [integrations.md](integrations.md).
