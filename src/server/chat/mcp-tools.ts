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

export interface McpChatTools {
  defs: ToolDef[];
  byName: Map<string, McpToolBinding>;
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

export function isMcpChatTool(name: string): boolean {
  return name.startsWith("mcp_");
}

function asParameters(inputSchema: unknown): Record<string, unknown> {
  if (inputSchema && typeof inputSchema === "object" && !Array.isArray(inputSchema)) {
    return inputSchema as Record<string, unknown>;
  }
  return { type: "object", properties: {} };
}

async function readMcpServers(): Promise<{
  enabled: boolean;
  servers: McpServerInput[];
  disabledTools: Set<string>;
}> {
  const enabled = (await getAppSetting("mcp_enabled")) !== "false";
  const disabledTools = new Set(parseStringArray(await getAppSetting("mcp_disabled_tools")));
  const raw = await getAppSetting(MCP_SETTINGS_KEY);
  if (!raw) return { enabled, servers: [], disabledTools };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { enabled, servers: [], disabledTools };
    const decrypted = await decryptMcpServers(parsed);
    const servers: McpServerInput[] = [];
    for (const item of decrypted) {
      const result = McpServerInput.safeParse(item);
      if (result.success) servers.push(result.data);
    }
    return { enabled, servers, disabledTools };
  } catch (error) {
    log.debug("corrupt mcp_servers for chat", { error: String(error) });
    return { enabled, servers: [], disabledTools };
  }
}

function toDef(
  server: McpServerInput,
  tool: McpTool,
  chatName: string,
): ToolDef {
  const serverLabel = server.name || server.id || "mcp";
  const description = [
    `[MCP:${serverLabel}]`,
    tool.description?.trim() || `MCP tool ${tool.name}`,
  ].join(" ");
  return {
    name: chatName,
    description: description.slice(0, 1000),
    parameters: asParameters(tool.inputSchema),
  };
}

export async function loadMcpChatTools(): Promise<McpChatTools> {
  const { enabled, servers, disabledTools } = await readMcpServers();
  if (!enabled) return { defs: [], byName: new Map() };

  const active = servers.filter((server) => server.enabled !== false);
  const defs: ToolDef[] = [];
  const byName = new Map<string, McpToolBinding>();
  const usedNames = new Set<string>();

  const listed = await Promise.all(
    active.map(async (server) => {
      try {
        const tools = await listMcpTools(server);
        return { server, tools, error: null as string | null };
      } catch (error) {
        log.debug("mcp list for chat failed", {
          server: server.name,
          error: String(error),
        });
        return { server, tools: [] as McpTool[], error: (error as Error).message };
      }
    }),
  );

  for (const { server, tools } of listed) {
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
        return { defs, byName };
      }
    }
  }

  return { defs, byName };
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
