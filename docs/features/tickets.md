# Tickets

## Sumber data

`GET /api/projects/:id/tickets` menggabungkan:

- Tiket **lokal** yang belum punya `jira_key` (atau belum tersync)
- Issue **Jira** dari integrasi project (bila dikonfigurasi)

## Status Kanban

Kolom kanonik: Backlog → To Do → In Progress → Test → Done.

Matcher status mentah (Jira/lokal) ada di `web/src/lib/ticket-columns.ts` dan
`src/tickets/status.ts` (mis. `Doing` → In Progress, `Open` → To Do).

Drag card memanggil `moveTicket`:

- Lokal → `PATCH /local-tickets/:id` `{ status }`
- Jira → `POST .../tickets/:key/transition` `{ status }`

## Tiket lokal

- Dibuat dari UI (`TicketCreateDialog`) atau tool chat `create_ticket`
- Edit deskripsi rich text di `TicketDetailDialog`
- Hapus hanya selama belum punya `jira_key`
- Sync manual → issue Jira; set `jira_key` + `sync_status`

## Automation

Jika Global Settings → Automation aktif, drag **To Do → In Progress** memicu Chat Build.
Detail: [automation.md](../automation.md).
