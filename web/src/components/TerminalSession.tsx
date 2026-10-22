import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { EDITOR_FONT_STACKS, useTheme } from "@/components/ThemeProvider";
import { registerFinder } from "@/lib/find";

const DARK_THEME = {
  background: "#1e1e1e",
  foreground: "#cccccc",
  cursor: "#aeafad",
  selectionBackground: "#264f78",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#e5e5e5",
};

const LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#333333",
  cursor: "#333333",
  selectionBackground: "#add6ff",
  black: "#000000",
  red: "#cd3131",
  green: "#00bc00",
  yellow: "#949800",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#cd3131",
  brightGreen: "#14ce14",
  brightYellow: "#b5ba00",
  brightBlue: "#0451a5",
  brightMagenta: "#bc05bc",
  brightCyan: "#0598bc",
  brightWhite: "#a5a5a5",
};

export type TerminalStatus = "connecting" | "ready" | "closed" | "error";

interface Props {
  projectId: string;
  active: boolean;
  onStatus?: (status: TerminalStatus, detail?: string) => void;
}

export function TerminalSession({ projectId, active, onStatus }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const { resolved, editorFont, editorFontSize } = useTheme();

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: EDITOR_FONT_STACKS[editorFont],
      fontSize: editorFontSize,
      scrollback: 5000,
      theme: resolved === "dark" ? DARK_THEME : LIGHT_THEME,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    searchRef.current = search;
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    statusRef.current?.("connecting");

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(
      `${protocol}://${location.host}/api/projects/${projectId}/terminal`,
    );

    const send = (payload: unknown) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    };

    socket.onopen = () => {
      send({ type: "resize", cols: term.cols, rows: term.rows });
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const message = JSON.parse(event.data) as {
          type?: string;
          data?: string;
          cwd?: string;
          message?: string;
          code?: number;
        };
        if (message.type === "data" && typeof message.data === "string") {
          term.write(message.data);
        } else if (message.type === "ready") {
          statusRef.current?.("ready", message.cwd);
        } else if (message.type === "exit") {
          statusRef.current?.("closed");
          term.write(`\r\n\x1b[2m[process exited ${message.code}]\x1b[0m\r\n`);
        } else if (message.type === "error") {
          statusRef.current?.("error", message.message);
        }
      } catch {
        // ignore malformed messages
      }
    };
    socket.onerror = () => statusRef.current?.("error");
    socket.onclose = () => statusRef.current?.("closed");

    const input = term.onData((data) => send({ type: "input", data }));

    const observer = new ResizeObserver(() => {
      fit.fit();
      send({ type: "resize", cols: term.cols, rows: term.rows });
    });
    observer.observe(hostRef.current);

    return () => {
      observer.disconnect();
      input.dispose();
      socket.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
  }, [projectId]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = resolved === "dark" ? DARK_THEME : LIGHT_THEME;
    term.options.fontFamily = EDITOR_FONT_STACKS[editorFont];
    term.options.fontSize = editorFontSize;
  }, [resolved, editorFont, editorFontSize]);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => fitRef.current?.fit());
    return () => cancelAnimationFrame(frame);
  }, [active]);

  const find = (backwards: boolean) => {
    const value = query.trim();
    if (!value) return;
    if (backwards) searchRef.current?.findPrevious(value, { incremental: true });
    else searchRef.current?.findNext(value, { incremental: true });
  };

  useEffect(() => {
    if (!active) return;
    return registerFinder((context) => {
      if (!context.preferTerminal) return false;
      setFindOpen(true);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      return true;
    });
  }, [active]);

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      {findOpen ? (
        <div
          data-terminal-find
          className="absolute top-2 right-2 z-10 flex w-64 flex-col gap-1 rounded-md border bg-popover p-2 shadow-md"
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (event.target.value) {
                searchRef.current?.findNext(event.target.value, { incremental: true });
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setFindOpen(false);
                termRef.current?.focus();
              } else if (event.key === "Enter") {
                event.preventDefault();
                find(event.shiftKey);
              }
            }}
            placeholder="Find in terminal"
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-sm border bg-transparent px-2 text-xs outline-none focus-visible:ring-[3px]"
          />
          <span className="text-[10px] text-muted-foreground">
            Enter next · Shift+Enter previous · Esc close
          </span>
        </div>
      ) : null}
    </div>
  );
}
