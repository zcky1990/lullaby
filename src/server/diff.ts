const MAX_LINES = 1200;
const CONTEXT = 3;
const MAX_DIFF_LINES = 600;

export interface DiffResult {
  diff: string;
  added: number;
  removed: number;
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

  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === "+") added++;
    if (op.type === "-") removed++;
  }

  const lines = compress(ops).map((op) => `${op.type}${op.text}`);
  if (lines.length > MAX_DIFF_LINES) {
    lines.splice(MAX_DIFF_LINES, lines.length, "… (diff dipotong)");
  }
  return { diff: lines.join("\n"), added, removed };
}
