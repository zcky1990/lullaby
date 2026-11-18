import { basename } from "node:path";
import type { McpServerInput } from "../config/schema.ts";
import { resolveExecutable, spawnEnvForCommand } from "./lsp.ts";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

const LIST_TIMEOUT_MS = 60_000;
/** Cold `npx -y @pkg` often exceeds 15s on first download. */
const INIT_TIMEOUT_MS = 60_000;
const CALL_TIMEOUT_MS = 60_000;
const MAX_TOOLS = 200;
const MAX_RESULT_CHARS = 60_000;
const MAX_STDERR_CHARS = 2000;

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

function stderrDetail(tail: string): string {
  const text = tail.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 400) : "";
}

/** `@scope/name@version` / `name@version` → bare package name for require.resolve. */
export function stripNpmPackageSpec(spec: string): string {
  const trimmed = spec.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("@")) {
    const parts = trimmed.slice(1).split("@");
    return `@${parts[0]}`;
  }
  const at = trimmed.lastIndexOf("@");
  return at > 0 ? trimmed.slice(0, at) : trimmed;
}

function firstNpxPackageArg(args: string[]): { packageSpec: string; rest: string[] } | null {
  const rest: string[] = [];
  let packageSpec: string | null = null;
  for (const arg of args) {
    if (packageSpec) {
      rest.push(arg);
      continue;
    }
    if (arg === "-y" || arg === "--yes" || arg === "--") continue;
    if (arg.startsWith("-")) continue;
    packageSpec = arg;
  }
  return packageSpec ? { packageSpec, rest } : null;
}

/**
 * Prefer `node /path/to/cli.js` over `npx -y @pkg` when the package is already
 * installed (home node_modules, global, or npm/_npx cache). Avoids cold npx
 * download + wrapper PATH issues; Deno resolves system `node` via PATH enrichment.
 */
export async function preferNodeOverNpx(
  executable: string,
  args: string[],
  env: Record<string, string>,
): Promise<{ executable: string; args: string[] } | null> {
  const base = basename(executable).toLowerCase().replace(/\.cmd$/i, "");
  if (base !== "npx") return null;
  const parsed = firstNpxPackageArg(args);
  if (!parsed) return null;

  const node = await resolveExecutable("node");
  if (!node) return null;

  const packageName = stripNpmPackageSpec(parsed.packageSpec);
  const script = `
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
const name = ${JSON.stringify(packageName)};
const home = process.env.HOME || process.env.USERPROFILE || "";
const roots = [
  process.cwd(),
  home,
  path.join(home, ".local", "lib"),
  "/opt/homebrew/lib",
  "/usr/local/lib",
].filter(Boolean);
function tryPkg(fromDir) {
  try {
    return createRequire(path.join(fromDir, "package.json")).resolve(name + "/package.json");
  } catch {
    return null;
  }
}
let pkgJson = null;
for (const root of roots) {
  pkgJson = tryPkg(root);
  if (pkgJson) break;
  const npxRoot = path.join(root === home ? path.join(home, ".npm") : root, "_npx");
  try {
    for (const ent of fs.readdirSync(npxRoot, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      pkgJson = tryPkg(path.join(npxRoot, ent.name));
      if (pkgJson) break;
    }
  } catch { /* missing cache */ }
  if (pkgJson) break;
}
if (!pkgJson) process.exit(2);
const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
const dir = path.dirname(pkgJson);
let bin = pkg.bin;
if (!bin) process.exit(3);
if (typeof bin === "object") bin = bin[Object.keys(bin)[0]];
process.stdout.write(path.resolve(dir, bin));
`;

  try {
    const out = await new Deno.Command(node, {
      args: ["-e", script],
      env: { ...env, ...(await spawnEnvForCommand(node, env)) },
      stdout: "piped",
      stderr: "null",
      signal: AbortSignal.timeout(8_000),
    }).output();
    if (!out.success) return null;
    const binPath = new TextDecoder().decode(out.stdout).trim();
    if (!binPath) return null;
    await Deno.stat(binPath);
    return { executable: node, args: [binPath, ...parsed.rest] };
  } catch {
    return null;
  }
}

async function withStdioSession<T>(
  server: McpServerInput,
  fn: (rpc: RpcFn) => Promise<T>,
): Promise<T> {
  if (!server.command) throw new Error("Command MCP belum diisi.");

  // App yang dijalankan dari Finder/Dock mewarisi PATH minimal, sehingga CLI
  // seperti `figcraft-cli` (homebrew, ~/.local/bin, nvm, dst.) tidak ketemu bila
  // di-spawn apa adanya. Resolve dulu seperti LSP.
  let executable = await resolveExecutable(server.command);
  if (!executable) {
    throw new Error(
      `Command "${server.command}" tidak ditemukan di PATH. Isi path absolut ` +
        `(mis. /opt/homebrew/bin/${server.command}) lalu simpan ulang server-nya.`,
    );
  }

  let args = server.args ?? [];
  // npx resolves via login shell / ~/.local/bin, tapi child tetap butuh `node`
  // di PATH — Dock PATH sering minimal → exit 127 "node: No such file or directory".
  let env = await spawnEnvForCommand(executable, server.env);
  const rewritten = await preferNodeOverNpx(executable, args, env);
  if (rewritten) {
    executable = rewritten.executable;
    args = rewritten.args;
    env = await spawnEnvForCommand(executable, server.env);
  }

  const command = new Deno.Command(executable, {
    args,
    env,
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

  // stderr harus terus dibaca: pipe penuh memblokir child (CLI yang menulis log),
  // dan isinya dipakai untuk menjelaskan kegagalan start.
  let stderrTail = "";
  const stderrPump = (async () => {
    const stderrReader = child.stderr.getReader();
    const stderrDecoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await stderrReader.read();
        if (done) break;
        stderrTail = (stderrTail + stderrDecoder.decode(value, { stream: true }))
          .slice(-MAX_STDERR_CHARS);
      }
    } catch {
      // stream closed
    }
  })();

  let exitCode: number | null = null;
  const exitPromise = child.status.then((status) => {
    exitCode = status.code;
  }).catch(() => {
    exitCode = null;
  });

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
    let rejectStart: (error: Error) => void = () => {};
    const startFailed = new Promise<never>((_resolve, reject) => {
      rejectStart = reject;
    });
    // Guard: hindari unhandled rejection bila handshake sukses lebih dulu.
    startFailed.catch(() => {});
    void exitPromise.then(() => {
      const detail = stderrDetail(stderrTail);
      rejectStart(
        new Error(
          `${server.command}: proses berhenti sebelum handshake MCP ` +
            `(exit ${exitCode ?? "?"})${detail ? ` — ${detail}` : ""}`,
        ),
      );
    });

    const initialize = rpc("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    }, INIT_TIMEOUT_MS);
    initialize.catch(() => {});
    await Promise.race([initialize, startFailed]);

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
    await stderrPump.catch(() => {});
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
