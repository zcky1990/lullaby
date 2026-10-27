import { checkGitRepository, getStatus, runGit } from "../integrations/git.ts";

const MAX_DIFF_CHARS = 60_000;

function truncate(text: string, max = MAX_DIFF_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}\n\n…(diff truncated)`;
}

export async function collectCodeReviewContext(workspace: string): Promise<string> {
  const check = await checkGitRepository(workspace);
  if (!check.ok) {
    return [
      "Git context unavailable:",
      check.error ?? "workspace is not a git repository.",
      "Review using list_files/read_file on the areas the user mentioned.",
    ].join("\n");
  }

  const cwd = check.cwd;
  const parts: string[] = [];

  try {
    const status = await getStatus(cwd);
    parts.push(`Branch: ${status.branch} (ahead ${status.ahead}, behind ${status.behind})`);
    const files = [
      ...status.staged.map((f) => `  staged ${f.status} ${f.path}`),
      ...status.unstaged.map((f) => `  unstaged ${f.status} ${f.path}`),
      ...status.untracked.map((f) => `  untracked ${f.path}`),
    ];
    parts.push(files.length ? `Changed files:\n${files.join("\n")}` : "Working tree clean.");
  } catch (error) {
    parts.push(`Status error: ${(error as Error).message}`);
  }

  const diffs: Array<{ label: string; args: string[] }> = [
    { label: "Unstaged diff", args: ["diff", "--no-color"] },
    { label: "Staged diff", args: ["diff", "--cached", "--no-color"] },
    {
      label: "Diff vs upstream merge-base (if any)",
      args: ["diff", "--no-color", "@{upstream}...HEAD"],
    },
  ];

  for (const item of diffs) {
    const result = await runGit(cwd, item.args);
    const body = result.stdout.trim();
    if (!body) continue;
    parts.push(`## ${item.label}\n\`\`\`diff\n${truncate(body)}\n\`\`\``);
  }

  if (parts.length <= 2) {
    parts.push(
      "No non-empty diffs collected. Ask which files/paths to review, or use list_files/read_file.",
    );
  }

  return parts.join("\n\n");
}

export function defaultCodeReviewUserMessage(extraText: string, gitContext: string): string {
  const raw = extraText.trim();
  const extra = /^(ikuti skill \/code-review\.?|\/code-review)$/i.test(raw) ? "" : raw;
  const head =
    "Review the relevant code with a code review mindset. Prioritize bugs, behavioral regressions, security issues, and missing tests. Findings must be the primary focus, ordered by severity. Do not make code changes unless I explicitly ask for them.";
  return [
    head,
    extra ? `\nAdditional request:\n${extra}` : "",
    "\n## Repository change context\n",
    gitContext,
  ].filter(Boolean).join("\n");
}
