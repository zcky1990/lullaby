import type { McpServerInput } from "../config/schema.ts";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

const LIST_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 60_000;
const MAX_TOOLS = 200;
const MAX_RESULT_CHARS = 60_000;

const CLIENT_INFO = { name: "Lullaby", version: "0.1.0" };
const PROTOCOL_VERSION = "2024-11-05";

function normalizeTools(value: unknown): McpTool[] {
  const tools = (value as { tools?: unknown } | null)?.tools;
  if (!Array.isArray(tools)) return [];
  const out: McpTool[] = [];
  for (const item of tools) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) continue;
    out.push({
      name,
      description: typeof record.description === "string"
        ? record.description.slice(0, 1000)
        : undefined,
      inputSchema: record.inputSchema,
    });
    if (out.length >= MAX_TOOLS) break;
  }
  return out;
}

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { message?: string; code?: number };
}

function assertResult(response: JsonRpcResponse, method: string): unknown {
  if (response.error) {
    throw new Error(`${method}: ${response.error.message ?? "MCP error"}`);
  }
  return response.result;
}

export function formatMcpToolResult(result: unknown): string {
  if (result == null) return "(empty)";
  if (typeof result === "string") return result.slice(0, MAX_RESULT_CHARS);
  if (typeof result !== "object") return String(result).slice(0, MAX_RESULT_CHARS);
  const record = result as Record<string, unknown>;
  if (Array.isArray(record.content)) {
    const parts: string[] = [];
    for (const item of record.content) {
      if (!item || typeof item !== "object") continue;
      const block = item as Record<string, unknown>;
      if (block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      } else if (typeof block.text === "string") {
        parts.push(block.text);
      } else {
        parts.push(JSON.stringify(block));
      }
    }
    const text = parts.join("\n").trim();
    const prefix = record.isError === true ? "[MCP error]\n" : "";
    return `${prefix}${text || JSON.stringify(result)}`.slice(0, MAX_RESULT_CHARS);
  }
  return JSON.stringify(result).slice(0, MAX_RESULT_CHARS);
}

type RpcFn = (method: string, params: unknown, timeoutMs?: number) => Promise<unknown>;

async function withStdioSession<T>(
  server: McpServerInput,
  fn: (rpc: RpcFn) => Promise<T>,
): Promise<T> {
  if (!server.command) throw new Error("Command MCP belum diisi.");
  const command = new Deno.Command(server.command, {
    args: server.args ?? [],
    env: server.env ?? {},
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();
  const writer = child.stdin.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = child.stdout.getReader();
  const pending = new Map<number, (value: JsonRpcResponse) => void>();
  let buffer = "";

  const pump = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf("\n");
        while (index >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          index = buffer.indexOf("\n");
          if (!line) continue;
          try {
            const message = JSON.parse(line) as JsonRpcResponse;
            if (typeof message.id === "number") {
              pending.get(message.id)?.(message);
              pending.delete(message.id);
            }
          } catch {
            // ignore non-JSON output/log lines
          }
        }
      }
    } catch {
      // stream closed
    }
  })();

  let nextId = 1;
  const rpc: RpcFn = (method, params, timeoutMs = LIST_TIMEOUT_MS) => {
    const id = nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method}: timeout ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, (message) => {
        clearTimeout(timer);
        try {
          resolve(assertResult(message, method));
        } catch (error) {
          reject(error);
        }
      });
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
      writer.write(encoder.encode(payload)).catch((error) => {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      });
    });
  };

  try {
    await rpc("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
    await writer.write(
      encoder.encode(
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
      ),
    );
    return await fn(rpc);
  } finally {
    await writer.close().catch(() => {});
    await reader.cancel().catch(() => {});
    try {
      child.kill();
    } catch {
      // already exited
    }
    await pump.catch(() => {});
  }
}

async function readRpcResponse(res: Response): Promise<JsonRpcResponse> {
  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        return JSON.parse(data) as JsonRpcResponse;
      } catch {
        // try next event
      }
    }
    throw new Error("Respons SSE MCP tidak berisi JSON-RPC.");
  }
  try {
    return JSON.parse(text) as JsonRpcResponse;
  } catch {
    throw new Error(`Respons MCP bukan JSON: ${text.slice(0, 200)}`);
  }
}

async function withHttpSession<T>(
  server: McpServerInput,
  fn: (rpc: RpcFn) => Promise<T>,
): Promise<T> {
  if (!server.url) throw new Error("URL MCP belum diisi.");
  let sessionId = "";

  const send = async (payload: unknown, timeoutMs: number): Promise<JsonRpcResponse> => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(server.headers ?? {}),
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const res = await fetch(server.url!, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const nextSession = res.headers.get("mcp-session-id");
    if (nextSession) sessionId = nextSession;
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return await readRpcResponse(res);
  };

  let nextId = 1;
  const rpc: RpcFn = async (method, params, timeoutMs = LIST_TIMEOUT_MS) => {
    const id = nextId++;
    const response = await send({ jsonrpc: "2.0", id, method, params }, timeoutMs);
    return assertResult(response, method);
  };

  await rpc("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO,
  });
  await send({ jsonrpc: "2.0", method: "notifications/initialized" }, LIST_TIMEOUT_MS).catch(
    () => {},
  );
  return await fn(rpc);
}

function withMcpSession<T>(
  server: McpServerInput,
  fn: (rpc: RpcFn) => Promise<T>,
): Promise<T> {
  return server.transport === "http" ? withHttpSession(server, fn) : withStdioSession(server, fn);
}

const toolsCache = new Map<string, { at: number; tools: McpTool[] }>();
const TOOLS_CACHE_MS = 60_000;

function toolsCacheKey(server: McpServerInput): string {
  return JSON.stringify({
    id: server.id ?? "",
    transport: server.transport,
    command: server.command ?? "",
    args: server.args ?? [],
    url: server.url ?? "",
    env: server.env ?? {},
    headers: server.headers ?? {},
  });
}

export async function listMcpTools(server: McpServerInput): Promise<McpTool[]> {
  const key = toolsCacheKey(server);
  const cached = toolsCache.get(key);
  if (cached && Date.now() - cached.at < TOOLS_CACHE_MS) return cached.tools;

  const tools = await withMcpSession(server, async (rpc) => {
    const result = await rpc("tools/list", {});
    return normalizeTools(result);
  });
  toolsCache.set(key, { at: Date.now(), tools });
  return tools;
}

export async function callMcpTool(
  server: McpServerInput,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (!name.trim()) throw new Error("Nama tool MCP kosong.");
  const result = await withMcpSession(server, async (rpc) => {
    return await rpc("tools/call", { name, arguments: args }, CALL_TIMEOUT_MS);
  });
  return formatMcpToolResult(result);
}

/** Test helper: clear list cache. */
export function clearMcpToolsCache(): void {
  toolsCache.clear();
}
