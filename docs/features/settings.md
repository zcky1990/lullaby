# Settings

## Project Settings

Aside + tab. Section collapsible di `SettingsView`:

| Section      | Isi                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| Workspace    | `workspace_path`, `document_path` (+ native folder picker); **Clone repository** ke path workspace (HTTPS/SSH) |
| Integrations | Document (Docmost/Notion/Confluence), Ticket (Jira), Code (GitHub)                                             |
| Activity     | Feed event project                                                                                             |

## Global Settings

Section nav di aside (`GlobalSettingsPanel`):

| Section             | Isi                                                                              |
| ------------------- | -------------------------------------------------------------------------------- |
| Appearance & Editor | Tema, font aplikasi/chat, ukuran font chat, icon, Monaco theme                   |
| LLM Providers       | CRUD provider global                                                             |
| Roles               | Persona + optional provider                                                      |
| MCP                 | Server stdio/http, enable/disable tools; tools aktif masuk chat sebagai `mcp_*`  |
| Skills              | Enable global + toggle per skill                                                 |
| Tools               | Auto-approve writes + enable/disable chat tools — [chat-agent.md](chat-agent.md) |
| Automation          | Auto-build To Do → In Progress — [automation.md](../automation.md)               |
| Notifications       | Daftar channel webhook; dipakai step `action: notification` — [notifications.md](notifications.md) |
| Terminal            | Default shell (`zsh` / `bash`) untuk session baru                                |
| About               | Info aplikasi                                                                    |

## MCP: dari mana konfigurasi dibaca

Server MCP **hanya** dibaca dari database aplikasi — `app_settings.mcp_servers` di
`{appDataDir}/data.db` (lihat [data-model.md](../data-model.md)). Tidak ada loader file: entri
seperti

```json
"figcraft": { "command": "figcraft-cli", "args": ["mcp"] }
```

yang ditulis ke `mcp.json`, `~/Library/Application Support/Lullaby/config.json`, atau
`~/.cursor/mcp.json` **tidak akan terbaca**.

Cara mendaftarkannya: **Global Settings → MCP → Edit JSON** (wajib dibungkus `mcpServers`) atau
tombol **Tambah server**:

```json
{
  "mcpServers": {
    "figcraft": { "command": "figcraft-cli", "args": ["mcp"] }
  }
}
```

Catatan untuk transport `stdio`:

- `command` di-resolve seperti LSP: `PATH` proses, `/opt/homebrew/bin`, `/usr/local/bin`,
  `~/.local/bin`, `~/.cargo/bin`, `~/go/bin`, lalu fallback login shell (`command -v`). Bila tetap
  tidak ketemu, isi path absolut di kolom Command — app yang dibuka dari Finder/Dock mewarisi `PATH`
  minimal.
- `stderr` server ikut dibaca (pipe penuh tidak memblokir proses) dan dipakai di pesan error;
  server yang mati sebelum handshake dilaporkan sebagai
  `proses berhenti sebelum handshake MCP (exit N) — <stderr>`.
- Setelah mengubah konfigurasi, klik **Tools** pada kartu server untuk refresh — `tools/list`
  di-cache 60 detik.

## Preferensi UI

Preferensi tampilan (tema, font aplikasi/editor/chat, ukuran, ikon) disimpan ke backend di
`app_settings.ui_preferences` melalui `GET/PUT /api/settings/ui`, dengan `localStorage` sebagai
cache awal. Ini penting karena origin webview desktop memakai port loopback yang bisa berubah tiap
launch.

Preferensi lain masih disimpan di `localStorage` browser/webview, misalnya:

- Project aktif
- Lebar panel
- Mode chat / role terpilih
- Font + ukuran font chat (`rnd.chatFont:v1`, `rnd.chatFontSize:v1`)
- Tinggi terminal
