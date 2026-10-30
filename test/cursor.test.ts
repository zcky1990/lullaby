import { deepEqual, equal } from "node:assert/strict";
import { join } from "node:path";
import { collectCursorWrites } from "../src/server/chat/cursor.ts";

const workspace = await Deno.makeTempDir();
const temp = await Deno.makeTempDir();

await Deno.mkdir(join(workspace, "src"), { recursive: true });
await Deno.writeTextFile(join(workspace, "src", "a.ts"), "export const a = 1;\n");
await Deno.writeTextFile(join(workspace, "src", "same.ts"), "export const same = 1;\n");
await Deno.writeFile(join(workspace, "big.bin"), new Uint8Array([0, 1, 2, 3]));

await Deno.mkdir(join(temp, "src"), { recursive: true });
await Deno.writeTextFile(join(temp, "src", "a.ts"), "export const a = 2;\n");
await Deno.writeTextFile(join(temp, "src", "same.ts"), "export const same = 1;\n");
await Deno.writeTextFile(join(temp, "src", "new.ts"), "export const created = true;\n");
await Deno.writeFile(join(temp, "big.bin"), new Uint8Array([0, 9, 9, 9]));
await Deno.mkdir(join(temp, ".cursor"), { recursive: true });
await Deno.writeTextFile(join(temp, ".cursor", "state.json"), "{}");

Deno.test("collectCursorWrites returns changed and new text files only", async () => {
  const result = await collectCursorWrites(temp, workspace);
  deepEqual(result.writes.map((write) => write.path).sort(), ["src/a.ts", "src/new.ts"]);
  equal(result.writes.find((write) => write.path === "src/a.ts")?.content, "export const a = 2;\n");
  equal(result.notes.some((note) => note.includes("biner")), true);
});

Deno.test("collectCursorWrites cleanup", async () => {
  await Deno.remove(workspace, { recursive: true });
  await Deno.remove(temp, { recursive: true });
});
