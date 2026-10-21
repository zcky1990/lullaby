# AGENTS.md

## Commands

- Build client + assets: `deno task build` (`build:web` + `assets`)
- Type check (backend): `deno task check` (`deno check --desktop main.ts`)
- Type check (client): `cd web && npx tsc --noEmit`
- Lint: `deno task lint` (`deno lint`)
- Format: `deno task fmt` (`deno fmt`)
- Test: `deno task test` (`deno test -A`)
- Dev (desktop + HMR): `deno task dev`
- Client-only dev server: `deno task web:dev`
- Build desktop app: `deno task desktop`
- Run without desktop shell: `deno task start`

Always run `deno task build` (so `src/ui/assets.generated.ts` matches `web/`), then
`deno task check`, `deno task lint`, `deno task test`, and `cd web && npx tsc --noEmit` before
finishing a change.

## Conventions

- Runtime: Deno 2.9+ (backend). No `package.json` at repo root; the UI lives in `web/` (Node/npm).
- TypeScript strict; no comments in code unless necessary.
- **UI**: React 19 + Vite + Tailwind v4 + shadcn/ui in `web/`. Components in `web/src/components/ui`
  are shadcn (copy-in); feature components sit in `web/src/components`. Use the `@/` alias. Never
  edit `src/ui/assets.generated.ts` by hand.
- **Monaco**: configured in `web/src/lib/monaco.ts` (local bundle + workers via Vite `?worker`);
  editor theme comes from `ThemeProvider` (`web/src/components/ThemeProvider.tsx`). Monaco and the
  markdown viewer are **lazy-loaded** (`MonacoViewer`, `MarkdownView`) to keep the main chunk small.
- **Markdown**: `MarkdownView` uses `react-markdown` + `remark-gfm`, renders ```mermaid blocks via
  `Mermaid` (mermaid lib, theme follows `ThemeProvider`), and styles with the Tailwind `prose`
  plugin.
- **Tabs**: the main area is tabbed (`TabsBar`); each activity-bar menu is a **singleton tab** whose
  content embeds its own side panel (Workspace/Explorer/Document/Settings use a two-pane layout;
  Ticket = Kanban; Global = one page). State lives in `App.tsx` (tab list, and file/doc selection).
- **Documents**: `DocumentPanel` switches between **Local** (`.md` files under
  `projects.document_path`) and Docmost. Local docs are renamed/saved on disk; manual sync
  (`POST /local-documents/sync`) creates/updates the Docmost page and stores `page_id` in
  `local_documents`.
- **Tickets**: `local_tickets` (SQLite) are created locally (UI `TicketCreateDialog` + AI tool
  `create_ticket`); `GET /tickets` merges unsynced local tickets with Jira. Syncing is manual
  (`POST /local-tickets/:id/sync` → Jira issue) and sets `jira_key`/`sync_status`.
- **Skills**: `src/server/skills.ts` discovers `SKILL.md` folders (frontmatter `name`/`description`)
  from `appDataDir()/skills` (global) and `<workspace>/.agents/skills` (workspace wins on duplicate
  names). Chat injects the skill list into the system prompt and exposes a read-only `use_skill`
  tool (progressive disclosure; allowed in Plan mode). Enabled state lives in `app_settings`
  (`skills_enabled`, `skills_disabled`); UI is Global Settings → Skills.
- **MCP**: global server config (`McpSettings`) is stored in `app_settings` (`mcp_servers` JSON;
  stdio command/args/env or http url/headers) plus `mcp_enabled` and `mcp_disabled_tools`.
  `POST /api/settings/mcp/tools` connects with `initialize` + `tools/list` (`src/server/mcp.ts`,
  stdio or http) so each server's tools can be discovered and enabled/disabled. Tool execution from
  chat is not wired yet.
- **List/menus**: `ActivityBar` (left rail) opens tabs in the main area (`TabsBar`).
  Workspace/Explorer/Document keep a **separate** side panel in `<aside>` (`WorkspacePanel`,
  `FileTreePanel`, `DocumentPanel`); files/documents open as their own tabs. Project Settings and
  Global Settings have no outer panel — their section nav (`SettingsPanel`, `GlobalSettingsPanel`)
  lives inside the tab. In Project Settings each form/section is a **`Collapsible`**
  (`CollapsibleSection`).
- UI build outputs are embedded (`scripts/build-assets.ts` -> `src/ui/assets.generated.ts`) so the
  desktop binary is self-contained; never read UI files from disk at runtime.
- Integration credentials (API token/key) are entered as normal text and stored **in the integration
  `config`** (and `llm_providers.api_key`). They are local to this desktop app; do not log them or
  send them to the renderer unnecessarily.
- Validate all API inputs and integration configs with Zod (`src/config/schema.ts`).
- Desktop-only globals: `deno check --desktop main.ts` loads `lib.deno.desktop.d.ts`; prefer that
  over casts. `src/desktop/window.ts` guards `Deno.BrowserWindow` at runtime so `deno run` still
  works (returns null window).
- Local API is guarded by a per-session token cookie (`src/server/session.ts`); `/api/health` is
  open, everything else requires the cookie (set when the HTML shell is served) or the `x-app-token`
  header.
- **Filesystem reads must go through `src/fs/workspace.ts`** (path-traversal guarded, capped size).
  Writes (chat `write_file`) go through `writeWorkspaceFile` and require **user approval**
  (`src/server/chat.ts`: `once` / `always` / `deny`).
- Persistence uses `node:sqlite` (`src/db/db.ts`); keep queries parameterized and add columns via
  `ensureColumn` migrations.

## Layout

- `main.ts` — entry: bootstrap, window, server.
- `web/` — Vite + React + shadcn/ui client (built to `web/dist`).
  - `web/src/App.tsx` — shell (activity bar + panel + main).
  - `web/src/components/` — feature components (ActivityBar, `TabsBar`, Workspace/FileTree/Document/
    Ticket/Settings panels, `TicketKanban`, `TicketDetailDialog`, `MonacoViewer`,
    `MarkdownView`/`Mermaid`, `SettingsView` + `IntegrationForm`/`LlmProviderForm`,
    `GlobalSettingsView`, `ChatSidebar`, `ThemeProvider`).
  - `web/src/components/reui/` — vendored ReUI components (`kanban.tsx`, from `@reui/kanban`; needs
    `@base-ui/react` + `@dnd-kit/*`).
  - `web/src/components/ui/` — shadcn components (button, card, input, label, select, badge,
    dropdown-menu, dialog, …).
  - `web/src/lib/` — `api.ts`, `integrations.ts`, `monaco.ts`, `bindings.ts`, `utils.ts`.
- `scripts/build-assets.ts` — embeds `web/dist` into `src/ui/assets.generated.ts`.
- `src/core` — paths, logger, bootstrap.
- `src/config` — Zod schemas (`schema.ts`).
- `src/db` — SQLite access.
- `src/fs` — workspace file tree + file reader.
- `src/secrets` — legacy env/keychain helper (unused; kept for reference/tests).
- `src/integrations` — docmost/jira/github/llm clients + health-check.
- `src/server` — router, SSE, event bus, static asset serving, chat agent engine (`chat.ts`:
  tool-calling, plan/build modes, file write approval, chat sessions, diff tracking, image/text
  attachments; `diff.ts`: line diff).
- `src/desktop` — window, bindings, native dialogs.
- `src/ui/assets.generated.ts` — generated embedded client bundle.
