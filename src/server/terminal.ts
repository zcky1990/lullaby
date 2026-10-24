import { Pty } from "@sigma/pty-ffi";

const FLUSH_MS = 8;
const MAX_BATCH_BYTES = 32_768;
const POLL_IDLE_MS = 8;

function resolveShell(): string {
  const shell = Deno.env.get("SHELL") || "/bin/sh";
  if (!/^\/[A-Za-z0-9._/-]+$/.test(shell)) return "/bin/sh";
  return shell;
}

function shellArgs(shell: string): string[] {
  const base = shell.split("/").pop() ?? shell;
  if (base === "zsh" || base === "bash" || base === "fish") return ["-i"];
  return [];
}

export function clampTerminalSize(cols: number, rows: number): { cols: number; rows: number } {
  const nextCols = Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : 80;
  const nextRows = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 24;
  return {
    cols: Math.min(Math.max(nextCols, 2), 500),
    rows: Math.min(Math.max(nextRows, 1), 200),
  };
}

export function parseTerminalSize(url: string): { cols: number; rows: number } {
  try {
    const parsed = new URL(url);
    return clampTerminalSize(
      Number(parsed.searchParams.get("cols")),
      Number(parsed.searchParams.get("rows")),
    );
  } catch {
    return { cols: 80, rows: 24 };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function handleTerminal(req: Request, cwd: string): Response {
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket upgrade required", { status: 400 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  const initialSize = parseTerminalSize(req.url);
  let pty: Pty | null = null;
  let closed = false;
  let pending: Uint8Array[] = [];
  let pendingLen = 0;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;

  const sendJson = (payload: unknown) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };

  const flush = () => {
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    if (!pendingLen || socket.readyState !== WebSocket.OPEN) {
      pending = [];
      pendingLen = 0;
      return;
    }
    const out = new Uint8Array(pendingLen);
    let offset = 0;
    for (const chunk of pending) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    pending = [];
    pendingLen = 0;
    socket.send(out);
  };

  const enqueue = (chunk: Uint8Array) => {
    if (!chunk.byteLength || closed) return;
    pending.push(chunk);
    pendingLen += chunk.byteLength;
    if (pendingLen >= MAX_BATCH_BYTES) {
      flush();
      return;
    }
    if (flushTimer === undefined) {
      flushTimer = setTimeout(flush, FLUSH_MS);
    }
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    pending = [];
    pendingLen = 0;
    try {
      pty?.close();
    } catch {
      // ignore
    }
    pty = null;
  };

  const pump = async () => {
    while (!closed && pty) {
      let got = false;
      try {
        for (let i = 0; i < 64; i++) {
          const { data, done } = pty.readBytes();
          if (done) {
            flush();
            sendJson({ type: "exit", code: pty.exitCode ?? 0 });
            cleanup();
            if (socket.readyState === WebSocket.OPEN) socket.close();
            return;
          }
          if (data.byteLength) {
            enqueue(data);
            got = true;
          } else {
            break;
          }
        }
      } catch (error) {
        flush();
        sendJson({ type: "error", message: (error as Error).message });
        cleanup();
        if (socket.readyState === WebSocket.OPEN) socket.close();
        return;
      }
      await sleep(got ? 0 : POLL_IDLE_MS);
    }
  };

  socket.onopen = () => {
    const shell = resolveShell();
    try {
      pty = new Pty(shell, {
        args: shellArgs(shell),
        cwd,
        env: {
          ...Deno.env.toObject(),
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          SHELL: shell,
        },
        size: initialSize,
      });
    } catch (error) {
      sendJson({ type: "error", message: (error as Error).message });
      socket.close();
      return;
    }
    sendJson({ type: "ready", cwd, shell });
    void pump();
  };

  socket.onmessage = (event) => {
    if (closed || !pty) return;
    if (typeof event.data !== "string") {
      const applyBytes = (bytes: Uint8Array) => {
        if (!bytes.byteLength || !pty) return;
        try {
          pty.write(new TextDecoder().decode(bytes));
        } catch {
          // ignore write failures
        }
      };
      if (event.data instanceof ArrayBuffer) {
        applyBytes(new Uint8Array(event.data));
      } else if (event.data instanceof Uint8Array) {
        applyBytes(event.data);
      } else if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then((buf) => applyBytes(new Uint8Array(buf)));
      }
      return;
    }
    try {
      const message = JSON.parse(event.data) as {
        type?: string;
        data?: string;
        cols?: number;
        rows?: number;
      };
      if (message.type === "input" && typeof message.data === "string") {
        pty.write(message.data);
      } else if (message.type === "resize") {
        pty.resize(clampTerminalSize(Number(message.cols), Number(message.rows)));
      }
    } catch {
      // ignore malformed messages
    }
  };

  socket.onclose = cleanup;
  socket.onerror = cleanup;

  return response;
}
