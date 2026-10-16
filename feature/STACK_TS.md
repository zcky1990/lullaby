# Plan: TypeScript Stack (Web App)

> **STATUS: sebagian disuperseded.** Implementasi awal memakai **Deno Desktop** (bukan Next.js web
> app). Yang benar-benar dipakai: **React 19 + Vite + Tailwind v4 + shadcn/ui** (di `web/`),
> **SQLite `node:sqlite`** (bukan Postgres/Prisma), **Zod**, SSE, dan adapter `fetch`.
> Lihat `STACK_RECOMMENDATION.md` (status implementasi) & `README.md`. Tabel di bawah disimpan
> sebagai rencana awal (target jangka panjang: Postgres, ORM, AI SDK, Temporal, MCP).

Turunan teknis dari `PLAN.md` + `CODE_EDITING_LOOP.md`, dikunci ke **TypeScript** dengan **React +
shadcn/ui**.

## 1. Keputusan stack

| Layer         | Pilihan (rencana)                                       | Dipakai sekarang                                 |
| ------------- | ------------------------------------------------------- | ------------------------------------------------ |
| Web framework | **Next.js 15 (App Router)**                             | **Vite + React 19** (SPA, di-embed)              |
| UI            | **React + shadcn/ui + Tailwind**                        | ✅ React 19 + Vite + Tailwind v4 + shadcn/ui     |
| Bahasa        | **TypeScript** (strict)                                 | ✅ TypeScript strict                             |
| DB            | **PostgreSQL**                                          | **SQLite (`node:sqlite`)**                       |
| ORM           | **Prisma**                                              | belum (SQL langsung)                             |
| Validasi      | **Zod**                                                 | ✅ Zod                                           |
| Jobs (MVP)    | DB-backed queue (`workflow_runs` + status)              | belum                                            |
| Jobs (scale)  | **Temporal TS SDK**                                     | belum                                            |
| AI            | **Vercel AI SDK** + adapter provider (OpenAI/Anthropic) | belum (provider LLM tersimpan saja)              |
| Integrasi     | `fetch` wrapper + adapter pattern                       | ✅ adapter `fetch`                               |
| Realtime      | **SSE** (MVP) → WebSocket                               | ✅ SSE                                           |
| MCP           | `@modelcontextprotocol/sdk` (fase berikut)              | belum (mode tersimpan)                           |
| Editor        | —                                                       | **Monaco** (`@monaco-editor/react`, bundle lokal) |
| Kanban        | —                                                       | **ReUI** (`@reui/kanban`) + `@dnd-kit/*`, `@base-ui/react` |


## 2. Struktur repo (mono-repo ringan)

```
RND-workflow/
  docs/                      # PLAN.md, CODE_EDITING_LOOP.md, STACK_TS.md
  web/                       # Next.js app (MVP)  <-- dibangun sekarang
    prisma/schema.prisma
    src/app/                 # routes (App Router)
    src/components/          # UI (shadcn + fitur)
    src/lib/
      integrations/          # docmost.ts, jira.ts, github.ts
      ai/                    # provider + generator + verifier
      workflow/              # state machine + runner (MVP)
      db.ts
```

Nanti bisa ditingkatkan jadi pnpm workspace: `apps/web`, `apps/worker`, `packages/core`,
`packages/mcp`.

## 3. Data model (ringkas)

Inti: `Integration`, `ProjectMapping`, `PrdDocument`, `TicketDraft`, `Ticket`, `TicketLink`,
`WorkflowRun`, `AgentStep`, `KanbanColumn`.

Relasi utama:

```
ProjectMapping (docmostSpaceId -> jiraProjectKey -> githubRepo)
   ├─ PrdDocument (source PRD, hash, markdown)
   ├─ TicketDraft (hasil AI, status draft/approved/pushed)
   └─ Ticket (mirror Jira) ── TicketLink (branch/PR/commit)
WorkflowRun (per Ticket) ── AgentStep (log tiap langkah)
```

## 4. Alur MVP yang dibangun

1. **Config** — isi koneksi Docmost/Jira/GitHub + mapping + AI.
2. **PRD** — sync dari Docmost (atau paste manual), lihat markdown.
3. **Generate** — AI baca PRD → `TicketDraft[]` (JSON terstruktur).
4. **Review** — edit draft, pilih, **Approve**.
5. **Push** — approve → create issue ke Jira (stub bila token belum ada).
6. **Kanban** — kolom dari mapping, kartu dari ticket, drag → transisi Jira.
7. **Run** — pindah ke In Progress → `WorkflowRun` + `AgentStep` (skeleton loop) → PR.

## 5. Guards

- Semua kredensial dari env / DB terenkripsi; **tidak** disimpan di client.
- Integrasi memakai interface, bisa di-`mock` saat dev.
- Zod memvalidasi semua input API & output AI.

## 6. Milestone eksekusi (yang dikerjakan sekarang)

- **S1** Scaffold Next.js + Tailwind + TS.
- **S2** shadcn/ui + layout (sidebar, header, tema).
- **S3** Prisma schema + seed.
- **S4** Adapter integrasi + AI service.
- **S5** API routes.
- **S6** UI: Dashboard, Kanban, Drafts, PRD, Config.
- **S7** Build & lint hijau.

Fase lanjutan (belum): worker Temporal, sandbox Docker, Verifier, MCP server, VS Code extension.

## 7. Revisi: Model Project-centric

User **membuat Project lebih dulu**, lalu mengonfigurasi integrasi di dalamnya.

```
Project (root)
 ├─ project_integrations  (per kind: llm | docmost | jira | github)
 │      mode: "api"  -> baseUrl + secret (REST)
 │      mode: "mcp"  -> mcpUrl + token
 ├─ prd_documents / ticket_drafts / kanban_columns / tickets / workflow_runs
```

Perubahan kunci:

- Tabel `integrations` & `project_mappings` global **dihapus**, digantikan `projects` +
  `project_integrations`. Target (jiraProjectKey, githubRepo, docmostSpace, dst) menjadi kolom
  `projects`.
- Semua entitas turunan memakai `projectId` (bukan `mappingId`).
- Sub-rute: `/projects`, `/projects/[projectId]/{kanban,prd,drafts,runs,settings}`.
- **Secret terenkripsi** (AES-256-GCM, `APP_ENCRYPTION_KEY`). Non-secret disimpan di `config` jsonb.
- Adapter menjadi **factory berbasis config** (bukan env global): `createDocmostClient(cfg)`,
  `createJiraClient(cfg)`, `createGithubClient(cfg)`, `chatJson(llmCfg, ...)`.
- **MCP**: `createMcpClient({ url, token })` (JSON-RPC 2.0 over streamable HTTP, dukung JSON & SSE),
  plus `testIntegrationAction` untuk cek koneksi per integrasi.
- `resolveProjectIntegrations(projectId)` menyatukan konfigurasi efektif (api + mcp) untuk dipakai
  actions.
