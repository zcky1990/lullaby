---
name: create-workflow
description: >-
  Author Lullaby workflow YAML (DAG, shell, chat.completion, agent, router,
  notification, params, schedule/on). Use when the user asks to create, draft,
  or edit a workflow, .workflows YAML, cron workflow, or Workflows automation.
---

# Create workflow

Build a valid Lullaby workflow YAML from the user's goal. Write the file only;
never auto-run (no run API). User starts via Workflows → **Run**, Cron, or `on`.

Companion detail: [examples.md](examples.md) (same folder). When the open
workspace is this app repo, also see `web/src/docs/wiki-workflow.md` and
`web/src/docs/workflow-docs.md`.

## Process

1. Clarify goal: shell CI, AI review/implement, notify, scheduled/event, or mix.
2. Slug: lowercase `a-z0-9_.-`, no leading dot → `.workflows/<slug>.yaml`.
3. Draft YAML from templates below; apply hard rules.
4. `write_file` into the project workspace. If workspace unset, tell the user
   to set Project Settings → Workspace first.
5. Summarize path, step graph, how to run, and Global Settings prerequisites
   (LLM provider, role, notification channel).

## Hard rules

- `steps` required, ≥1. Unknown fields are rejected.
- `working_dir` must stay inside the workspace.
- No secrets in YAML.
- One active run per workflow.
- `chat.completion` = one shot, no tools. `agent` = tool loop; writes apply
  immediately (no Review).
- Prefer `depends` for order; steps without unfinished deps run in parallel
  (max 8).
- Interpolation in `run` / prompts / notification `message` / step `env`:
  `${NAME}`, `${params.NAME}`, `${steps.<id>.output}`,
  `${steps.<id>.outputs.<name>}`, `${env.KEY}`.

## Top-level fields

| Field | Required | Notes |
| --- | --- | --- |
| `name` | no | Display; default = file slug |
| `description` | no | Short summary |
| `tags` | no | string[] |
| `params` | no | Run dialog inputs |
| `env` | no | map → step env |
| `working_dir` | no | Relative to workspace |
| `timeout_sec` | no | Whole-run timeout |
| `preconditions` | no | `{ run: "..." }` gates |
| `llm` | no | Default provider/model/role for AI steps |
| `steps` | **yes** | ≥1 |
| `schedule` | no | In-process cron |
| `on` | no | Event triggers |

### Params

```yaml
params:
  - name: BRANCH
    type: string          # string | number | boolean | agent
    description: Target branch
    default: main
    required: false
    options: [main, develop]
```

`type: agent` → multiline prompt. Access `${params.BRANCH}` or `${BRANCH}`.

### LLM defaults

```yaml
llm:
  provider: OpenAI Work   # exact name from Global Settings → LLM Providers
  model: gpt-4.1-mini
  role: Reviewer          # optional Roles name
```

Step `with.*` overrides.

## Step kinds

### Shell

```yaml
- id: lint
  depends: [install]       # string or list
  run: npm run lint
  shell: bash              # optional
  working_dir: apps/web    # optional
  env: { NODE_ENV: test }
  output: LOG              # → ${LOG} / ${steps.lint.output}
  outputs: [{ name: status }]
  continue_on_error: false
  retry: { max: 2, delay_ms: 1000 }
  timeout_sec: 120
```

### `chat.completion` — summarize / draft / classify

```yaml
- id: review
  action: chat.completion
  depends: diff
  with:
    prompt: "..."            # required
    system: "..."            # optional
    provider: "My Provider"
    model: gpt-4.1-mini
    role: Reviewer
    temperature: 0.2
    max_tokens: 800
  output: REVIEW
```

### `agent` — explore / implement

```yaml
- id: implement
  action: agent
  with:
    prompt: "${params.TASK}" # required
    mode: build              # build | plan
    max_steps: 20
  output: RESULT
```

| Goal | Action |
| --- | --- |
| Summarize / draft text | `chat.completion` |
| Edit files / explore | `agent` + `mode: build` |
| Analysis without writes | `agent` + `mode: plan` |

### Notification

```yaml
- id: ping
  action: notification
  with:
    channel: team-slack      # Global Settings → Notifications
    message: |
      Done.
      ${RESULT}
```

### Router

```yaml
- id: route
  action: router.route
  depends: check
  with:
    value: ${steps.check.outputs.status}
    routes:
      success: [ok]
      failed: [bad]
```

## Templates

### Shell DAG

```yaml
name: build-test
description: Install, lint, test
steps:
  - id: install
    run: npm ci
  - id: lint
    depends: install
    run: npm run lint
  - id: test
    depends: install
    run: npm test
  - id: build
    depends: [lint, test]
    run: npm run build
```

### AI review + notify

```yaml
name: ai-summary
llm:
  provider: My Provider
  model: gpt-4.1-mini
steps:
  - id: diff
    run: git diff
    output: DIFF
  - id: review
    depends: diff
    action: chat.completion
    with:
      system: "Senior reviewer. Be concise."
      prompt: |
        Ringkas risiko perubahan:
        ${DIFF}
      temperature: 0.2
      max_tokens: 800
    output: REVIEW
  - id: ping
    depends: review
    action: notification
    with:
      channel: team-slack
      message: |
        Review selesai.
        ${REVIEW}
```

### Agent implement

```yaml
name: implement-task
params:
  - name: TASK
    type: agent
    description: Prompt implementasi
steps:
  - id: implement
    action: agent
    with:
      mode: build
      prompt: "${params.TASK}"
      max_steps: 20
    output: RESULT
```

### Plan then build

```yaml
name: plan-then-build
params:
  - name: FEATURE
    type: agent
    description: Fitur yang diminta
steps:
  - id: plan
    action: agent
    with:
      mode: plan
      prompt: "Rencana singkat untuk: ${params.FEATURE}"
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
```

### Schedule / event

```yaml
name: nightly-test
schedule:
  cron: "0 2 * * *"       # 5-field
  enabled: true
  timezone: Asia/Jakarta
on:
  - event: ticket.transitioned
    status: In Progress
steps:
  - id: test
    run: npm test
```

## Checklist

- [ ] Path `.workflows/<slug>.yaml`; slug valid
- [ ] Step ids unique; `depends` exist; no cycles
- [ ] Shell has `run`; AI/notification/router have `action` + `with`
- [ ] Providers/roles/channels exist (or note user must create them)
- [ ] No auto-run; tell user Workflows → Run (or enable Cron)
