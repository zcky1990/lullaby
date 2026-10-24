# Documents

Panel **Document** mendukung empat sumber. State sumber di UI; remote memakai query `?source=`.

## Local

- Root: `projects.document_path`
- File `.md` di disk; buat/rename/simpan dari UI
- Badge sync: Local / Synced / Error
- **Sync ke Docmost** manual (`POST .../local-documents/sync`) menyimpan `page_id` di `local_documents`
- **Generate ticket** dari isi dokumen → `POST .../generate-tickets` (LLM + tool `create_ticket` saja)

## Docmost

- Config project: base URL + API token + opsional Space ID
- List tree (lazy children), buka markdown, **Create** / **Edit** halaman
- Client: `src/integrations/docmost.ts`

## Notion (read-only v1)

- Auth: Internal Integration Token; opsional `parentPageId`
- Host API tetap `https://api.notion.com`
- Tanpa parent: search pages; dengan parent / expand: block children bertipe page
- Konten: blocks → markdown sederhana
- Client: `src/integrations/notion.ts`

## Confluence Cloud (read-only v1)

- Auth: baseUrl + email + API token; opsional `spaceKey`
- Tanpa space: daftar spaces (`space:KEY`); expand: pages / children
- Body HTML → teks/markdown-ish
- Client: `src/integrations/confluence.ts`

## Out of scope v1

- Create/update Notion atau Confluence
- Sync lokal → Notion/Confluence

Lihat juga [integrations.md](integrations.md).
