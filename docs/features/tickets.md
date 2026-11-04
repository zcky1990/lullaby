# Tickets

## Sumber data

`GET /api/projects/:id/tickets` menggabungkan:

- Tiket **lokal** yang belum punya `jira_key` (atau belum muncul di remote)
- Issue **Jira** (bila integrasi `jira` dikonfigurasi) — `source: "jira"`
- Task **ClickUp** dari `listId` (bila integrasi `clickup` dikonfigurasi) — `source: "clickup"`

Respons menyertakan `providers: ["jira" | "clickup", …]` dan `errors` per provider bila ada.

## Status Kanban

Kolom kanonik: Backlog → To Do → In Progress → Test → Done.

Matcher status mentah (Jira/ClickUp/lokal) ada di `web/src/lib/ticket-columns.ts` dan
`src/tickets/status.ts` (mis. `Doing` → In Progress, `Open` → To Do).

Drag card memanggil `moveTicket`:

- Lokal → `PATCH /local-tickets/:id` `{ status }`
- Jira / ClickUp → `POST .../tickets/:key/transition` `{ status, source? }`

## Tiket lokal

- Dibuat dari UI (`TicketCreateDialog`) atau tool chat `create_ticket`
- Edit deskripsi rich text di `TicketDetailDialog`
- Hapus hanya selama belum punya `jira_key` (remote key)
- Sync manual → Jira issue atau ClickUp task; set `jira_key`, `sync_provider`, `sync_status`
- Body sync: `{ provider?: "jira" | "clickup" }` (default: Jira jika ada, else ClickUp)

## ClickUp

Konfigurasi: Project Settings → Integrations → Ticket → ClickUp (`apiToken`, `listId`, …).
Client: `src/integrations/clickup.ts`. Skill: `clickup-api`.

## Automation

Jika Global Settings → Automation aktif, drag **To Do → In Progress** memicu Chat Build.
Detail: [automation.md](../automation.md).
