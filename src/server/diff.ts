const MAX_LINES = 1200;
const CONTEXT = 3;
const MAX_DIFF_LINES = 600;

export interface DiffResult {
  diff: string;
  added: number;
  removed: number;
}

export interface DiffHunkLine {
  type: " " | "+" | "-";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffHunkLine[];
}

export interface HunkDiffResult extends DiffResult {
  hunks: DiffHunk[];
}

interface Op {
  type: " " | "+" | "-";
  text: string;
}

function toLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function buildOps(a: string[], b: string[]): Op[] {
  const width = b.length + 1;
  const dp = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i * width + j] = a[i] === b[j]
        ? dp[(i + 1) * width + (j + 1)] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: " ", text: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      ops.push({ type: "-", text: a[i] });
      i++;
    } else {
      ops.push({ type: "+", text: b[j] });
      j++;
    }
  }
  while (i < a.length) ops.push({ type: "-", text: a[i++] });
  while (j < b.length) ops.push({ type: "+", text: b[j++] });
  return ops;
}

function countChanges(ops: Op[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === "+") added++;
    if (op.type === "-") removed++;
  }
  return { added, removed };
}

function compress(ops: Op[]): Op[] {
  const out: Op[] = [];
  let index = 0;
  while (index < ops.length) {
    const op = ops[index];
    if (op.type !== " ") {
      out.push(op);
      index++;
      continue;
    }
    let end = index;
    while (end < ops.length && ops[end].type === " ") end++;
    const run = end - index;
    if (run > CONTEXT * 2 + 1) {
      for (let i = index; i < index + CONTEXT; i++) out.push(ops[i]);
      out.push({ type: " ", text: "…" });
      for (let i = end - CONTEXT; i < end; i++) out.push(ops[i]);
    } else {
      for (let i = index; i < end; i++) out.push(ops[i]);
    }
    index = end;
  }
  return out;
}

export function diffLines(before: string, after: string): DiffResult {
  const a = toLines(before);
  const b = toLines(after);
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return {
      diff: `(file terlalu besar untuk diff: ${a.length} → ${b.length} baris)`,
      added: b.length,
      removed: a.length,
    };
  }

  const ops = buildOps(a, b);
  const { added, removed } = countChanges(ops);
  const lines = compress(ops).map((op) => `${op.type}${op.text}`);
  if (lines.length > MAX_DIFF_LINES) {
    lines.splice(MAX_DIFF_LINES, lines.length, "… (diff dipotong)");
  }
  return { diff: lines.join("\n"), added, removed };
}

function singleHunk(before: string, after: string): DiffHunk[] {
  const oldLines = toLines(before);
  const newLines = toLines(after);
  const lines: DiffHunkLine[] = [];
  oldLines.forEach((text, index) => {
    lines.push({ type: "-", text, oldLine: index + 1, newLine: null });
  });
  newLines.forEach((text, index) => {
    lines.push({ type: "+", text, oldLine: null, newLine: index + 1 });
  });
  return [{
    oldStart: 0,
    oldLines: oldLines.length,
    newStart: 0,
    newLines: newLines.length,
    lines,
  }];
}

export function diffHunks(before: string, after: string): HunkDiffResult {
  const a = toLines(before);
  const b = toLines(after);
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return {
      diff: `(file terlalu besar untuk diff: ${a.length} → ${b.length} baris)`,
      added: b.length,
      removed: a.length,
      hunks: singleHunk(before, after),
    };
  }

  const ops = buildOps(a, b);
  const { added, removed } = countChanges(ops);
  const changed: number[] = [];
  ops.forEach((op, index) => {
    if (op.type !== " ") changed.push(index);
  });
  if (changed.length === 0) {
    return { diff: "", added: 0, removed: 0, hunks: [] };
  }

  const groups: Array<[number, number]> = [];
  let start = changed[0];
  let end = changed[0];
  for (let index = 1; index < changed.length; index++) {
    const next = changed[index];
    if (next - end - 1 <= CONTEXT * 2) {
      end = next;
    } else {
      groups.push([start, end]);
      start = next;
      end = next;
    }
  }
  groups.push([start, end]);

  let oldPosition = 0;
  let newPosition = 0;
  const positions = ops.map((op) => {
    const position = { old: oldPosition, new: newPosition };
    if (op.type !== "-") newPosition++;
    if (op.type !== "+") oldPosition++;
    return position;
  });

  const hunks: DiffHunk[] = [];
  const diffLines: string[] = [];
  for (const [first, last] of groups) {
    const from = Math.max(0, first - CONTEXT);
    const to = Math.min(ops.length, last + CONTEXT + 1);
    const base = positions[from];
    let oldNo = base.old + 1;
    let newNo = base.new + 1;
    let oldCount = 0;
    let newCount = 0;
    const lines: DiffHunkLine[] = [];
    for (let index = from; index < to; index++) {
      const op = ops[index];
      diffLines.push(`${op.type}${op.text}`);
      if (op.type === " ") {
        lines.push({ type: " ", text: op.text, oldLine: oldNo++, newLine: newNo++ });
        oldCount++;
        newCount++;
      } else if (op.type === "-") {
        lines.push({ type: "-", text: op.text, oldLine: oldNo++, newLine: null });
        oldCount++;
      } else {
        lines.push({ type: "+", text: op.text, oldLine: null, newLine: newNo++ });
        newCount++;
      }
    }
    hunks.push({
      oldStart: base.old,
      oldLines: oldCount,
      newStart: base.new,
      newLines: newCount,
      lines,
    });
  }

  return { diff: diffLines.join("\n"), added, removed, hunks };
}

export function applyHunks(
  before: string,
  hunks: DiffHunk[],
  accepted: Set<number>,
  trailingNewline: boolean,
): string {
  const lines = toLines(before);
  const chosen = hunks
    .map((hunk, index) => ({ hunk, index }))
    .filter((item) => accepted.has(item.index))
    .sort((a, b) => b.hunk.oldStart - a.hunk.oldStart);

  for (const { hunk } of chosen) {
    const replacement = hunk.lines.filter((line) => line.type !== "-").map((line) => line.text);
    lines.splice(hunk.oldStart, hunk.oldLines, ...replacement);
  }

  if (!lines.length) return "";
  return `${lines.join("\n")}${trailingNewline ? "\n" : ""}`;
}
