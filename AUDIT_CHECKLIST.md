# Application Audit Checklist

_Generated via rails-audit-thoughtbot skill methodology (adapted for Deno desktop + React)_

**Generated**: 2026-10-24\
**Application**: deno-app (rnd-workflow)\
**Runtime**: Deno 2.9.7 · TypeScript 6.0.3 · React 19 (web/)\
**Audit Scope**: Full application (`src/`, `web/`, `test/`, `main.ts`)\
**Prior audit**: See also `feature/AUDIT.md` (2026-10-16 tooling/UI pass — many items closed)

---

## Executive Summary

| Category            | Critical | High   | Medium | Low    | Total  |
| ------------------- | -------- | ------ | ------ | ------ | ------ |
| Security            | 2        | 2      | 7      | 4      | 15     |
| Testing             | 0        | 5      | 2      | 0      | 7      |
| Server / API design | 0        | 2      | 4      | 2      | 8      |
| Database            | 0        | 0      | 4      | 2      | 6      |
| Integrations        | 0        | 0      | 3      | 1      | 4      |
| Frontend / Desktop  | 0        | 1      | 5      | 5      | 11     |
| **Total**           | **2**    | **10** | **25** | **14** | **51** |

### Key Findings

1. **Auth bypass on MCP/skills routes** — handlers run _before_ `isAuthorized()`; unauth
   `POST /api/settings/mcp/tools` can spawn arbitrary `Deno.Command` (local RCE).
2. **`deno task start` binds `0.0.0.0`** — combined with (1), MCP RCE may be LAN-reachable.
3. **Session cookie missing `HttpOnly`** + ticket HTML XSS amplifies full API/terminal takeover.
4. **Test coverage Low** — 2 test files / ~25 cases; critical paths (auth, workspace, chat review,
   git, terminal) untested.

---

## How to use this checklist

- Mark `[x]` when fixed and verified (test or manual repro).
- Severity: **Critical** → fix immediately · **High** → this sprint · **Medium** → backlog · **Low**
  → polish.
- Re-run `deno task check && deno task lint && deno task test` after security fixes.

---

## 1. Security Checklist

### Critical

- [x] **SEC-C1** Auth-gate MCP & skills routes\
      **File**: `src/server/router.ts`\
      **Issue**: `/api/skills`, `/api/settings/skills`, `/api/settings/mcp`,
      `/api/settings/mcp/tools` return before `isAuthorized()`.\
      **Fix**: Move all handlers after the auth check (only `/api/health` public). Add regression
      test: unauthenticated POST → 401.\
      **Verify**: `curl -X POST http://127.0.0.1:$PORT/api/settings/mcp/tools -d '{}'` → 401.

- [x] **SEC-C2** Bind loopback on non-desktop serve\
      **File**: `main.ts` + `deno.json` `start` task\
      **Issue**: `Deno.serve` defaults to `0.0.0.0`; desktop sets `127.0.0.1` via
      `DENO_SERVE_ADDRESS`, `start` does not.\
      **Fix**: Always `hostname: "127.0.0.1"` unless explicit opt-in for LAN.

### High

- [x] **SEC-H1** Set `HttpOnly` on session cookie\
      **File**: `src/server/router.ts`\
      **Issue**: `app_token` cookie is JS-readable → any XSS steals full API access (FS, git,
      terminal, LLM keys).\
      **Fix**: `HttpOnly; SameSite=Strict` (add `Secure` if HTTPS). Prefer cookie-only auth in
      webview.

- [x] **SEC-H2** Sanitize ticket HTML at render\
      **File**: `web/src/components/TicketDetailDialog.tsx` + `web/src/lib/sanitize-html.ts`\
      **Issue**: `dangerouslySetInnerHTML` on descriptions; Jira strings are not sanitized
      (`src/integrations/jira.ts`). Local tickets sanitized on write only.\
      **Fix**: Always sanitize before render (reuse `sanitizeHtml` / DOMPurify); never trust remote
      HTML.

### Medium

- [x] **SEC-M1** Symlink escape in `resolveWithin`\
      **File**: `src/fs/workspace.ts`\
      **Fix**: `realpath` root + target; require target under real root.

- [x] **SEC-M2** Mask secrets in API responses\
      **File**: `src/server/router.ts` `serializeLlm` / `serializeIntegration`\
      **Fix**: Return placeholders (`••••`); accept write-only updates when field non-empty.

- [x] **SEC-M3** Remove `dataDir` from public `/api/health`\
      **File**: `src/server/router.ts`

- [x] **SEC-M4** Linux terminal: don’t interpolate `$SHELL` into `-c`\
      **File**: `src/server/terminal.ts`\
      **Fix**: Pass shell as argv (Darwin pattern) / avoid `-c` interpolation.

- [x] **SEC-M5** Prefer maintained HTML sanitizer\
      **Files**: `src/core/html.ts` (`sanitize-html`), `web/src/lib/sanitize-html.ts` (DOMPurify);
      render path still sanitizes in `TicketDetailDialog` / `RichTextEditor`.

- [x] **SEC-M6** Zod-validate ticket transition `status`\
      **File**: `src/server/router.ts` + `TicketTransitionInput`

- [x] **SEC-M7** Kind-validate integration `config` on save\
      **File**: `upsertIntegrationHandler` — apply Docmost/Jira/Github schemas at persist, not only
      on test.

### Low

- [x] **SEC-L1** Document / add `Secure` cookie when TLS used (komentar di router cookie)
- [x] **SEC-L2** Avoid string interpolation in dialog scripts if titles become user-controlled
      (`src/desktop/dialogs.ts`)
- [x] **SEC-L3** Keep `ensureColumn` identifiers allowlisted only (`src/db/db.ts`)
- [x] **SEC-L4** Timing-safe token compare in `isAuthorized` / `session.ts`

### Security — already PASS

| Check                                   | Status                 |
| --------------------------------------- | ---------------------- |
| Parameterized SQLite CRUD               | PASS                   |
| Git argv + `--` path guards             | PASS                   |
| Most `/api/*` behind session token      | PASS (except SEC-C1)   |
| Logger redacts api_key/token/password   | PASS                   |
| Broad Zod on most mutations             | PASS (gaps: SEC-M6/M7) |
| Mermaid `securityLevel: "strict"`       | PASS                   |
| Open redirects                          | PASS                   |
| Embedded static UI (no disk UI paths)   | PASS                   |
| Body / file size caps                   | PASS                   |
| Chat writes via hunk review before disk | PASS                   |

---

## 2. Testing Checklist

**Coverage estimate**: Low — 26 backend modules, **2** test files, **25** `Deno.test` cases, **0**
frontend tests.

### Critical / High gaps

- [x] **TEST-C1** Request-level auth: unauthorized `/api/*` → 401; cookie + `x-app-token` accepted\
      **Files**: `session.ts`, `router.ts` (`test/unit.test.ts`)

- [x] **TEST-C2** `resolveWithin` path traversal + symlink cases\
      **File**: `src/fs/workspace.ts` (`test/unit.test.ts`)

- [x] **TEST-C3** Chat hunk accept/reject/all against temp workspace\
      **File**: `src/server/chat.ts` (`decideChatChange`, `decideAllChatChanges`)

- [x] **TEST-C4** Git `checkedPaths` / stage / commit / checkout guards\
      **File**: `src/integrations/git.ts`

- [x] **TEST-C5** Terminal WS rejects without token\
      **File**: `src/server/terminal.ts` / router auth

- [x] **TEST-H1** Local ticket → Jira sync + `jira_key` state (`test/db.test.ts`)
- [x] **TEST-H2** LLM provider CRUD / resolve for chat (`test/db.test.ts` CRUD + role null-out)

### Medium

- [x] **TEST-M1** Enable `deno test --coverage` in CI + optional thresholds
- [x] **TEST-M2** Frontend: vitest for pure helpers in `web/src/lib/` (`npm test` in `web/`)

### Testing — already PASS

| Check                                 | Status |
| ------------------------------------- | ------ |
| `deno task test` defined + CI runs it | PASS   |
| Schema smoke tests (partial)          | PASS   |
| `sanitizeHtml` / ADF helpers          | PASS   |
| Local documents path escape           | PASS   |
| Diff hunk apply algorithm             | PASS   |
| Mock Docmost/Jira HTTP (partial)      | PASS   |

---

## 3. Server / API Design Checklist

### High

- [x] **SRV-H1** Split `router.ts` by domain routes (`http.ts`, `serializers.ts`, `routes/*`; router
      ~1271 LOC)
- [x] **SRV-H2** Split `chat.ts`: LLM / tools / review / tickets / agent modules under
      `src/server/chat/`

### Medium

- [x] **SRV-M1** Remove or rewire dead `approveChat` / `pending` path (hunk decisions are the live
      model)
- [x] **SRV-M2** Single write pipeline (drop dual `prepareWriteChange` vs `writeFileWithChange`
      confusion)
- [x] **SRV-M3** LLM chat completions: raise timeout above default 15s (e.g. 120s)
- [x] **SRV-M4** `readJson` oversize/invalid → proper 413 / `invalid_json` (not silent `{}`)

### Low

- [x] **SRV-L1** Chat tool args (`create_ticket`) parse with same Zod as API
- [x] **SRV-L2** Log corrupt JSON defaults at debug instead of silent `[]`/`{}`

### Server — already PASS

| Check                                                             | Status |
| ----------------------------------------------------------------- | ------ |
| Smaller modules sized well (session, bus, sse, mcp, diff, skills) | PASS   |
| Shared timed `request()` for integrations                         | PASS   |
| MCP list-tools timeout + tool caps                                | PASS   |
| Workspace FS via guarded helpers                                  | PASS   |

---

## 4. Database Checklist

### Medium

- [x] **DB-M1** Indexes on hot columns: `chat_sessions(project_id)`, `chat_messages(session_id)`,
      `local_tickets(project_id)`, `events(created_at)`
- [x] **DB-M2** Transactions for multi-step writes (`appendChatMessage`, `deleteChatSession`,
      `moveLocalDocumentMeta`, LLM migrate)
- [x] **DB-M3** FK or null-out for `roles.provider_id` → `llm_providers`
- [x] **DB-M4** `getLocalDocumentMeta(projectId, path)` instead of list-all + find

### Low

- [x] **DB-L1** Keep `ensureColumn` internal-only (allowlisted tables/columns)
- [x] **DB-L2** Expand DB integration smoke tests (`test/db.test.ts` + `RND_APP_DATA_DIR`)

### Database — already PASS

| Check                                          | Status |
| ---------------------------------------------- | ------ |
| Parameterized queries                          | PASS   |
| `PRAGMA foreign_keys` + WAL                    | PASS   |
| `ensureColumn` additive migrations             | PASS   |
| `sanitizeHtml` on ticket descriptions at write | PASS   |
| `pruneEvents(1000)` on bootstrap               | PASS   |

---

## 5. Integrations Checklist

### Medium

- [x] **INT-M1** Redact credentials in GET serializers (see SEC-M2)
- [ ] **INT-M2** SSRF policy for `baseUrl` (private-IP block or confirm dialog) — ditunda:
      Ollama/LAN lokal sengaja diizinkan
- [x] **INT-M3** Docmost sync: handle create-then-update partial failure (orphan page / desync)

### Low

- [x] **INT-L1** Cover `jira.createTicket` in integration tests

### Integrations — already PASS

| Check                                              | Status |
| -------------------------------------------------- | ------ |
| Timed HTTP helper                                  | PASS   |
| Kind-specific config validated on **test**         | PASS   |
| Sync paths generally awaited (not fire-and-forget) | PASS   |
| Git workspace containment                          | PASS   |

---

## 6. Frontend / Desktop Checklist

### High

- [x] **FE-H1** Ticket HTML XSS (see SEC-H2) + password/`type=password` for secret fields\
      **Files**: `LlmProviderForm`, `IntegrationForm`, `McpSettings`

### Medium

- [x] **FE-M1** Restrict chat attachment MIME; block `data:image/svg+xml`\
      **File**: `ChatSidebar.tsx`
- [x] **FE-M2** Sanitize RichTextEditor paste / onInput
- [x] **FE-M3** Fail closed: terminal cwd must be project workspace (avoid silent `$HOME`)
- [x] **FE-M4** Split `App.tsx` into domain hooks (`useEditorTabs`; tickets/git masih di App)
- [x] **FE-M5** Harden `api.ts`: `ApiError` + status + timeout/AbortSignal (chat 180s)

### Low

- [x] **FE-L1** Stable list keys in chat (not index-only)
- [x] **FE-L2** Kanban: avoid remount on every status change (`boardKey`)
- [x] **FE-L3** Review listener: don’t re-subscribe on every `tabs` change
- [x] **FE-L4** a11y: `aria-current` on ActivityBar, `aria-expanded` on tree, label contenteditable
- [x] **FE-L5** Fix ChatSidebar copy: LLM is Global Settings, not Project Settings

### Frontend / Desktop — already PASS

| Check                                                             | Status |
| ----------------------------------------------------------------- | ------ |
| Desktop `BrowserWindow` runtime guard                             | PASS   |
| Bindings minimal (`appInfo`, `chooseDirectory`, `checkDirectory`) | PASS   |
| UI cannot bypass server FS guards                                 | PASS   |
| Lazy Monaco + Markdown (AGENTS.md)                                | PASS   |
| Singleton tabs / activity-bar pattern                             | PASS   |
| Markdown via `react-markdown` (no rehype-raw)                     | PASS   |

---

## Recommendations by Horizon

### Quick wins (do now)

1. [x] Move MCP/skills routes behind auth + regression test (**SEC-C1**)
2. [x] Force `127.0.0.1` bind for `start` (**SEC-C2**)
3. [x] `HttpOnly` cookie (**SEC-H1**)
4. [x] Sanitize ticket HTML on render (**SEC-H2**)

### Short-term (this sprint)

1. [x] Unit tests: `resolveWithin`, auth 401 (**TEST-C1–C2**; C3 chat hunks still open)
2. [x] Mask API secrets + password inputs (**SEC-M2**, **FE-H1**)
3. [x] Zod ticket transition + integration config on save (**SEC-M6/M7**)
4. [x] Longer LLM timeout (**SRV-M3**)
5. [x] Symlink-aware path resolve (**SEC-M1**)

### Long-term (tech debt)

1. [x] Split `router.ts` / `chat.ts` / extract `useEditorTabs` (lebih banyak App hooks opsional)
2. [x] DB indexes + transactions
3. [x] Coverage reporting in CI; thin vitest for `web/src/lib`
4. [x] Maintained HTML sanitizer (`sanitize-html` + DOMPurify); SSRF policy for baseUrl ditunda
       (Ollama/LAN lokal)

---

## Files Analyzed (summary)

| Area                                 | Notable sizes | Issues (approx.)                     |
| ------------------------------------ | ------------- | ------------------------------------ |
| `src/server/router.ts`               | 1502 LOC      | Auth bypass, fat router, serializers |
| `src/server/chat.ts`                 | 1171 LOC      | SRP, dead approval path, timeout     |
| `src/db/db.ts`                       | 828 LOC       | Indexes, transactions                |
| `web/src/App.tsx`                    | 1595 LOC      | State hub                            |
| `web/src/components/ChatSidebar.tsx` | 824 LOC       | Attachments, copy drift              |
| `src/fs/workspace.ts`                | —             | Symlink                              |
| `src/server/terminal.ts`             | —             | SHELL interpolation (Linux)          |
| `test/`                              | 2 files       | Thin critical-path coverage          |

---

## Appendix: Suggested ongoing tools

| Tool                                     | Purpose                              |
| ---------------------------------------- | ------------------------------------ |
| `deno task check` / `lint` / `test`      | Gate every change (per AGENTS.md)    |
| `deno test --coverage`                   | Track backend coverage               |
| `cd web && npx tsc --noEmit`             | Client type gate                     |
| Periodic re-run of this checklist        | Especially after new `/api/*` routes |
| Optional: npm `vitest` for `web/src/lib` | Pure helper tests                    |

---

## Severity reference

| Severity | Meaning                                        | Examples in this audit                           |
| -------- | ---------------------------------------------- | ------------------------------------------------ |
| Critical | RCE, auth bypass, LAN exposure                 | SEC-C1, SEC-C2                                   |
| High     | Significant exposure / untested critical paths | HttpOnly, XSS, missing auth/workspace/chat tests |
| Medium   | Maintainability, hardening, partial validation | Fat modules, indexes, secret masking             |
| Low      | Style, defense-in-depth, polish                | a11y, keys, Secure cookie docs                   |
