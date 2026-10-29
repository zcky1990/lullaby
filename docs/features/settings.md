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
| MCP                 | Server stdio/http, enable, disable tools (list saja)                             |
| Skills              | Enable global + toggle per skill                                                 |
| Tools               | Auto-approve writes + enable/disable chat tools — [chat-agent.md](chat-agent.md) |
| Automation          | Auto-build To Do → In Progress — [automation.md](../automation.md)               |
| Terminal            | Default shell (`zsh` / `bash`) untuk session baru                                |
| About               | Info aplikasi                                                                    |

## Preferensi UI lokal (bukan DB)

Disimpan di `localStorage` browser/webview, misalnya:

- Project aktif
- Lebar panel
- Mode chat / role terpilih
- Font + ukuran font chat (`rnd.chatFont:v1`, `rnd.chatFontSize:v1`)
- Tinggi terminal
