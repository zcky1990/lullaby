import type { McpServerInput } from "../config/schema.ts";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

const TIMEOUT_MS = 15_000;
const MAX_TOOLS = 200;

const CLIENT_INFO = { name: "rnd-workflow", version: "0.1.0" };
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

async function listStdioTools(server: McpServerInput): Promise<McpTool[]> {
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
  const request = (method: string, params: unknown): Promise<JsonRpcResponse> => {
    const id = nextId++;
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method}: timeout ${TIMEOUT_MS}ms`));
      }, TIMEOUT_MS);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
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
    const init = await request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
    assertResult(init, "initialize");
    await writer.write(
      encoder.encode(
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
      ),
    );
    const listed = await request("tools/list", {});
    const result = assertResult(listed, "tools/list") as { tools?: unknown };
    return normalizeTools(result);
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

async function listHttpTools(server: McpServerInput): Promise<McpTool[]> {
  if (!server.url) throw new Error("URL MCP belum diisi.");
  let sessionId = "";

  const send = async (payload: unknown): Promise<JsonRpcResponse> => {
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const nextSession = res.headers.get("mcp-session-id");
    if (nextSession) sessionId = nextSession;
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return await readRpcResponse(res);
  };

  const init = await send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    },
  });
  assertResult(init, "initialize");
  await send({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});
  const listed = await send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const result = assertResult(listed, "tools/list") as { tools?: unknown };
  return normalizeTools(result);
}

export function listMcpTools(server: McpServerInput): Promise<McpTool[]> {
  return server.transport === "http" ? listHttpTools(server) : listStdioTools(server);
}
