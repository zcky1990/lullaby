# Automation: Auto-Build on In Progress

Bagah ke [indeks dokumentasi](README.md).

## What it does

When **Auto-build on In Progress** is enabled, dragging a ticket on the Kanban board from
**To Do** to **In Progress** automatically:

1. Opens the Chat sidebar
2. Starts a **new Build** session
3. Sends a prompt with the ticket key, summary, and description (when available)
4. Lets the agent work in the project workspace; file writes still go through the **Review** tab

Default is **off**.

## How to enable

1. Open **Global Settings** → **Automation**
2. Toggle **Auto-build on In Progress** to **Aktif**
3. Ensure at least one **LLM Provider** is configured (Global Settings → LLM Providers)
4. Open a project with a workspace path set

## Trigger rules

| Condition | Result |
| --- | --- |
| Setting off | No auto chat |
| Move is not To Do → In Progress | No auto chat |
| No LLM provider | No auto chat |
| Chat already sending / waiting for Review approval | Event ignored (no double run) |
| Ticket description unavailable | Prompt still runs with key + summary |

Column matching uses the same canonical Kanban rules as the board (e.g. `Doing` /
`In Development` count as In Progress; `Open` / `ToDo` count as To Do).

## Prompt shape

```text
Kerjakan tiket PROJ-1: Short title

Optional description body…

Implementasikan perubahan di workspace project ini. Jelaskan singkat apa yang kamu ubah.
```

## API

| Method | Path | Body / response |
| --- | --- | --- |
| `GET` | `/api/settings/automation` | `{ "autoBuildOnInProgress": boolean }` |
| `PUT` | `/api/settings/automation` | `{ "autoBuildOnInProgress": boolean }` |

Stored in `app_settings` under key `auto_build_on_in_progress` (`"true"` / `"false"`).

## Out of scope (v1)

- Auto-accepting Review hunks
- Auto-moving the ticket to Test/Done when the agent finishes
- Trigger from the ticket detail status dropdown (Kanban drag only)

## Code map

- Settings: `src/server/routes/settings.ts`, `src/config/schema.ts` (`AutomationSettingsInput`)
- Status helpers: `src/tickets/status.ts`, `web/src/lib/ticket-columns.ts`
- Client event: `web/src/lib/auto-build-events.ts`
- UI: `web/src/components/AutomationSettings.tsx`
- Trigger: `web/src/App.tsx` (`moveTicket`)
- Chat start: `web/src/components/ChatSidebar.tsx`
