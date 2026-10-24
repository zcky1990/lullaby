import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { EDITOR_FONT_STACKS, useTheme } from "@/components/ThemeProvider";
import { Button } from "@/components/ui/button";
import { registerFinder } from "@/lib/find";
import { cn } from "@/lib/utils";

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

export interface TerminalHandle {
  clear: () => void;
  focus: () => void;
}

interface Props {
  projectId: string;
  active: boolean;
  onStatus?: (status: TerminalStatus, detail?: string) => void;
  onReady?: (handle: TerminalHandle) => void;
}

function canFit(host: HTMLElement | null): boolean {
  if (!host?.isConnected) return false;
  return host.clientWidth >= 16 && host.clientHeight >= 16;
}

function safeFit(fit: FitAddon | null, host: HTMLElement | null): boolean {
  if (!fit || !canFit(host)) return false;
  try {
    fit.fit();
    return true;
  } catch {
    return false;
  }
}

export function TerminalSession({ projectId, active, onStatus, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const activeRef = useRef(active);
  const inputRef = useRef<HTMLInputElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const statusRef = useRef(onStatus);
  const onReadyRef = useRef(onReady);
  statusRef.current = onStatus;
  onReadyRef.current = onReady;
  activeRef.current = active;
  const { resolved, editorFont, editorFontSize } = useTheme();

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: EDITOR_FONT_STACKS[editorFont],
      fontSize: editorFontSize,
      lineHeight: 1.2,
      letterSpacing: 0,
      scrollback: 5000,
      theme: resolved === "dark" ? DARK_THEME : LIGHT_THEME,
      allowTransparency: false,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    searchRef.current = search;
    term.open(host);
    safeFit(fit, host);
    termRef.current = term;
    fitRef.current = fit;
    onReadyRef.current?.({
      clear: () => term.clear(),
      focus: () => term.focus(),
    });
    statusRef.current?.("connecting");

    const encoder = new TextEncoder();
    const cols = Math.max(term.cols, 2);
    const rows = Math.max(term.rows, 1);
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(
      `${protocol}://${location.host}/api/projects/${projectId}/terminal?cols=${cols}&rows=${rows}`,
    );
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;

    const sendJson = (payload: unknown) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    };

    const sendInput = (data: string) => {
      if (socket.readyState !== WebSocket.OPEN || !data) return;
      socket.send(encoder.encode(data));
    };

    const resizeIfVisible = () => {
      if (!activeRef.current) return;
      if (!safeFit(fit, host)) return;
      if (term.cols > 1 && term.rows > 1) {
        sendJson({ type: "resize", cols: term.cols, rows: term.rows });
      }
    };

    socket.onopen = () => {
      if (term.cols > 1 && term.rows > 1) {
        sendJson({ type: "resize", cols: term.cols, rows: term.rows });
      }
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") {
        const bytes = event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : event.data instanceof Uint8Array
          ? event.data
          : null;
        if (bytes?.byteLength) term.write(bytes);
        return;
      }
      try {
        const message = JSON.parse(event.data) as {
          type?: string;
          cwd?: string;
          message?: string;
          code?: number;
        };
        if (message.type === "ready") {
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

    const input = term.onData((data) => sendInput(data));

    const observer = new ResizeObserver(() => resizeIfVisible());
    observer.observe(host);

    return () => {
      observer.disconnect();
      input.dispose();
      socket.close();
      socketRef.current = null;
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
    if (active) safeFit(fitRef.current, hostRef.current);
  }, [resolved, editorFont, editorFontSize, active]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let attempts = 0;
    const tryFit = () => {
      if (cancelled) return;
      if (safeFit(fitRef.current, hostRef.current)) {
        const term = termRef.current;
        const socket = socketRef.current;
        if (term && term.cols > 1 && term.rows > 1) {
          term.refresh(0, term.rows - 1);
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
          }
        }
        return;
      }
      if (attempts++ < 12) requestAnimationFrame(tryFit);
    };
    const frame = requestAnimationFrame(tryFit);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
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
    <div className="terminal-host relative h-full w-full overflow-hidden">
      <div
        ref={hostRef}
        className={cn(
          "h-full w-full px-2 pt-1 pb-2",
          resolved === "dark" ? "bg-[#1e1e1e]" : "bg-white",
        )}
      />
      {findOpen ? (
        <div
          data-terminal-find
          className="absolute top-2 right-2 z-10 flex w-72 items-center gap-1 rounded-md border bg-popover/95 p-1.5 shadow-md backdrop-blur-sm"
        >
          <Search className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
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
            placeholder="Find"
            className="h-7 min-w-0 flex-1 bg-transparent px-1 text-xs outline-none"
          />
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => find(true)}
            aria-label="Previous match"
            title="Previous"
          >
            <ChevronUp />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => find(false)}
            aria-label="Next match"
            title="Next"
          >
            <ChevronDown />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => {
              setFindOpen(false);
              termRef.current?.focus();
            }}
            aria-label="Close find"
            title="Close"
          >
            <X />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
