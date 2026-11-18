import { equal, rejects } from "node:assert/strict";
import { callMcpTool, formatMcpToolResult, listMcpTools } from "../src/server/mcp.ts";
import { isMcpChatTool, mcpChatToolName } from "../src/server/chat/mcp-tools.ts";
import type { McpServerInput } from "../src/config/schema.ts";

function server(patch: Partial<McpServerInput>): McpServerInput {
  return {
    name: "test",
    transport: "stdio",
    args: [],
    enabled: true,
    ...patch,
  } as McpServerInput;
}

Deno.test("mcpChatToolName stays within OpenAI name limits", () => {
  const name = mcpChatToolName(
    "My Server!",
    "very.long.tool.name.with.dots.and.more.stuff",
    "abc-123",
  );
  equal(name.startsWith("mcp_"), true);
  equal(name.length <= 64, true);
  equal(/^[a-zA-Z0-9_-]+$/.test(name), true);
  equal(isMcpChatTool(name), true);
  equal(isMcpChatTool("write_file"), false);
});

Deno.test("formatMcpToolResult flattens text content blocks", () => {
  const text = formatMcpToolResult({
    content: [
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ],
  });
  equal(text, "hello\nworld");

  const err = formatMcpToolResult({
    isError: true,
    content: [{ type: "text", text: "boom" }],
  });
  equal(err.startsWith("[MCP error]"), true);
  equal(err.includes("boom"), true);
});

Deno.test("stdio MCP tanpa command yang bisa di-resolve memberi error jelas", async () => {
  await rejects(
    callMcpTool(
      server({ name: "figcraft", command: "definitely-not-a-real-mcp-cli-xyz" }),
      "ping",
      {},
    ),
    /tidak ditemukan di PATH/,
  );
});

Deno.test("stdio MCP handshake + tools/list lewat deno eval", async () => {
  const fake = [
    'const dec = new TextDecoder(); let buf = "";',
    "for await (const chunk of Deno.stdin.readable) {",
    "  buf += dec.decode(chunk);",
    "  let i = buf.indexOf('\\n');",
    "  while (i >= 0) {",
    "    const line = buf.slice(0, i); buf = buf.slice(i + 1); i = buf.indexOf('\\n');",
    "    if (!line.trim()) continue;",
    "    const msg = JSON.parse(line);",
    "    if (msg.id === undefined) continue;",
    "    const result = msg.method === 'initialize'",
    "      ? { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake', version: '1' } }",
    "      : { tools: [{ name: 'ping', description: 'balas pong' }], content: [{ type: 'text', text: 'pong' }] };",
    "    console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));",
    "  }",
    "}",
  ].join("\n");

  const tools = await listMcpTools(
    server({ name: "fake", command: Deno.execPath(), args: ["eval", fake] }),
  );
  equal(tools.length, 1);
  equal(tools[0].name, "ping");

  const result = await callMcpTool(
    server({ name: "fake", command: Deno.execPath(), args: ["eval", fake] }),
    "ping",
    {},
  );
  equal(result, "pong");
});
