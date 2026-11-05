import { equal } from "node:assert/strict";
import { formatMcpToolResult } from "../src/server/mcp.ts";
import { isMcpChatTool, mcpChatToolName } from "../src/server/chat/mcp-tools.ts";

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
