# Integrations

Integrasi **per project** disimpan di `project_integrations` (kecuali LLM = global).
Form UI: Project Settings → Integrations (`IntegrationForm` + `SINGLETONS` di
`web/src/lib/integrations.ts`).

## Matriks

| Kind | Auth / field utama | Dipakai untuk |
| --- | --- | --- |
| **docmost** | baseUrl, apiToken, spaceId? | Dokumen remote + sync lokal |
| **notion** | apiToken, parentPageId? | Browse/baca Notion |
| **confluence** | baseUrl, email, apiToken, spaceKey? | Browse/baca Confluence |
| **jira** | baseUrl, email, apiToken, projectKey, … | Board + transition + sync lokal |
| **github** | baseUrl, token, org, repo, … | Health / meta kode (UI Code) |
| **llm** | Global Settings → LLM Providers | Chat + generate tickets |

Test koneksi: `POST /api/integrations/test` → `src/integrations/index.ts`.

## Kredensial

- Diisi sebagai teks biasa di form
- Disimpan di JSON `config` / `llm_providers.api_key`
- Di-mask saat dikirim ke renderer (`••••`)
- Merge secret saat update: field kosong tidak menimpa token tersimpan

## Catatan

- Mode integrasi `mcp` ada di schema; eksekusi MCP dari chat **belum** di-wire
- Path workspace Git/Terminal bukan integrasi DB — memakai folder project
