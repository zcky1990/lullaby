---
name: code-review
description: >-
  Review workspace code changes for bugs, regressions, security issues, and
  missing tests. Use when the user invokes /code-review or asks for a code review.
---

# Code review

Review the relevant code with a code review mindset. Prioritize bugs, behavioral regressions, security issues, and missing tests. Findings must be the primary focus, ordered by severity. Do not make code changes unless the user explicitly asks for them.

## Scope

- Prefer the git diff / change context provided in the user message when present.
- If context is missing or incomplete, use `list_files` and `read_file` on the changed paths.
- Default to reviewing branch + working tree changes. If the user asks for uncommitted-only, focus on staged/unstaged/untracked.

## Output format

1. Start with a one-sentence summary of what was reviewed (or say there is no diff).
2. If there are no issues: say so clearly.
3. If there are issues: a markdown table sorted by severity (highest first) with columns:
   - Severity (`Critical` | `High` | `Medium` | `Low`)
   - Location (`path:line` when known, otherwise `path`)
   - Finding (concise)
4. Optionally add a short "Notes" section for testing gaps or follow-ups — keep it brief.

## Rules

- Do not rewrite files or call `write_file` / `create_ticket` unless the user explicitly asks to fix something.
- Prefer concrete, actionable findings over style nits.
- Skip praise and filler; findings first.
