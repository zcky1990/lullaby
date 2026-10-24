# `/code-review`

Skill builtin untuk review perubahan kode (mindset Cursor code-review): findings dulu,
diurutkan severity; tidak mengubah file kecuali user meminta.

## Cara pakai

1. Pilih project dengan workspace git (disarankan).
2. Di Chat, ketik `/code-review` (atau pilih dari mention menu), opsional tambah permintaan
   (mis. fokus path / uncommitted saja).
3. Composer beralih ke **Plan**; kirim pesan.

## Perilaku

| Lapisan | Perilaku |
| --- | --- |
| Skill file | `src/skills/builtin/code-review/SKILL.md` (source `builtin`) |
| UI | `skillName === "code-review"` → mode Plan |
| Server | `chat/agent.ts` memaksa `effectiveMode = "plan"` dan memperkaya pesan terakhir user |
| Konteks git | `src/server/code-review.ts` → status + unstaged/staged/upstream diffs (truncate) |

Jika workspace bukan repo git, pesan menyertakan catatan error dan agent memakai
`list_files` / `read_file`.

## Output yang diharapkan

1. Satu kalimat ringkasan scope review
2. Tabel findings (Severity / Location / Finding) atau “no issues”
3. Notes singkat opsional (testing gaps)

## File terkait

- `src/skills/builtin/code-review/SKILL.md`
- `src/server/code-review.ts`
- `src/server/chat/agent.ts` (`CODE_REVIEW_SKILL`)
- `web/src/components/ChatSidebar.tsx`
