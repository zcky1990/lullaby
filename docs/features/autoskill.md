# `/autoskill` (npx autoskills)

## Apa itu

Slash command di chat composer yang menjalankan CLI
[`autoskills`](https://www.npmjs.com/package/autoskills) di folder workspace project.
CLI mendeteksi stack (package.json, config, dll.) dan menginstal skill curated ke
`<workspace>/.agents/skills`, yang langsung dibaca RND Workflow.

## Cara pakai

1. Set **Workspace** project (Project Settings → Workspace).
2. Pastikan **Node.js >= 22.6** dan `npx` ada di PATH mesin yang menjalankan app.
3. Di Chat, ketik `/autoskill` (atau pilih dari mention menu saat mengetik `/`).
4. Tunggu status di thread; daftar skill workspace akan di-refresh.

Tidak memanggil LLM. Tidak membutuhkan provider LLM.

## API

`POST /api/projects/:id/autoskills`

```json
{ "dryRun": false }
```

Response:

```json
{
  "ok": true,
  "dryRun": false,
  "output": "…stdout/stderr…",
  "skills": [{ "id": "workspace:…", "name": "…", "source": "workspace", "path": "…" }]
}
```

Perintah yang dijalankan (cwd = workspace):

```bash
npx --yes autoskills -y -a cursor
```

## Prasyarat & batasan

- Network untuk unduh package + registry skills
- `--allow-run` (sudah di `deno task dev` / `desktop`)
- Timeout ~5 menit
- Hanya path `.agents/skills` (canonical autoskills) yang dipakai app ini

## Kode

- Backend: `src/server/autoskills.ts`, route di `src/server/router.ts`
- Slash reserved: `src/server/chat/slash-skill.ts`, `web/src/lib/slash-skill.ts`
- UI: `web/src/components/ChatSidebar.tsx`
