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
| **clickup** | apiToken, listId, teamId?, … | Board + transition + sync lokal |
| **github** | baseUrl, token, org, repo, … | Health / meta kode (UI Code) |
| **llm** | Global Settings → LLM Providers | Chat + generate tickets |

Test koneksi: `POST /api/integrations/test` → `src/integrations/index.ts`.

## Kredensial

- Diisi sebagai teks biasa di form
- Disimpan terenkripsi at-rest di SQLite (`enc:v1:` + AES-256-GCM) untuk field secret di
  `project_integrations.config`, `llm_providers.api_key`, MCP `env`/`headers`, dan
  notification `webhookUrl` — lihat [data-model.md](../data-model.md#secrets-at-rest)
- Di-mask saat dikirim ke renderer (`••••`)
- Merge secret saat update: field kosong / mask tidak menimpa token tersimpan

## Catatan

- MCP global (Global Settings → MCP): tool di-inject ke chat sebagai `mcp_<server>_<tool>`
  (lihat [chat-agent.md](chat-agent.md))
- Path workspace Git/Terminal bukan integrasi DB — memakai folder project
