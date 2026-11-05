import type { FileChange } from "./api";

export interface ChatChangedFile {
  path: string;
  action: "create" | "update";
  added: number;
  removed: number;
}

export interface ChatChangesSummary {
  files: ChatChangedFile[];
  created: number;
  updated: number;
  added: number;
  removed: number;
}

/** Path dari tool chat selalu relatif workspace; rapikan separator & prefix `./`. */
export function normalizeChangePath(path: string | null | undefined): string {
  return String(path ?? "")
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .trim();
}

function toCount(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : 0;
}

/**
 * Ringkas `FileChange[]` dari respons chat menjadi daftar path unik.
 * Path yang sama dipakai lebih dari sekali (mis. create lalu update) digabung:
 * aksi `create` dipertahankan, angka +/− memakai nilai terakhir (kondisi akhir file).
 */
export function summarizeChanges(
  changes: FileChange[] | null | undefined,
): ChatChangesSummary {
  const files: ChatChangedFile[] = [];
  const index = new Map<string, number>();

  for (const change of changes ?? []) {
    const path = normalizeChangePath(change?.path);
    if (!path) continue;
    const action: ChatChangedFile["action"] = change.action === "create" ? "create" : "update";
    const added = toCount(change.added);
    const removed = toCount(change.removed);
    const existing = index.get(path);
    if (existing === undefined) {
      index.set(path, files.length);
      files.push({ path, action, added, removed });
      continue;
    }
    const previous = files[existing];
    files[existing] = {
      path,
      action: previous.action === "create" || action === "create" ? "create" : "update",
      added,
      removed,
    };
  }

  return {
    files,
    created: files.filter((file) => file.action === "create").length,
    updated: files.filter((file) => file.action === "update").length,
    added: files.reduce((total, file) => total + file.added, 0),
    removed: files.reduce((total, file) => total + file.removed, 0),
  };
}

/** Label ringkas untuk header collapsible, mis. "1 baru, 2 diubah". */
export function describeChanges(summary: ChatChangesSummary): string {
  const parts: string[] = [];
  if (summary.created > 0) parts.push(`${summary.created} baru`);
  if (summary.updated > 0) parts.push(`${summary.updated} diubah`);
  return parts.join(", ");
}

/** "baru" / "diubah" untuk satu file. */
export function changeActionLabel(action: ChatChangedFile["action"]): string {
  return action === "create" ? "baru" : "diubah";
}
