const encoder = new TextEncoder();

function shellArgs(shell: string): string[] {
  if (Deno.build.os === "darwin") {
    return ["-q", "/dev/null", shell, "-i"];
  }
  return ["-q", "-f", "-c", `${shell} -i`, "/dev/null"];
}

export function handleTerminal(req: Request, cwd: string | null): Response {
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket upgrade required", { status: 400 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  let child: Deno.ChildProcess | null = null;
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let closed = false;

  const send = (payload: unknown) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    try {
      writer?.close().catch(() => {});
    } catch {
      // ignore
    }
    try {
      child?.kill("SIGTERM");
    } catch {
      // already exited
    }
  };

  socket.onopen = () => {
    const shell = Deno.env.get("SHELL") || "/bin/sh";
    const directory = cwd || Deno.env.get("HOME") || Deno.cwd();
    try {
      child = new Deno.Command("/usr/bin/script", {
        args: shellArgs(shell),
        cwd: directory,
        env: { TERM: "xterm-256color", COLORTERM: "truecolor" },
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
    } catch (error) {
      send({ type: "error", message: (error as Error).message });
      socket.close();
      return;
    }

    writer = child.stdin.getWriter();
    send({ type: "ready", cwd: directory, shell });

    const pump = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) send({ type: "data", data: decoder.decode(value, { stream: true }) });
        }
      } catch {
        // stream closed
      } finally {
        reader.releaseLock();
      }
    };

    void pump(child.stdout);
    void pump(child.stderr);

    child.status.then((status) => {
      send({ type: "exit", code: status.code });
      cleanup();
      if (socket.readyState === WebSocket.OPEN) socket.close();
    }).catch(() => {
      cleanup();
    });
  };

  socket.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    try {
      const message = JSON.parse(event.data) as {
        type?: string;
        data?: string;
      };
      if (message.type === "input" && typeof message.data === "string" && writer) {
        writer.write(encoder.encode(message.data)).catch(() => {});
      } else if (message.type === "resize") {
        // PTY resize is not supported through the script wrapper.
      }
    } catch {
      // ignore malformed messages
    }
  };

  socket.onclose = cleanup;
  socket.onerror = cleanup;

  return response;
}
