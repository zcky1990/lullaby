import { describe, expect, it } from "vitest";
import type { GitStatus } from "./api";
import {
  buildExplorerMarks,
  collectGitMarks,
  markForPath,
} from "./explorer-marks";

const status = (partial: Partial<GitStatus>): GitStatus => ({
  branch: "main",
  ahead: 0,
  behind: 0,
  staged: [],
  unstaged: [],
  untracked: [],
  clean: false,
  ...partial,
});

describe("collectGitMarks", () => {
  it("menandai modified dan added", () => {
    const marks = collectGitMarks(status({
      unstaged: [{ path: "src/a.ts", status: " M", staged: false, untracked: false }],
      untracked: [{ path: "src/new.ts", status: "??", staged: false, untracked: true }],
    }));
    expect(marks.get("src/a.ts")).toBe("modified");
    expect(marks.get("src/new.ts")).toBe("added");
  });
});

describe("buildExplorerMarks", () => {
  it("menggelembungkan dirty dan git ke folder induk", () => {
    const marks = buildExplorerMarks(
      new Set(["src/feat/a.ts"]),
      status({
        untracked: [{ path: "docs/guide.md", status: "??", staged: false, untracked: true }],
      }),
    );
    expect(marks.get("src/feat/a.ts")?.dirty).toBe(true);
    expect(marks.get("src/feat")?.childDirty).toBe(true);
    expect(marks.get("src")?.childDirty).toBe(true);
    expect(marks.get("docs/guide.md")?.git).toBe("added");
    expect(marks.get("docs")?.childGit).toBe("added");
  });
});

describe("markForPath", () => {
  it("mengembalikan child marks untuk folder", () => {
    const marks = buildExplorerMarks(new Set(["src/a.ts"]), null);
    expect(markForPath(marks, new Set(["src/a.ts"]), "src", true)).toEqual({
      dirty: false,
      git: undefined,
      childDirty: true,
      childGit: undefined,
    });
    expect(markForPath(marks, new Set(["src/a.ts"]), "src/a.ts", false).dirty).toBe(true);
  });
});
