import { deepEqual, equal } from "node:assert/strict";
import { join } from "node:path";
import { findInWorkspace, listWorkspaceFiles } from "../src/fs/workspace.ts";

const dir = await Deno.makeTempDir();
await Deno.mkdir(join(dir, "src"), { recursive: true });
await Deno.mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
await Deno.mkdir(join(dir, ".git"), { recursive: true });
await Deno.writeTextFile(join(dir, "README.md"), "alpha\nbeta\n");
await Deno.writeTextFile(join(dir, "src", "app.ts"), "const Alpha = 1;\nconsole.log(Alpha);\n");
await Deno.writeTextFile(join(dir, "node_modules", "pkg", "index.js"), "Alpha hidden\n");
await Deno.writeTextFile(join(dir, ".git", "config"), "Alpha hidden\n");

Deno.test("listWorkspaceFiles skips ignored directories", async () => {
  const index = await listWorkspaceFiles(dir);
  deepEqual(index.files.sort(), ["README.md", "src/app.ts"]);
  equal(index.truncated, false);
});

Deno.test("findInWorkspace searches text files case-insensitively", async () => {
  const result = await findInWorkspace(dir, "alpha");
  equal(result.error, undefined);
  equal(result.matches.length, 3);
  deepEqual(
    result.matches.map((match) => `${match.path}:${match.line}`).sort(),
    ["README.md:1", "src/app.ts:1", "src/app.ts:2"],
  );
  equal(
    result.matches[0].preview.includes("alpha") || result.matches[0].preview.includes("Alpha"),
    true,
  );
});

Deno.test("findInWorkspace supports case sensitive and regex", async () => {
  const sensitive = await findInWorkspace(dir, "Alpha", { caseSensitive: true });
  equal(sensitive.matches.length, 2);
  const regex = await findInWorkspace(dir, "^console", { regex: true });
  equal(regex.matches.length, 1);
  equal(regex.matches[0].path, "src/app.ts");
  equal(regex.matches[0].line, 2);
});

Deno.test("findInWorkspace reports invalid regex", async () => {
  const result = await findInWorkspace(dir, "([", { regex: true });
  equal(result.matches.length, 0);
  equal(result.error?.startsWith("Regex tidak valid"), true);
});

Deno.test("findInWorkspace returns empty for blank query", async () => {
  const result = await findInWorkspace(dir, "   ");
  deepEqual(result, { matches: [], scanned: 0, truncated: false });
});

Deno.test("workspace search cleanup", async () => {
  await Deno.remove(dir, { recursive: true });
});
