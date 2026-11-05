import { describe, expect, it } from "vitest";
import {
  changeActionLabel,
  describeChanges,
  normalizeChangePath,
  summarizeChanges,
} from "./chat-changes";
import type { FileChange } from "./api";

const change = (path: string, overrides: Partial<FileChange> = {}): FileChange => ({
  path,
  action: "update",
  diff: "",
  added: 1,
  removed: 0,
  ...overrides,
});

describe("normalizeChangePath", () => {
  it("menyeragamkan separator windows dan prefix ./", () => {
    expect(normalizeChangePath(".\\src\\app.ts")).toBe("src/app.ts");
    expect(normalizeChangePath("./web/src/App.tsx")).toBe("web/src/App.tsx");
  });

  it("aman untuk nilai kosong", () => {
    expect(normalizeChangePath(null)).toBe("");
    expect(normalizeChangePath(undefined)).toBe("");
    expect(normalizeChangePath("   ")).toBe("");
  });
});

describe("summarizeChanges", () => {
  it("mengembalikan ringkasan kosong tanpa perubahan", () => {
    expect(summarizeChanges(undefined)).toEqual({
      files: [],
      created: 0,
      updated: 0,
      added: 0,
      removed: 0,
    });
    expect(summarizeChanges([]).files).toHaveLength(0);
  });

  it("menghitung file baru dan file diubah", () => {
    const summary = summarizeChanges([
      change("src/a.ts", { action: "create", added: 12, removed: 0 }),
      change("src/b.ts", { added: 3, removed: 1 }),
    ]);

    expect(summary.files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(summary.created).toBe(1);
    expect(summary.updated).toBe(1);
    expect(summary.added).toBe(15);
    expect(summary.removed).toBe(1);
  });

  it("menggabungkan path yang sama dan mempertahankan aksi create", () => {
    const summary = summarizeChanges([
      change("docs/plan.md", { action: "create", added: 5, removed: 0 }),
      change("./docs/plan.md", { action: "update", added: 8, removed: 2 }),
    ]);

    expect(summary.files).toHaveLength(1);
    expect(summary.files[0]).toEqual({
      path: "docs/plan.md",
      action: "create",
      added: 8,
      removed: 2,
    });
    expect(summary.created).toBe(1);
    expect(summary.updated).toBe(0);
    expect(summary.added).toBe(8);
  });

  it("melewati path kosong dan menormalkan angka aneh", () => {
    const summary = summarizeChanges([
      change("", { added: 4 }),
      change("a.ts", { added: -3, removed: Number.NaN }),
      change("b.ts", { action: "delete" as unknown as FileChange["action"] }),
    ]);

    expect(summary.files.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);
    expect(summary.files[0].added).toBe(0);
    expect(summary.files[0].removed).toBe(0);
    expect(summary.files[1].action).toBe("update");
    expect(summary.added).toBe(1);
  });
});

describe("describeChanges", () => {
  it("menyusun label ringkas", () => {
    expect(describeChanges(summarizeChanges([change("a.ts", { action: "create" })]))).toBe(
      "1 baru",
    );
    expect(
      describeChanges(
        summarizeChanges([
          change("a.ts", { action: "create" }),
          change("b.ts"),
          change("c.ts"),
        ]),
      ),
    ).toBe("1 baru, 2 diubah");
    expect(describeChanges(summarizeChanges([]))).toBe("");
  });
});

describe("changeActionLabel", () => {
  it("memberi label Indonesia", () => {
    expect(changeActionLabel("create")).toBe("baru");
    expect(changeActionLabel("update")).toBe("diubah");
  });
});
