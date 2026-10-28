import { isAbsolute, join } from "node:path";
import { type LspServerInput, LspSettingsInput } from "../config/schema.ts";
import { log } from "../core/logger.ts";
import { getAppSetting, setAppSetting } from "../db/db.ts";

export const LSP_SETTINGS_KEY = "lsp_settings";
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_CONNECTIONS_PER_PROJECT = 3;

export interface LspSettings {
  enabled: boolean;
  servers: LspServerInput[];
}

export interface LspPresetVariant {
  label: string;
  mode: "local" | "npx";
  command: string;
  args: string[];
}

export interface LspPreset {
  id: string;
  name: string;
  languages: string[];
  note?: string;
  variants: LspPresetVariant[];
}

const PRESETS: LspPreset[] = [
  {
    id: "typescript",
    name: "TypeScript / JavaScript",
    languages: ["typescript", "javascript"],
    note: "Monaco sudah punya TS/JS worker internal; server eksternal bersifat opsional.",
    variants: [
      {
        label: "Lokal (typescript-language-server)",
        mode: "local",
        command: "typescript-language-server",
        args: ["--stdio"],
      },
      {
        label: "npx",
        mode: "npx",
        command: "npx",
        args: ["--yes", "typescript-language-server", "--stdio"],
      },
    ],
  },
  {
    id: "python",
    name: "Python",
    languages: ["python"],
    variants: [
      {
        label: "Lokal (pyright-langserver)",
        mode: "local",
        command: "pyright-langserver",
        args: ["--stdio"],
      },
      {
        label: "npx",
        mode: "npx",
        command: "npx",
        args: ["--yes", "pyright-langserver", "--stdio"],
      },
    ],
  },
  {
    id: "yaml",
    name: "YAML",
    languages: ["yaml"],
    variants: [
      {
        label: "Lokal (yaml-language-server)",
        mode: "local",
        command: "yaml-language-server",
        args: ["--stdio"],
      },
      {
        label: "npx",
        mode: "npx",
        command: "npx",
        args: ["--yes", "yaml-language-server", "--stdio"],
      },
    ],
  },
  {
    id: "bash",
    name: "Bash / Shell",
    languages: ["shell"],
    variants: [
      {
        label: "Lokal (bash-language-server)",
        mode: "local",
        command: "bash-language-server",
        args: ["start"],
      },
      {
        label: "npx",
        mode: "npx",
        command: "npx",
        args: ["--yes", "bash-language-server", "start"],
      },
    ],
  },
  {
    id: "go",
    name: "Go",
    languages: ["go"],
    note: "Install dengan: go install golang.org/x/tools/gopls@latest",
    variants: [{ label: "Lokal (gopls)", mode: "local", command: "gopls", args: [] }],
  },
  {
    id: "rust",
    name: "Rust",
    languages: ["rust"],
    note: "Install rust-analyzer melalui rustup.",
    variants: [
      { label: "Lokal (rust-analyzer)", mode: "local", command: "rust-analyzer", args: [] },
    ],
  },
  {
    id: "clangd",
    name: "C / C++",
    languages: ["c", "cpp"],
    variants: [{ label: "Lokal (clangd)", mode: "local", command: "clangd", args: [] }],
  },
  {
    id: "lua",
    name: "Lua",
    languages: ["lua"],
    variants: [
      {
        label: "Lokal (lua-language-server)",
        mode: "local",
        command: "lua-language-server",
        args: [],
      },
    ],
  },
];

export function lspPresets(): LspPreset[] {
  return PRESETS;
}

export async function readLspSettings(): Promise<LspSettings> {
  const raw = await getAppSetting(LSP_SETTINGS_KEY);
  if (!raw) return { enabled: false, servers: [] };
  try {
    const parsed = LspSettingsInput.safeParse(JSON.parse(raw));
    if (!parsed.success) return { enabled: false, servers: [] };
    return { enabled: parsed.data.enabled, servers: parsed.data.servers };
  } catch (error) {
    log.debug("corrupt lsp_settings JSON", { error: String(error) });
    return { enabled: false, servers: [] };
  }
}

export async function writeLspSettings(settings: LspSettings): Promise<LspSettings> {
  const servers = settings.servers.map((server) => ({
    ...server,
    id: server.id ?? crypto.randomUUID(),
  }));
  const next = { enabled: settings.enabled, servers };
  await setAppSetting(LSP_SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function matchLspServer(
  settings: LspSettings,
  language: string,
): LspServerInput | null {
  if (!settings.enabled) return null;
  const normalized = language.trim().toLowerCase();
  return settings.servers.find(
    (server) =>
      server.enabled && server.languages.some((item) => item.toLowerCase() === normalized),
  ) ?? null;
}

const resolveCache = new Map<string, string | null>();

function isExecutable(path: string): boolean {
  try {
    const stat = Deno.statSync(path);
    return stat.isFile;
  } catch {
    return false;
  }
}

function pathExts(): string[] {
  if (Deno.build.os !== "windows") return [""];
  const raw = Deno.env.get("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD";
  return ["", ...raw.split(";").filter(Boolean)];
}

function candidatePaths(command: string): string[] {
  const exts = pathExts();
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return exts.map((ext) => `${command}${ext}`);
  }
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "";
  const pathValue = Deno.env.get("PATH") ?? "";
  const dirs = [
    ...pathValue.split(Deno.build.os === "windows" ? ";" : ":"),
    ...(Deno.build.os === "darwin"
      ? ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
      : []),
    ...(home
      ? [join(home, ".local", "bin"), join(home, ".cargo", "bin"), join(home, "go", "bin")]
      : []),
  ].filter(Boolean);
  const out: string[] = [];
  for (const dir of dirs) {
    for (const ext of exts) out.push(join(dir, `${command}${ext}`));
  }
  return out;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function resolveViaLoginShell(command: string): Promise<string | null> {
  if (Deno.build.os === "windows") return null;
  const shell = Deno.env.get("SHELL") ?? "/bin/zsh";
  if (!isExecutable(shell)) return null;
  try {
    const proc = await new Deno.Command(shell, {
      args: ["-lc", `command -v ${shellQuote(command)}`],
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      signal: AbortSignal.timeout(2500),
    }).output();
    if (!proc.success) return null;
    const found = new TextDecoder().decode(proc.stdout).trim().split(/\r?\n/).pop()?.trim();
    return found && isExecutable(found) ? found : null;
  } catch {
    return null;
  }
}

export async function resolveExecutable(command: string): Promise<string | null> {
  const key = command.trim();
  if (!key) return null;
  if (resolveCache.has(key)) return resolveCache.get(key) ?? null;

  let found: string | null = null;
  for (const candidate of candidatePaths(key)) {
    if (isExecutable(candidate)) {
      found = candidate;
      break;
    }
  }
  if (!found) found = await resolveViaLoginShell(key);
  resolveCache.set(key, found);
  return found;
}

export interface LspProbeResult {
  found: boolean;
  path?: string;
  command: string;
}

export async function probeLspCommand(command: string): Promise<LspProbeResult> {
  const resolved = await resolveExecutable(command);
  return resolved ? { found: true, path: resolved, command } : { found: false, command };
}

export class LspFrameParser {
  private buffer = new Uint8Array(0);
  private readonly decoder = new TextDecoder();

  push(chunk: Uint8Array): string[] {
    if (chunk.byteLength === 0) return [];
    const next = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
    next.set(this.buffer, 0);
    next.set(chunk, this.buffer.byteLength);
    this.buffer = next;

    const messages: string[] = [];
    while (true) {
      const headerEnd = this.findHeaderEnd();
      if (headerEnd < 0) break;
      const header = this.decoder.decode(this.buffer.subarray(0, headerEnd));
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      if (!Number.isFinite(length) || length < 0 || length > MAX_FRAME_BYTES) {
        throw new Error(`LSP frame terlalu besar (${match[1]} byte).`);
      }
      const total = headerEnd + 4 + length;
      if (this.buffer.byteLength < total) break;
      const body = this.buffer.subarray(headerEnd + 4, total);
      messages.push(this.decoder.decode(body));
      this.buffer = this.buffer.subarray(total);
    }
    return messages;
  }

  private findHeaderEnd(): number {
    const limit = Math.min(this.buffer.byteLength, 16_384);
    for (let i = 0; i + 3 < limit; i++) {
      if (
        this.buffer[i] === 13 &&
        this.buffer[i + 1] === 10 &&
        this.buffer[i + 2] === 13 &&
        this.buffer[i + 3] === 10
      ) {
        return i;
      }
    }
    return -1;
  }
}

export function encodeLspFrame(payload: unknown): Uint8Array {
  const json = typeof payload === "string" ? payload : JSON.stringify(payload);
  const body = new TextEncoder().encode(json);
  const header = new TextEncoder().encode(`Content-Length: ${body.byteLength}\r\n\r\n`);
  const out = new Uint8Array(header.byteLength + body.byteLength);
  out.set(header, 0);
  out.set(body, header.byteLength);
  return out;
}

function connectionKey(projectId: string): string {
  return projectId;
}

const activeConnections = new Map<string, number>();

export interface LspLaunchConfig extends LspServerInput {
  command: string;
}

export function handleLsp(
  req: Request,
  projectId: string,
  workspace: string,
  config: LspLaunchConfig,
): Response {
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket upgrade required", { status: 400 });
  }

  const key = connectionKey(projectId);
  const active = activeConnections.get(key) ?? 0;
  if (active >= MAX_CONNECTIONS_PER_PROJECT) {
    return new Response("Terlalu banyak koneksi LSP aktif.", { status: 429 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  const parser = new LspFrameParser();
  let proc: Deno.ChildProcess | null = null;
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let closed = false;
  let counted = false;
  let writeChain: Promise<unknown> = Promise.resolve();
  let stderrBuffer = "";

  const increment = () => {
    if (counted) return;
    counted = true;
    activeConnections.set(key, (activeConnections.get(key) ?? 0) + 1);
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (counted) {
      const next = Math.max(0, (activeConnections.get(key) ?? 1) - 1);
      if (next === 0) activeConnections.delete(key);
      else activeConnections.set(key, next);
    }
    try {
      void writer?.close();
    } catch {
      // ignore
    }
    writer = null;
    if (proc) {
      const child = proc;
      proc = null;
      try {
        child.kill("SIGTERM");
      } catch {
        // already exited
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already exited
        }
      }, 3000);
    }
  };

  const send = (payload: unknown) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };

  const write = (bytes: Uint8Array) => {
    if (!writer || closed) return;
    writeChain = writeChain
      .then(() => writer?.write(bytes))
      .catch(() => cleanup());
  };

  const forwardStderr = (chunk: Uint8Array) => {
    if (closed) return;
    stderrBuffer += new TextDecoder().decode(chunk);
    const lines = stderrBuffer.split(/\r?\n/);
    stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const message = line.trim();
      if (!message) continue;
      send({
        jsonrpc: "2.0",
        method: "window/logMessage",
        params: { type: 4, message: message.slice(0, 4000) },
      });
    }
    if (stderrBuffer.length > 20_000) stderrBuffer = stderrBuffer.slice(-4000);
  };

  const pumpStdout = async (child: Deno.ChildProcess) => {
    const reader = child.stdout.getReader();
    try {
      while (!closed) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        for (const raw of parser.push(value)) send(JSON.parse(raw));
      }
    } catch (error) {
      if (!closed) {
        log.debug("lsp stdout error", { error: String(error) });
        try {
          socket.close(1011, "LSP output error");
        } catch {
          // ignore
        }
      }
    } finally {
      reader.releaseLock();
      cleanup();
    }
  };

  const pumpStderr = async (child: Deno.ChildProcess) => {
    const reader = child.stderr.getReader();
    try {
      while (!closed) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) forwardStderr(value);
      }
    } catch {
      // ignore stderr failures
    } finally {
      reader.releaseLock();
    }
  };

  socket.onopen = () => {
    increment();
    try {
      const env = { ...Deno.env.toObject(), ...config.env };
      proc = new Deno.Command(config.command, {
        args: config.args,
        cwd: workspace,
        env,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      writer = proc.stdin.getWriter();
      void pumpStdout(proc);
      void pumpStderr(proc);
    } catch (error) {
      log.warn("failed to start language server", {
        command: config.command,
        error: String(error),
      });
      try {
        socket.close(1011, `Gagal menjalankan ${config.command}`);
      } catch {
        // ignore
      }
      cleanup();
    }
  };

  socket.onmessage = (event) => {
    if (closed) return;
    try {
      let payload: unknown;
      if (typeof event.data === "string") {
        payload = JSON.parse(event.data);
      } else if (event.data instanceof ArrayBuffer) {
        payload = JSON.parse(new TextDecoder().decode(new Uint8Array(event.data)));
      } else if (event.data instanceof Uint8Array) {
        payload = JSON.parse(new TextDecoder().decode(event.data));
      } else {
        return;
      }
      write(encodeLspFrame(payload));
    } catch (error) {
      log.debug("invalid LSP client message", { error: String(error) });
    }
  };

  socket.onclose = cleanup;
  socket.onerror = cleanup;

  return response;
}

export { MAX_FRAME_BYTES };
