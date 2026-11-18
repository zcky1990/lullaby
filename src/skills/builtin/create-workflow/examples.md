# Workflow field reference

Condensed from `web/src/docs/workflow-docs.md`. Prefer that file if this conflicts.

## Top-level

| Field | Required | Notes |
| --- | --- | --- |
| `name` | no | Display name; default = file slug |
| `description` | no | Short summary |
| `tags` | no | string[] |
| `params` | no | Run dialog inputs |
| `env` | no | map → step env |
| `working_dir` | no | Relative to workspace |
| `timeout_sec` | no | Whole-run timeout |
| `max_active_runs` | no | Soft; engine still 1 active |
| `preconditions` | no | `{ run: "..." }` gates |
| `mail_on` | no | reserved |
| `hist_retention_days` | no | reserved |
| `llm` | no | Default provider/model/role for AI steps |
| `steps` | **yes** | ≥1 |
| `schedule` | no | In-process cron |
| `on` | no | Event triggers |

## Params

```yaml
params:
  - name: BRANCH
    type: string          # string | number | boolean | agent
    description: Target branch
    default: main
    required: false
    options: [main, develop]   # optional select
```

`type: agent` → multiline prompt in Run dialog. Access: `${params.BRANCH}` or `${BRANCH}`.

## Shell step

```yaml
- id: lint
  name: Lint
  description: Optional
  depends: [install]       # string or list
  run: npm run lint
  shell: bash              # optional
  working_dir: apps/web    # optional, under workspace
  env:
    NODE_ENV: test
  output: LOG              # → ${LOG} / ${steps.lint.output}
  outputs:                 # optional named captures
    - name: status
  continue_on_error: false
  retry:
    max: 2
    delay_ms: 1000
  timeout_sec: 120
```

Stdout/stderr capped (~200KB). Exit ≠0 fails the step unless `continue_on_error`.

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

## Example: shell + retry + precondition

```yaml
name: flaky-e2e
preconditions:
  - run: test -f package.json
timeout_sec: 1800
steps:
  - id: e2e
    run: npm run test:e2e
    retry:
      max: 3
      delay_ms: 5000
    timeout_sec: 600
    continue_on_error: false
```
