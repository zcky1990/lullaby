import { deepEqual, throws } from "node:assert/strict";
import { LspSettingsInput } from "../src/config/schema.ts";
import {
  encodeLspFrame,
  LspFrameParser,
  lspPresets,
  matchLspServer,
  MAX_FRAME_BYTES,
  resolveExecutable,
} from "../src/server/lsp.ts";

const encoder = new TextEncoder();

function frame(payload: unknown): Uint8Array {
  return encodeLspFrame(payload);
}

Deno.test("LSP frame codec decodes a single message", () => {
  const parser = new LspFrameParser();
  const messages = parser.push(frame({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
  deepEqual(messages.length, 1);
  deepEqual(JSON.parse(messages[0]), { jsonrpc: "2.0", id: 1, result: { ok: true } });
});

Deno.test("LSP frame codec handles split and batched frames", () => {
  const parser = new LspFrameParser();
  const first = frame({ jsonrpc: "2.0", method: "a", params: {} });
  const second = frame({ jsonrpc: "2.0", method: "b", params: {} });
  const combined = new Uint8Array(first.byteLength + second.byteLength);
  combined.set(first, 0);
  combined.set(second, first.byteLength);

  deepEqual(parser.push(first.subarray(0, 7)).length, 0);
  const rest = new Uint8Array(combined.byteLength - 7);
  rest.set(combined.subarray(7), 0);
  const messages = parser.push(rest);
  deepEqual(messages.map((item) => JSON.parse(item).method), ["a", "b"]);
});

Deno.test("LSP frame codec uses byte length for UTF-8", () => {
  const parser = new LspFrameParser();
  const payload = { jsonrpc: "2.0", method: "log", params: { message: "héllo 世界" } };
  const messages = parser.push(frame(payload));
  deepEqual(messages.length, 1);
  deepEqual(JSON.parse(messages[0]), payload);
});

Deno.test("LSP frame parser rejects oversized frames", () => {
  const header = encoder.encode(`Content-Length: ${MAX_FRAME_BYTES + 1}\r\n\r\n`);
  const parser = new LspFrameParser();
  throws(() => parser.push(header), Error, "terlalu besar");
});

Deno.test("LSP settings schema applies defaults and validates languages", () => {
  const parsed = LspSettingsInput.parse({
    servers: [
      {
        name: "TS",
        languages: ["typescript"],
        command: "typescript-language-server",
        args: ["--stdio"],
      },
    ],
  });
  deepEqual(parsed.enabled, false);
  deepEqual(parsed.servers[0].enabled, true);
  deepEqual(parsed.servers[0].mode, "local");
  deepEqual(parsed.servers[0].env, {});
  deepEqual(parsed.servers[0].args, ["--stdio"]);
});

Deno.test("LSP server matching requires enabled settings and language", () => {
  const server = {
    id: "s1",
    name: "TS",
    languages: ["typescript", "javascript"],
    command: "typescript-language-server",
    args: ["--stdio"],
    env: {},
    enabled: true,
    mode: "local" as const,
  };
  deepEqual(matchLspServer({ enabled: false, servers: [server] }, "typescript"), null);
  deepEqual(matchLspServer({ enabled: true, servers: [server] }, "python"), null);
  deepEqual(matchLspServer({ enabled: true, servers: [server] }, "TypeScript")?.id, "s1");
  deepEqual(
    matchLspServer({ enabled: true, servers: [{ ...server, enabled: false }] }, "typescript"),
    null,
  );
});

Deno.test("LSP presets include the v1 languages", () => {
  const languages = new Set(lspPresets().flatMap((preset) => preset.languages));
  for (const language of ["typescript", "python", "go", "rust", "yaml", "shell"]) {
    deepEqual(languages.has(language), true, `missing ${language}`);
  }
  const typescript = lspPresets().find((preset) => preset.id === "typescript");
  deepEqual(typescript?.variants.some((variant) => variant.mode === "npx"), true);
});

Deno.test("resolveExecutable accepts an absolute path", async () => {
  const deno = Deno.execPath();
  deepEqual(await resolveExecutable(deno), deno);
  deepEqual(await resolveExecutable("/definitely/not/a/real/command"), null);
});

Deno.test("LSP frame decoder ignores headers without content-length", () => {
  const parser = new LspFrameParser();
  const input = encoder.encode("X-Test: 1\r\n\r\nContent-Length: 2\r\n\r\n{}");
  const messages = parser.push(input);
  deepEqual(messages, ["{}"]);
});

Deno.test("client LSP path helpers encode file URIs and language ids", async () => {
  const { fileUri, lspLanguageId, normalizeWorkspacePath } = await import(
    "../web/src/lib/lsp-paths.ts"
  );
  deepEqual(fileUri("/Users/me/proj/src/a.ts"), "file:///Users/me/proj/src/a.ts");
  deepEqual(fileUri("C:/work/a.ts"), "file:///C:/work/a.ts");
  deepEqual(normalizeWorkspacePath("/ws", "src/a.ts"), "/ws/src/a.ts");
  deepEqual(normalizeWorkspacePath("/ws", "/abs/a.ts"), "/abs/a.ts");
  deepEqual(lspLanguageId("foo.tsx", "typescript"), "typescriptreact");
  deepEqual(lspLanguageId("foo.ts", "typescript"), "typescript");
  deepEqual(lspLanguageId("foo.py", "python"), "python");
});
