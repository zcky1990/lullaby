import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectDirtyPaths,
  getDirtyPathsSnapshot,
  isDirtyPath,
  normalizeDirtyPath,
  publishDirtyPaths,
  resetDirtyPaths,
  resolveDirtyFlag,
  subscribeDirtyPaths,
} from "./dirty-paths";

const file = (ref: string, dirty = true) => ({
  kind: "file",
  title: ref,
  ref,
  dirty,
});

describe("normalizeDirtyPath", () => {
  it("menyeragamkan separator windows dan prefix ./", () => {
    expect(normalizeDirtyPath(".\\src\\app.ts")).toBe("src/app.ts");
    expect(normalizeDirtyPath("./web/src/App.tsx")).toBe("web/src/App.tsx");
  });

  it("aman untuk nilai kosong", () => {
    expect(normalizeDirtyPath(null)).toBe("");
    expect(normalizeDirtyPath(undefined)).toBe("");
    expect(normalizeDirtyPath("   ")).toBe("");
  });
});

describe("collectDirtyPaths", () => {
  it("hanya mengambil tab file yang dirty", () => {
    const paths = collectDirtyPaths([
      file("src/a.ts", true),
      file("src/b.ts", false),
      { kind: "document", title: "Catatan", ref: "notes/catatan.md", dirty: true },
      { kind: "file", title: "src/c.ts", dirty: true },
    ]);

    expect([...paths].sort()).toEqual(["src/a.ts", "src/c.ts"]);
  });

  it("menormalkan path tab", () => {
    const paths = collectDirtyPaths([file(".\\src\\a.ts")]);
    expect([...paths]).toEqual(["src/a.ts"]);
  });

  it("mengembalikan set kosong untuk input kosong", () => {
    expect(collectDirtyPaths([]).size).toBe(0);
    expect(collectDirtyPaths(null).size).toBe(0);
    expect(collectDirtyPaths(undefined).size).toBe(0);
  });
});

describe("isDirtyPath", () => {
  const dirty = collectDirtyPaths([file("src/a.ts")]);

  it("cocok untuk path yang sama", () => {
    expect(isDirtyPath(dirty, "src/a.ts")).toBe(true);
    expect(isDirtyPath(dirty, "./src/a.ts")).toBe(true);
    expect(isDirtyPath(dirty, "src\\a.ts")).toBe(true);
  });

  it("menolak file lain dan nama yang hanya berakhiran sama", () => {
    expect(isDirtyPath(dirty, "src/b.ts")).toBe(false);
    expect(isDirtyPath(dirty, "b.ts")).toBe(false);
    expect(isDirtyPath(dirty, "lib/src/a.ts")).toBe(false);
  });

  it("mencocokkan path absolut dengan path relatif", () => {
    const absolute = collectDirtyPaths([file("/home/dev/project/src/a.ts")]);
    expect(isDirtyPath(absolute, "src/a.ts")).toBe(true);
    expect(isDirtyPath(absolute, "src/b.ts")).toBe(false);

    const relative = collectDirtyPaths([file("src/a.ts")]);
    expect(isDirtyPath(relative, "/home/dev/project/src/a.ts")).toBe(true);
    expect(isDirtyPath(relative, "/home/dev/project/src/b.ts")).toBe(false);
  });

  it("aman untuk set kosong / path kosong", () => {
    expect(isDirtyPath(undefined, "src/a.ts")).toBe(false);
    expect(isDirtyPath(new Set(), "src/a.ts")).toBe(false);
    expect(isDirtyPath(dirty, "")).toBe(false);
    expect(isDirtyPath(dirty, null)).toBe(false);
  });
});

describe("resolveDirtyFlag", () => {
  it("tidak mengubah flag bila patch tanpa content", () => {
    expect(resolveDirtyFlag({ loading: true }, "lama")).toEqual({ dirty: undefined });
    expect(resolveDirtyFlag({ dirty: true }, undefined)).toEqual({ dirty: true });
    expect(resolveDirtyFlag({ dirty: false }, "lama")).toEqual({ dirty: false });
  });

  it("isi dari disk jadi baseline dan tab dianggap tersimpan", () => {
    expect(resolveDirtyFlag({ content: "isi disk" }, undefined)).toEqual({
      dirty: false,
      baseline: "isi disk",
    });
  });

  it("tidak menandai dirty saat isi tetap sama dengan baseline", () => {
    expect(resolveDirtyFlag({ content: "isi disk", dirty: true }, "isi disk")).toEqual({
      dirty: false,
    });
  });

  it("menandai dirty saat isi berbeda dari baseline", () => {
    expect(resolveDirtyFlag({ content: "isi baru", dirty: true }, "isi disk")).toEqual({
      dirty: true,
    });
    expect(resolveDirtyFlag({ content: "isi baru", dirty: true }, undefined)).toEqual({
      dirty: true,
    });
  });

  it("simpan memindahkan baseline ke isi terbaru", () => {
    expect(resolveDirtyFlag({ content: "isi baru", dirty: false }, "isi disk")).toEqual({
      dirty: false,
      baseline: "isi baru",
    });
  });
});

describe("dirty paths store", () => {
  beforeEach(() => {
    resetDirtyPaths();
  });

  it("menyimpan snapshot dan memberi tahu subscriber", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDirtyPaths(listener);
    const next = new Set(["src/a.ts"]);

    publishDirtyPaths(next);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getDirtyPathsSnapshot()).toBe(next);

    unsubscribe();
    publishDirtyPaths(new Set(["src/b.ts"]));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("tidak memicu listener bila isi set sama", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDirtyPaths(listener);

    publishDirtyPaths(new Set(["src/a.ts"]));
    publishDirtyPaths(new Set(["src/a.ts"]));

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("reset mengembalikan snapshot kosong", () => {
    publishDirtyPaths(new Set(["src/a.ts"]));
    resetDirtyPaths();
    expect(getDirtyPathsSnapshot().size).toBe(0);
  });
});
