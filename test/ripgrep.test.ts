import { deepEqual, equal } from "node:assert/strict";
import { join } from "node:path";
import {
  configureSdkRipgrep,
  findRipgrepConfigurator,
  resolveRipgrepPath,
  ripgrepCandidates,
} from "../src/server/chat/ripgrep.ts";
import { rewriteCursorTransportError } from "../src/server/chat/cursor-sdk.ts";

Deno.test("ripgrep: CURSOR_RIPGREP_PATH override wins", async () => {
  const dir = await Deno.makeTempDir();
  const binary = join(dir, Deno.build.os === "windows" ? "rg.exe" : "rg");
  await Deno.writeTextFile(binary, "#!/bin/sh\nexit 0\n");
  const previous = Deno.env.get("CURSOR_RIPGREP_PATH");
  Deno.env.set("CURSOR_RIPGREP_PATH", binary);
  try {
    equal(ripgrepCandidates()[0], binary);
    equal(resolveRipgrepPath(), binary);
  } finally {
    if (previous === undefined) Deno.env.delete("CURSOR_RIPGREP_PATH");
    else Deno.env.set("CURSOR_RIPGREP_PATH", previous);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("ripgrep: configureSdkRipgrep calls the SDK setter", () => {
  const calls: string[] = [];
  const sdk = { configureRipgrepPath: (path: string) => calls.push(path) };
  deepEqual(configureSdkRipgrep(sdk, "/tmp/rg"), { path: "/tmp/rg", configured: true });
  deepEqual(calls, ["/tmp/rg"]);
});

Deno.test("ripgrep: missing binary is reported instead of configured", () => {
  const calls: string[] = [];
  const sdk = { configureRipgrepPath: (path: string) => calls.push(path) };
  deepEqual(configureSdkRipgrep(sdk, null), { path: null, configured: false });
  deepEqual(calls, []);
});

Deno.test("ripgrep: configurator discovery ignores unrelated exports", () => {
  equal(findRipgrepConfigurator({ configureCursorSdk: () => {} }), null);
  equal(typeof findRipgrepConfigurator({ setRipgrepPath: () => {} }), "function");
});

Deno.test("ripgrep: transport error explains the missing binary", () => {
  const rewritten = rewriteCursorTransportError(
    new Error("Ripgrep path not configured. Call configureRipgrepPath() at startup."),
  );
  equal(rewritten.message.includes("ripgrep"), true);
  equal(rewritten.message.includes("CURSOR_RIPGREP_PATH"), true);
});
