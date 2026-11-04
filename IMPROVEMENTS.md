# Improvement ideas

Saran peningkatan untuk **Lullaby**, diurutkan dari menutup gap v1 yang sudah tertulis di
[`docs/overview.md`](docs/overview.md) ke arah diferensiasi produk. Ini bukan roadmap resmi —
prioritas bisa berubah.

## Tutup gap v1

| Ide | Mengapa | Catatan |
| --- | --- | --- |
| ~~**MCP tools di chat**~~ | ~~Config + `tools/list` sudah ada; agent belum bisa memanggil tool MCP~~ | **Done** — lihat [`docs/features/chat-agent.md`](docs/features/chat-agent.md) |
| ~~**Workflow scheduler**~~ | ~~Run masih manual; cron/event menutup busywork berulang~~ | **Done** — `schedule`/`on` + ticker; lihat [`docs/features/workflows.md`](docs/features/workflows.md) |
| **Automation loop penuh** | Auto-accept Review (opsional), auto-move tiket ke Test/Done setelah Build sukses | [`docs/automation.md`](docs/automation.md) |
| ~~**Notion / Confluence write + sync lokal**~~ | ~~Browse/baca sudah ada; create/update & sync lokal belum~~ | **Done** — lihat [`docs/features/documents.md`](docs/features/documents.md) |
| ~~**Tiket multi-provider (ClickUp)**~~ | ~~Board Jira-centric; skill ClickUp sudah ada~~ | **Done** — ClickUp board + sync; Linear masih open |

## Coding loop

| Ide | Mengapa |
| --- | --- |
| **PR flow** | Branch → commit → push → buka PR GitHub dari chat atau workflow (Git CLI sudah ada) |
| **Test & CI feedback** | Jalankan test di terminal/workflow; feed log gagal ke chat untuk perbaikan |
| **Diff Review lebih kaya** | Navigator multi-file, accept per file, revert, “apply & open PR” |
| ~~**Cursor sync lebih dalam**~~ | ~~Jalankan agent di `cwd` workspace asli + import cloud agents (`bc-…`)~~ | **Done** — lihat [`docs/features/chat-agent.md`](docs/features/chat-agent.md) |

## Produk & UX

| Ide | Mengapa |
| --- | --- |
| **Project templates** | New project = workspace + integrations + workflow starter + skills |
| **Activity / audit timeline** | Satu feed: sync tiket, workflow, chat writes, notifikasi |
| **Encrypted secrets** | Ganti plaintext token di SQLite (OS keychain / crypto lokal) |
| **Backup / export** | Dump `data.db` + settings ke zip; restore ke mesin lain |
| **Focus / dream mode** | Layout minimal (mis. Kanban + Chat saja) untuk deep work |

## Diferensiasi Lullaby

Sejalan dengan tagline *Let Developers Dream, We'll Handle the Work*:

| Ide | Mengapa |
| --- | --- |
| **PRD → epic breakdown** | Generate hierarki tiket + dependency graph, bukan flat list |
| **Release checklist agent** | Changelog, version bump, tag, notifikasi Slack/Discord/Google Chat |
| **Sleep report** | Ringkasan harian: tiket selesai, file berubah, PR terbuka |

## Prioritas praktis (usulan)

Tiga item yang paling langsung mengunci *busywork* tanpa permukaan produk baru:

1. ~~MCP tools di chat~~ (selesai)  
2. PR flow dari Git  
3. Automation Done setelah Build (dengan opt-in Review)

## Referensi

- Ruang lingkup v1: [`docs/overview.md`](docs/overview.md)
- Fitur saat ini: [`docs/features/`](docs/features/)
- Data & path app: [`docs/data-model.md`](docs/data-model.md), `~/Library/Application Support/Lullaby/`
