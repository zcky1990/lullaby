import { McpServerInput } from "../../config/schema.ts";
import { getAppSetting } from "../../db/db.ts";
import { log } from "../../core/logger.ts";
import { decryptMcpServers } from "../../secrets/fields.ts";
import { callMcpTool, listMcpTools, type McpTool } from "../mcp.ts";
import type { McpToolBinding, ToolDef } from "./types.ts";

export type { McpToolBinding };

const MCP_SETTINGS_KEY = "mcp_servers";
const MAX_CHAT_MCP_TOOLS = 80;
const MAX_TOOL_NAME = 64;
const MAX_LIST_CHARS = 60_000;

export const LIST_MCP_TOOLS_NAME = "list_mcp_tools";
export const CALL_MCP_TOOL_NAME = "call_mcp_tool";

/** Server MCP yang gagal dipakai di chat; ditampilkan ke user supaya tidak senyap. */
export interface McpWarning {
  server: string;
  error: string;
}

export type McpChatMode = "off" | "progressive" | "inject";

export interface McpServerSummary {
  id: string;
  name: string;
}

export interface McpChatTools {
  defs: ToolDef[];
  byName: Map<string, McpToolBinding>;
  warnings: McpWarning[];
  serverSummaries: McpServerSummary[];
  mode: McpChatMode;
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

/** OpenAI/Anthropic function names: [a-zA-Z0-9_-]{1,64} */
export function mcpChatToolName(serverName: string, toolName: string, serverId: string): string {
  const server = sanitizeSegment(serverName).slice(0, 16) ||
    sanitizeSegment(serverId).slice(0, 8) ||
    "srv";
  const prefix = `mcp_${server}_`;
  const room = Math.max(4, MAX_TOOL_NAME - prefix.length);
  const tool = sanitizeSegment(toolName).slice(0, room) || "tool";
  return `${prefix}${tool}`.slice(0, MAX_TOOL_NAME);
}

export function isMcpMetaTool(name: string): boolean {
  return name === LIST_MCP_TOOLS_NAME || name === CALL_MCP_TOOL_NAME;
}

export function isMcpChatTool(name: string): boolean {
  return name.startsWith("mcp_") || isMcpMetaTool(name);
}

function asParameters(inputSchema: unknown): Record<string, unknown> {
  if (inputSchema && typeof inputSchema === "object" && !Array.isArray(inputSchema)) {
    return inputSchema as Record<string, unknown>;
  }
  return { type: "object", properties: {} };
}

async function readMcpServers(): Promise<{
  enabled: boolean;
  injectIntoChat: boolean;
  servers: McpServerInput[];
  disabledTools: Set<string>;
  warnings: McpWarning[];
}> {
  const enabled = (await getAppSetting("mcp_enabled")) !== "false";
  const injectIntoChat = (await getAppSetting("mcp_inject_chat")) === "true";
  const disabledTools = new Set(parseStringArray(await getAppSetting("mcp_disabled_tools")));
  const warnings: McpWarning[] = [];
  const raw = await getAppSetting(MCP_SETTINGS_KEY);
  if (!raw) return { enabled, injectIntoChat, servers: [], disabledTools, warnings };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      warnings.push({
        server: MCP_SETTINGS_KEY,
        error: "Pengaturan MCP tersimpan bukan array server; simpan ulang di Global Settings.",
      });
      return { enabled, injectIntoChat, servers: [], disabledTools, warnings };
    }
    const decrypted = await decryptMcpServers(parsed);
    const servers: McpServerInput[] = [];
    for (const item of decrypted) {
      const result = McpServerInput.safeParse(item);
      if (result.success) {
        servers.push(result.data);
      } else {
        const name = (item as { name?: string } | null)?.name ?? "(tanpa nama)";
        const issues = result.error.issues.map((issue) =>
          `${issue.path.join(".")}: ${issue.message}`
        );
        log.warn("mcp server dropped by schema", { server: name, issues });
        warnings.push({ server: name, error: issues.join("; ") });
      }
    }
    return { enabled, injectIntoChat, servers, disabledTools, warnings };
  } catch (error) {
    log.warn("corrupt mcp_servers for chat", { error: String(error) });
    warnings.push({ server: MCP_SETTINGS_KEY, error: `JSON MCP tidak terbaca: ${String(error)}` });
    return { enabled, injectIntoChat, servers: [], disabledTools, warnings };
  }
}

function looksLikeBrowserMcp(server: McpServerInput, tool: McpTool): boolean {
  const haystack = `${server.name} ${server.id ?? ""} ${tool.name} ${tool.description ?? ""}`
    .toLowerCase();
  return /playwright|browser_|browser\b|navigate|screenshot|puppeteer|chrome|webkit/
    .test(haystack);
}

function toDef(
  server: McpServerInput,
  tool: McpTool,
  chatName: string,
): ToolDef {
  const serverLabel = server.name || server.id || "mcp";
  const parts = [
    `[MCP:${serverLabel}]`,
    tool.description?.trim() || `MCP tool ${tool.name}`,
  ];
  if (looksLikeBrowserMcp(server, tool)) {
    parts.push(
      "Only use when the user explicitly asks for browser automation or a live web page.",
    );
  } else {
    parts.push("Optional; use only if this external system is required for the request.");
  }
  return {
    name: chatName,
    description: parts.join(" ").slice(0, 1000),
    parameters: asParameters(tool.inputSchema),
  };
}

const LIST_MCP_TOOLS_DEF: ToolDef = {
  name: LIST_MCP_TOOLS_NAME,
  description:
    "List MCP tools from Global Settings (spawns servers as needed). Call this when you may " +
    "need an external MCP integration, then use call_mcp_tool. Optional server filter by name/id. " +
    "Do not use for normal file/doc/ticket work.",
  parameters: {
    type: "object",
    properties: {
      server: {
        type: "string",
        description: "Optional MCP server name or id. Omit to list all enabled servers.",
      },
    },
  },
};

const CALL_MCP_TOOL_DEF: ToolDef = {
  name: CALL_MCP_TOOL_NAME,
  description:
    "Call one MCP tool by server + tool name. Prefer list_mcp_tools first to learn the schema. " +
    "Only when the user request needs that external system. Do not open browser/Playwright " +
    "MCP unless the user asked for browser automation or a live web page.",
  parameters: {
    type: "object",
    properties: {
      server: {
        type: "string",
        description: "MCP server name or id (as in list_mcp_tools / Available MCP servers).",
      },
      tool: {
        type: "string",
        description: "Exact MCP tool name on that server.",
      },
      arguments: {
        type: "object",
        description: "Arguments object for the tool (use {} if none).",
        additionalProperties: true,
      },
    },
    required: ["server", "tool"],
  },
};

function activeServers(servers: McpServerInput[]): McpServerInput[] {
  return servers.filter((server) => server.enabled !== false);
}

function toSummaries(servers: McpServerInput[]): McpServerSummary[] {
  return activeServers(servers).map((server) => ({
    id: server.id ?? server.name,
    name: server.name,
  }));
}

/** Short prompt block (no process spawn). */
export function mcpPrompt(
  summaries: McpServerSummary[],
  mode: McpChatMode,
): string {
  if (mode === "off" || !summaries.length) return "";
  if (mode === "inject") {
    return "\n\nMCP tools are exposed as mcp_* functions. Call them only when the request " +
      "clearly needs that external system; do not open browser/Playwright MCP unless asked.";
  }
  return "\n\nAvailable MCP servers (call list_mcp_tools to inspect tool schemas, then " +
    "call_mcp_tool only when needed; do not open browser/Playwright MCP unless asked):\n" +
    summaries.map((server) => `- ${server.name}`).join("\n");
}

export async function loadMcpChatTools(): Promise<McpChatTools> {
  const { enabled, injectIntoChat, servers, disabledTools, warnings } = await readMcpServers();
  const serverSummaries = enabled ? toSummaries(servers) : [];
  if (!enabled) {
    return {
      defs: [],
      byName: new Map(),
      warnings,
      serverSummaries: [],
      mode: "off",
    };
  }

  if (!injectIntoChat) {
    return {
      defs: serverSummaries.length ? [LIST_MCP_TOOLS_DEF, CALL_MCP_TOOL_DEF] : [],
      byName: new Map(),
      warnings,
      serverSummaries,
      mode: "progressive",
    };
  }

  const active = activeServers(servers);
  const defs: ToolDef[] = [];
  const byName = new Map<string, McpToolBinding>();
  const usedNames = new Set<string>();

  const listed = await Promise.all(
    active.map(async (server) => {
      try {
        const tools = await listMcpTools(server);
        return { server, tools, error: null as string | null };
      } catch (error) {
        log.warn("mcp list for chat failed", {
          server: server.name,
          command: server.command ?? server.url,
          error: String(error),
        });
        return { server, tools: [] as McpTool[], error: (error as Error).message };
      }
    }),
  );

  for (const { server, tools, error } of listed) {
    if (error) warnings.push({ server: server.name || server.id || "mcp", error });
    const serverId = server.id ?? server.name;
    for (const tool of tools) {
      const disableKey = `${serverId}:${tool.name}`;
      if (disabledTools.has(disableKey)) continue;

      let chatName = mcpChatToolName(server.name, tool.name, serverId);
      if (usedNames.has(chatName) || byName.has(chatName)) {
        const alt = mcpChatToolName(
          `${server.name}_${serverId.slice(0, 6)}`,
          tool.name,
          serverId,
        );
        chatName = usedNames.has(alt) ? `${alt.slice(0, 58)}_${defs.length}` : alt;
      }
      usedNames.add(chatName);
      byName.set(chatName, { server, toolName: tool.name, disableKey });
      defs.push(toDef(server, tool, chatName));
      if (defs.length >= MAX_CHAT_MCP_TOOLS) {
        return { defs, byName, warnings, serverSummaries, mode: "inject" };
      }
    }
  }

  return { defs, byName, warnings, serverSummaries, mode: "inject" };
}

function resolveServer(
  servers: McpServerInput[],
  query: string,
): McpServerInput | null {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return null;
  return activeServers(servers).find((server) => {
    const id = (server.id ?? "").toLowerCase();
    return server.name.toLowerCase() === wanted || id === wanted;
  }) ?? null;
}

function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { value: parsed };
    } catch {
      return { value: text };
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return { value: raw };
}

export async function listMcpToolsForChat(args: Record<string, unknown>): Promise<string> {
  const { enabled, servers, disabledTools, warnings } = await readMcpServers();
  if (!enabled) return "MCP dinonaktifkan di Global Settings.";
  const filter = typeof args.server === "string" ? args.server.trim() : "";
  const targets = filter
    ? (() => {
      const match = resolveServer(servers, filter);
      return match ? [match] : [];
    })()
    : activeServers(servers);

  if (filter && targets.length === 0) {
    const available = toSummaries(servers).map((item) => item.name).join(", ") || "(tidak ada)";
    return `Server MCP "${filter}" tidak ditemukan. Tersedia: ${available}`;
  }
  if (!targets.length) {
    return warnings.length
      ? `Tidak ada server MCP aktif. Peringatan: ${
        warnings.map((item) => `${item.server}: ${item.error}`).join(" · ")
      }`
      : "Tidak ada server MCP aktif di Global Settings.";
  }

  const sections: string[] = [];
  for (const server of targets) {
    const serverId = server.id ?? server.name;
    try {
      const tools = await listMcpTools(server);
      const lines: string[] = [`## ${server.name} (id: ${serverId})`];
      let listed = 0;
      for (const tool of tools) {
        const disableKey = `${serverId}:${tool.name}`;
        if (disabledTools.has(disableKey)) continue;
        listed += 1;
        const desc = tool.description?.trim() || "(no description)";
        lines.push(`- ${tool.name}: ${desc}`);
        if (tool.inputSchema) {
          lines.push(`  inputSchema: ${JSON.stringify(tool.inputSchema)}`);
        }
      }
      if (!listed) lines.push("(no enabled tools)");
      sections.push(lines.join("\n"));
    } catch (error) {
      sections.push(
        `## ${server.name} (id: ${serverId})\nError: ${(error as Error).message}`,
      );
    }
  }

  const text = sections.join("\n\n").trim();
  return (text || "(empty)").slice(0, MAX_LIST_CHARS);
}

export async function callMcpToolForChat(args: Record<string, unknown>): Promise<string> {
  const { enabled, servers, disabledTools } = await readMcpServers();
  if (!enabled) return "MCP dinonaktifkan di Global Settings.";
  const serverQuery = String(args.server ?? "").trim();
  const toolName = String(args.tool ?? args.name ?? "").trim();
  if (!serverQuery) return "Error: server wajib diisi (nama atau id MCP).";
  if (!toolName) return "Error: tool wajib diisi.";
  const server = resolveServer(servers, serverQuery);
  if (!server) {
    const available = toSummaries(servers).map((item) => item.name).join(", ") || "(tidak ada)";
    return `Server MCP "${serverQuery}" tidak ditemukan. Tersedia: ${available}`;
  }
  const serverId = server.id ?? server.name;
  const disableKey = `${serverId}:${toolName}`;
  if (disabledTools.has(disableKey)) {
    return `Tool MCP ${server.name}/${toolName} dinonaktifkan di Global Settings.`;
  }
  const toolArgs = parseToolArguments(args.arguments ?? args.args);
  try {
    return await callMcpTool(server, toolName, toolArgs);
  } catch (error) {
    return `MCP error (${server.name}/${toolName}): ${(error as Error).message}`;
  }
}

export async function executeMcpChatTool(
  binding: McpToolBinding,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    return await callMcpTool(binding.server, binding.toolName, args);
  } catch (error) {
    return `MCP error (${binding.server.name}/${binding.toolName}): ${(error as Error).message}`;
  }
}
