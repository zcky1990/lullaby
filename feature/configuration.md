# Sample Konfigurasi Project

Bentuk konfigurasi yang **benar-benar disimpan** aplikasi saat ini (SQLite `data.db`,
project-centric). Bukan lagi file `.app_config/config.json` + `secretRef`.

> Kredensial (API token/key) diisi sebagai **teks biasa** di form integrasi dan disimpan di
> `config`/`api_key`. Lihat `overview.md` §2 & §7.

## 1. Project

```jsonc
{
  "id": "prj_checkout",
  "name": "Checkout Redesign",
  "workspace_path": "/Users/dev/projects/checkout", // optional; mengaktifkan menu Explorer
  "docmost_space_id": "sp_123",
  "jira_project_key": "PROJ",
  "github_repo": "acme/storefront"
}
```

## 2. Integrasi (`project_integrations`, satu baris per `kind`)

### Mode API (default)

```jsonc
// kind = "docmost"
{ "mode": "api", "config": { "baseUrl": "https://docmost.example.com", "apiToken": "<token>", "workspace": "acme", "spaceId": "sp_123" } }

// kind = "jira"
{ "mode": "api", "config": { "baseUrl": "https://acme.atlassian.net", "deployment": "cloud", "projectKey": "PROJ", "email": "bot@example.com", "apiToken": "<token>" } }

// kind = "github"
{ "mode": "api", "config": { "baseUrl": "https://api.github.com", "org": "acme", "repo": "storefront", "defaultBranch": "main", "token": "<token>" } }
```

Catatan field:
- `jira.deployment`: `cloud` | `data-center`. `cloudId` dipakai untuk OAuth 3LO.
- `github.token`: PAT / installation token.
- `mode`: `api` (dieksekusi) atau `mcp` (**tersimpan tetapi belum dieksekusi**).

### Mode MCP (opt-in, belum dieksekusi)

```jsonc
{
  "mode": "mcp",
  "config": {
    "command": "npx",
    "args": ["-y", "your-mcp-package"],
    "protocol": "2026-07-28"
  }
}
```

## 3. Provider LLM (`llm_providers`, banyak per project)

```jsonc
[
  { "name": "Anthropic Cloud", "provider": "anthropic", "model": "claude-sonnet-4", "baseUrl": "https://api.anthropic.com/v1", "apiKey": "<key>", "mode": "api" },
  { "name": "OpenAI Cloud",    "provider": "openai",    "model": "gpt-4o",         "baseUrl": "https://api.openai.com/v1",      "apiKey": "<key>", "mode": "api" },
  { "name": "Ollama Local",    "provider": "ollama",    "model": "qwen2.5-coder:14b", "baseUrl": "http://localhost:11434/v1",   "apiKey": null,    "mode": "api" }
]
```

`provider` yang dikenali adapter: `anthropic` | `openai` | `ollama` | `deepseek` | `gemini` | `local`.
**Test Connection** memanggil `GET {baseUrl}/models` dengan `Authorization: Bearer <apiKey>`.

## 4. Pengaturan UI (bukan DB)

Disimpan di `localStorage` webview:

- `rnd.theme` — `light` | `dark` | `system` (tema aplikasi).
- `rnd.editorTheme` — `auto` | `vs` | `vs-dark` | `hc-black` | `hc-light` (tema Monaco).

## 5. Catatan

- **[rencana]** Opsi kembali ke secret manager/OS keychain (kolom `secret_ref` sudah ada tetapi tidak
  dipakai) bila diperlukan.
- Field target tingkat project (`docmost_space_id`, `jira_project_key`, `github_repo`) dipakai untuk
  mempermudah, sedangkan kredensial & detail endpoint ada di `config` integrasi.
