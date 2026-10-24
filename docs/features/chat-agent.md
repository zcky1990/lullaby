# Chat agent

Chat sidebar kanan (`ChatSidebar`) memanggil `POST /api/projects/:id/chat`. Engine:
`src/server/chat/agent.ts`.

## Mode

| Mode | Tools | Tujuan |
| --- | --- | --- |
| **Plan** | `use_skill` (jika ada) | Rencana tanpa ubah file/tiket |
| **Build** | `use_skill`, `list_files`, `read_file`, `write_file`, `create_ticket` | Kerja di workspace |

Mode disimpan di localStorage (`rnd.chatMode:v1`).

## Tools

- Path file relatif ke `workspace_path`; path di luar ditolak
- `create_ticket` selalu menulis ke SQLite lokal (bukan langsung Jira)
- `use_skill` memuat body `SKILL.md` (progressive disclosure)
- Loop tool dibatasi langkah (`MAX_STEPS` di agent)

## Dua jalur write

1. **Chat `write_file`** → pending hunk → tab **Review** →
   `POST /api/chat/change` atau `/api/chat/change-all` → baru ditulis ke disk
2. **Editor Monaco** → `PUT .../files/content` langsung (user mengedit sendiri)

Event UI: `web/src/lib/review-events.ts`.

## Skills

Discovery: workspace `.agents/skills` > project skills (auto) > global skills.  
Composer: `/skill-name` menyuntikkan body ke system prompt.  
Setelah Build sukses yang memakai tools, `skill-learn.ts` dapat menulis skill project.

## Roles

Role global punya `persona` (+ opsional provider). Dipilih di composer; persona di-prepend ke
system prompt. Jika role punya provider, selector model terkunci ke provider itu.

## Sesi & lampiran

- Sesi & pesan di SQLite
- Lampiran: gambar (batas ukuran), teks, atau path workspace
- Variant Low/Medium/High mengatur temperature LLM

## Generate tickets dari dokumen

`POST .../generate-tickets` memakai provider LLM pertama dan hanya tool `create_ticket`.
