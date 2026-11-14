import type { GitStatus } from "./api";
import { isDirtyPath, normalizeDirtyPath } from "./dirty-paths";

/** Git / disk change marks shown in the Explorer (separate from unsaved `dirty`). */
export type ExplorerGitMark = "modified" | "added";

export interface ExplorerPathMark {
  dirty: boolean;
  git?: ExplorerGitMark;
  /** Folder has a dirty/changed descendant. */
  childDirty: boolean;
  childGit?: ExplorerGitMark;
}

function preferGit(a: ExplorerGitMark | undefined, b: ExplorerGitMark | undefined): ExplorerGitMark | undefined {
  if (a === "added" || b === "added") return "added";
  if (a === "modified" || b === "modified") return "modified";
  return undefined;
}

/** Map of git-changed file paths → mark (untracked wins over modified). */
export function collectGitMarks(
  status: GitStatus | null | undefined,
): Map<string, ExplorerGitMark> {
  const marks = new Map<string, ExplorerGitMark>();
  if (!status) return marks;
  for (const file of [...status.staged, ...status.unstaged]) {
    const path = normalizeDirtyPath(file.path);
    if (!path || file.untracked) continue;
    if (!marks.has(path)) marks.set(path, "modified");
  }
  for (const file of status.untracked) {
    const path = normalizeDirtyPath(file.path);
    if (!path) continue;
    marks.set(path, "added");
  }
  for (const file of [...status.staged, ...status.unstaged]) {
    if (!file.untracked) continue;
    const path = normalizeDirtyPath(file.path);
    if (!path) continue;
    marks.set(path, "added");
  }
  return marks;
}

function ancestorDirs(path: string): string[] {
  const key = normalizeDirtyPath(path);
  if (!key) return [];
  const parts = key.split("/");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    out.push(parts.slice(0, i).join("/"));
  }
  return out;
}

/**
 * Build per-path marks for the explorer, including folder bubbling so a
 * parent directory lights up when a child is dirty or git-changed.
 */
export function buildExplorerMarks(
  dirtyPaths: ReadonlySet<string> | null | undefined,
  gitStatus: GitStatus | null | undefined,
): Map<string, ExplorerPathMark> {
  const gitMarks = collectGitMarks(gitStatus);
  const result = new Map<string, ExplorerPathMark>();

  const ensure = (path: string): ExplorerPathMark => {
    const key = normalizeDirtyPath(path);
    let mark = result.get(key);
    if (!mark) {
      mark = { dirty: false, childDirty: false };
      result.set(key, mark);
    }
    return mark;
  };

  for (const path of dirtyPaths ?? []) {
    const key = normalizeDirtyPath(path);
    if (!key) continue;
    ensure(key).dirty = true;
    for (const dir of ancestorDirs(key)) {
      ensure(dir).childDirty = true;
    }
  }

  for (const [path, git] of gitMarks) {
    const mark = ensure(path);
    mark.git = preferGit(mark.git, git);
    for (const dir of ancestorDirs(path)) {
      const parent = ensure(dir);
      parent.childGit = preferGit(parent.childGit, git);
    }
  }

  return result;
}

export function markForPath(
  marks: ReadonlyMap<string, ExplorerPathMark> | null | undefined,
  dirtyPaths: ReadonlySet<string> | null | undefined,
  path: string,
  isDir: boolean,
): ExplorerPathMark {
  const key = normalizeDirtyPath(path);
  const found = marks?.get(key);
  if (found) {
    return isDir
      ? {
        dirty: false,
        git: undefined,
        childDirty: found.childDirty || found.dirty,
        childGit: preferGit(found.childGit, found.git),
      }
      : {
        dirty: found.dirty || isDirtyPath(dirtyPaths, path),
        git: found.git,
        childDirty: false,
      };
  }
  return {
    dirty: !isDir && isDirtyPath(dirtyPaths, path),
    childDirty: false,
  };
}
