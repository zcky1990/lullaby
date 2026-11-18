# Workflow field reference

Aligned with `src/server/workflow/parse.ts` (Zod `.strict()`). Unknown keys fail.

## Top-level

| Field | Required | Notes |
| --- | --- | --- |
| `name` | no | `a-zA-Z0-9_.-`; default = file slug |
| `description` | no | Short summary |
| `type` | no | Optional label |
| `params` | no | Run dialog inputs |
| `env` | no | map → step env |
| `working_dir` | no | Relative to workspace |
| `timeout_sec` | no | Whole-run timeout |
| `defaults` | no | Shared step defaults |
| `llm` | no | Default provider/model/role for AI steps |
| `steps` | **yes** | ≥1 |
| `schedule` | no | In-process cron |
| `on` | no | Event triggers |

Not allowed: `tags`, `preconditions`, `max_active_runs`, `mail_on`, `hist_retention_days`.

## Params

Only `name`, `type`, `default`, `description`. **No** `required`, **no** `options`.

```yaml
params:
  - name: BRANCH
    type: string          # string | integer | number | boolean | agent
    description: Target branch
    default: main
```

`type: agent` → multiline prompt in Run dialog. Access: `${params.BRANCH}` or `${BRANCH}`.

## Shell step

```yaml
- id: lint
  depends: [install]       # string or list
  run: npm run lint
  working_dir: apps/web    # optional, under workspace
  env:
    NODE_ENV: test
  output: LOG              # → ${LOG} / ${steps.lint.output}
  outputs: [status]        # or [{ name: status }]
  retry_policy:
    limit: 2
    interval_sec: 1
  timeout_sec: 120
```

Not allowed on steps: `shell`, `name`, `description`, `continue_on_error`, `retry`.
Use `continue_on` (step id) or `retry_policy: { limit, interval_sec }`.

Stdout/stderr capped (~200KB). Exit ≠0 fails the step unless routed via `continue_on`.

## AI — `chat.completion`

```yaml
- id: summarize
  action: chat.completion
  depends: collect
  with:
    prompt: "..."           # required
    system: "..."           # optional
    provider: "My Provider" # or inherit llm.provider / first provider
    model: gpt-4.1-mini
    role: Reviewer          # optional Roles name
    temperature: 0.2
    max_tokens: 1024
  output: SUMMARY
```

One shot, no tools. Prefer for classify / summarize / draft.

## AI — `agent`

```yaml
- id: implement
  action: agent
  with:
    prompt: "${params.TASK}"  # required
    mode: build               # build | plan (default build)
    provider: "..."
    model: "..."
    role: "..."
    max_steps: 20             # optional hard cap
  output: RESULT
```

Tool loop (workspace + document/ticket tools as enabled). File writes apply
immediately — no Review. Prefer for implement / explore / multi-step fixes.

### When to choose which

| Goal | Action |
| --- | --- |
| Summarize / draft text | `chat.completion` |
| Edit files / explore repo | `agent` + `mode: build` |
| Analysis without writes | `agent` + `mode: plan` |

## Notification

```yaml
- id: notify
  action: notification
  with:
    channel: team-slack    # name from Global Settings → Notifications
    message: |
      Done: ${RESULT}
```

Requires a configured channel (Slack / Google Chat / Discord / webhook).

## Router

```yaml
- id: route
  action: router.route
  with:
    value: ${steps.check.outputs.status}
    routes:
      success: [deploy]
      failed: [alert]
```

Only listed targets become eligible; others after the router are skipped unless
reached via another path.

## LLM defaults

```yaml
llm:
  provider: OpenAI Work
  model: gpt-4.1-mini
  role: Reviewer
```

Step `with.provider` / `model` / `role` override. Match exact names from Global
Settings → LLM Providers / Roles.

## Schedule & events

```yaml
schedule:
  cron: "0 2 * * *"
  enabled: true
  timezone: Asia/Jakarta   # optional IANA

on:
  - event: ticket.transitioned
    status: In Progress
```

See `web/src/docs/wiki-cron.md` for Cron UI and event list.

## Parallelism & limits

- Steps with no unfinished deps can run together (max 8 concurrent).
- Step log ~200KB; run history soft-capped (~200 runs, ~2000 step rows).
- Cancel from UI stops the run; in-flight shell may still finish.

## Example: Plan then Build

```yaml
name: plan-then-build
params:
  - name: FEATURE
    type: agent
    description: Fitur yang diminta
llm:
  provider: OpenAI Work
steps:
  - id: plan
    action: agent
    with:
      mode: plan
      prompt: |
        Buat rencana singkat untuk: ${params.FEATURE}
      max_steps: 8
    output: PLAN
  - id: build
    depends: plan
    action: agent
    with:
      mode: build
      prompt: |
        Implementasikan sesuai rencana:
        ${PLAN}
      max_steps: 25
    output: DONE
  - id: notify
    depends: build
    action: notification
    with:
      channel: team-slack
      message: "Selesai.\n${DONE}"
```

## Example: shell + retry

```yaml
name: flaky-e2e
timeout_sec: 1800
steps:
  - id: e2e
    run: npm run test:e2e
    retry_policy:
      limit: 3
      interval_sec: 5
    timeout_sec: 600
```
