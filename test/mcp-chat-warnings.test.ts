import { equal } from "node:assert/strict";
import { closeDb, setAppSetting } from "../src/db/db.ts";
import { loadMcpChatTools } from "../src/server/chat/mcp-tools.ts";

const dataDir = await Deno.makeTempDir();
Deno.env.set("RND_APP_DATA_DIR", dataDir);

Deno.test("loadMcpChatTools melaporkan server yang gagal start sebagai warning", async () => {
  await setAppSetting("mcp_enabled", "true");
  await setAppSetting("mcp_inject_chat", "true");
  await setAppSetting(
    "mcp_servers",
    JSON.stringify([
      {
        id: "srv-figcraft",
        name: "figcraft",
        transport: "stdio",
        command: "definitely-not-a-real-mcp-cli-xyz",
        args: ["mcp"],
        enabled: true,
      },
    ]),
  );

  const mcp = await loadMcpChatTools();
  equal(mcp.defs.length, 0);
  equal(mcp.warnings.length, 1);
  equal(mcp.warnings[0].server, "figcraft");
  equal(mcp.warnings[0].error.includes("tidak ditemukan di PATH"), true);
});

Deno.test("loadMcpChatTools menandai server yang tidak lolos schema", async () => {
  await setAppSetting("mcp_enabled", "true");
  await setAppSetting("mcp_inject_chat", "true");
  await setAppSetting(
    "mcp_servers",
    JSON.stringify([
      // transport stdio tanpa command: dulu hilang tanpa jejak.
      { id: "srv-rusak", name: "rusak", transport: "stdio", args: [], enabled: true },
    ]),
  );

  const mcp = await loadMcpChatTools();
  equal(mcp.defs.length, 0);
  equal(
    mcp.warnings.some((warning) =>
      warning.server === "rusak" && warning.error.includes("command")
    ),
    true,
  );
});

Deno.test("loadMcpChatTools menghormati toggle global dan tool yang dimatikan", async () => {
  await setAppSetting(
    "mcp_servers",
    JSON.stringify([{ id: "srv-off", name: "off", transport: "stdio", command: "x", enabled: false }]),
  );
  await setAppSetting("mcp_enabled", "false");
  await setAppSetting("mcp_inject_chat", "true");
  const disabled = await loadMcpChatTools();
  equal(disabled.defs.length, 0);

  await setAppSetting("mcp_enabled", "true");
  const stillOff = await loadMcpChatTools();
  equal(stillOff.defs.length, 0);
  equal(stillOff.warnings.length, 0);
});

Deno.test("loadMcpChatTools progressive bila mcp_inject_chat off (default)", async () => {
  await setAppSetting(
    "mcp_servers",
    JSON.stringify([
      {
        id: "srv-figcraft",
        name: "figcraft",
        transport: "stdio",
        command: "definitely-not-a-real-mcp-cli-xyz",
        args: ["mcp"],
        enabled: true,
      },
    ]),
  );
  await setAppSetting("mcp_enabled", "true");
  await setAppSetting("mcp_inject_chat", "false");
  const mcp = await loadMcpChatTools();
  equal(mcp.mode, "progressive");
  equal(mcp.defs.map((tool) => tool.name).sort().join(","), "call_mcp_tool,list_mcp_tools");
  equal(mcp.byName.size, 0);
  equal(mcp.serverSummaries.length, 1);
  equal(mcp.serverSummaries[0].name, "figcraft");
  equal(mcp.warnings.length, 0);
});

Deno.test({
  name: "mcp-chat-warnings: cleanup temp data dir",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    closeDb();
    Deno.env.delete("RND_APP_DATA_DIR");
    await Deno.remove(dataDir, { recursive: true });
  },
});
