export type CanonicalTicketColumn =
  | "Backlog"
  | "To Do"
  | "In Progress"
  | "Test"
  | "Done";

export const CANONICAL_COLUMNS: { title: CanonicalTicketColumn; matcher: RegExp }[] = [
  { title: "Backlog", matcher: /backlog|icebox/i },
  { title: "To Do", matcher: /to ?do|todo|open|new|selected|refine/i },
  { title: "In Progress", matcher: /progress|doing|develop|implement/i },
  { title: "Test", matcher: /test|qa|review|verify|staging|uat/i },
  { title: "Done", matcher: /done|complete|closed|resolve|finish|release|deploy/i },
];

export function canonicalTicketColumn(status?: string | null): string {
  if (!status) return "Backlog";
  for (const column of CANONICAL_COLUMNS) {
    if (column.matcher.test(status)) return column.title;
  }
  return status;
}

export function isTodoToInProgress(fromStatus: string, toStatus: string): boolean {
  return canonicalTicketColumn(fromStatus) === "To Do" &&
    canonicalTicketColumn(toStatus) === "In Progress";
}

export function buildAutoBuildPrompt(input: {
  key: string;
  summary: string;
  description?: string;
}): string {
  const lines = [`Kerjakan tiket ${input.key}: ${input.summary}`, ""];
  const description = input.description?.trim();
  if (description) {
    lines.push(description, "");
  }
  lines.push(
    "Implementasikan perubahan di workspace project ini. Jelaskan singkat apa yang kamu ubah.",
  );
  return lines.join("\n");
}
