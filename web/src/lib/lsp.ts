import type * as monaco from "monaco-editor";
import type { LspMonacoClient } from "monaco-lsp-bridge";

export type LspStatus = "off" | "connecting" | "ready" | "error";

export interface LspStatusEvent {
  status: LspStatus;
  message?: string;
}

export interface ConnectLspOptions {
  projectId: string;
  workspacePath: string;
  absolutePath: string;
  language: string;
  onStatus?: (event: LspStatusEvent) => void;
}

export function fileUri(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const prefix = normalized.startsWith("/") ? "file://" : "file:///";
  return `${prefix}${
    normalized
      .split("/")
      .map((segment, index) => {
        if (index === 0 && segment === "") return "";
        if (index === 0 && /^[A-Za-z]:$/.test(segment)) return segment;
        return encodeURIComponent(segment);
      })
      .join("/")
  }`;
}

export function normalizeWorkspacePath(workspace: string, path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return normalized;
  const root = workspace.replace(/\\/g, "/").replace(/\/+$/, "");
  return `${root}/${normalized.replace(/^\/+/, "")}`;
}

export function lspLanguageId(path: string, fallback: string): string {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const ext = name.includes(".") ? name.split(".").pop() ?? "" : "";
  switch (ext) {
    case "tsx":
      return "typescriptreact";
    case "jsx":
      return "javascriptreact";
    case "ts":
    case "mts":
    case "cts":
      return "typescript";
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    default:
      return fallback;
  }
}

function rootName(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).pop() ?? "workspace";
}

function socketUrl(projectId: string, language: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/projects/${
    encodeURIComponent(projectId)
  }/lsp?language=${encodeURIComponent(language)}`;
}

function waitForOpen(socket: WebSocket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout membuka koneksi LSP."));
    }, timeoutMs);
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Gagal membuka koneksi LSP."));
    };
    const onClose = (event: CloseEvent) => {
      cleanup();
      reject(new Error(event.reason || "Koneksi LSP ditutup."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

function clientCapabilities() {
  return {
    workspace: {
      applyEdit: false,
      workspaceEdit: { documentChanges: false },
      configuration: false,
      workspaceFolders: true,
      didChangeConfiguration: { dynamicRegistration: false },
      didChangeWatchedFiles: { dynamicRegistration: false },
    },
    textDocument: {
      synchronization: {
        dynamicRegistration: false,
        willSave: false,
        willSaveWaitUntil: false,
        didSave: false,
      },
      completion: {
        dynamicRegistration: false,
        completionItem: {
          snippetSupport: true,
          documentationFormat: ["markdown", "plaintext"],
          resolveSupport: { properties: ["documentation", "detail", "additionalTextEdits"] },
        },
        contextSupport: true,
      },
      hover: { dynamicRegistration: false, contentFormat: ["markdown", "plaintext"] },
      signatureHelp: {
        dynamicRegistration: false,
        signatureInformation: { documentationFormat: ["markdown", "plaintext"] },
        contextSupport: true,
      },
      definition: { dynamicRegistration: false, linkSupport: true },
      declaration: { dynamicRegistration: false, linkSupport: true },
      typeDefinition: { dynamicRegistration: false, linkSupport: true },
      implementation: { dynamicRegistration: false, linkSupport: true },
      references: { dynamicRegistration: false },
      documentHighlight: { dynamicRegistration: false },
      documentSymbol: {
        dynamicRegistration: false,
        hierarchicalDocumentSymbolSupport: true,
      },
      rename: { dynamicRegistration: false, prepareSupport: true },
      formatting: { dynamicRegistration: false },
      rangeFormatting: { dynamicRegistration: false },
      codeAction: {
        dynamicRegistration: false,
        codeActionLiteralSupport: { codeActionKind: { valueSet: [""] } },
      },
      publishDiagnostics: {
        relatedInformation: true,
        versionSupport: true,
        tagSupport: { valueSet: [1, 2] },
      },
    },
    window: { workDoneProgress: true },
    general: { markdown: { parser: "marked", version: "1.0.0" } },
  };
}

export async function connectLsp(
  monacoApi: typeof monaco,
  editor: monaco.editor.IStandaloneCodeEditor,
  options: ConnectLspOptions,
): Promise<() => Promise<void>> {
  const { projectId, workspacePath, absolutePath, language, onStatus } = options;
  onStatus?.({ status: "connecting" });

  const socket = new WebSocket(socketUrl(projectId, language));
  socket.binaryType = "arraybuffer";

  try {
    await waitForOpen(socket);
  } catch (error) {
    try {
      socket.close();
    } catch {
      // ignore
    }
    onStatus?.({ status: "error", message: (error as Error).message });
    return async () => {};
  }

  let clientModule: typeof import("monaco-lsp-bridge");
  try {
    clientModule = await import("monaco-lsp-bridge");
  } catch (error) {
    try {
      socket.close();
    } catch {
      // ignore
    }
    onStatus?.({
      status: "error",
      message: `Gagal memuat client LSP: ${(error as Error).message}`,
    });
    return async () => {};
  }
  const { LspMonacoClient } = clientModule;

  type MessageListener = (event: { data: unknown }) => void;
  const listeners = new Set<MessageListener>();
  const port = {
    postMessage(message: unknown) {
      if (message && typeof message === "object" && "method" in message) {
        const frame = message as {
          method?: string;
          params?: Record<string, unknown>;
        };
        if (frame.method === "textDocument/didOpen") {
          const params = frame.params as {
            textDocument?: { languageId?: string };
          } | undefined;
          if (params?.textDocument) {
            params.textDocument.languageId = lspLanguageId(absolutePath, language);
          }
        }
      }
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    addEventListener(type: "message", listener: MessageListener) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type: "message", listener: MessageListener) {
      if (type === "message") listeners.delete(listener);
    },
  };

  const onMessage = (event: MessageEvent) => {
    try {
      const data = typeof event.data === "string"
        ? event.data
        : new TextDecoder().decode(event.data as ArrayBuffer);
      const payload = JSON.parse(data);
      for (const listener of [...listeners]) listener({ data: payload });
    } catch {
      // ignore malformed frames
    }
  };
  socket.addEventListener("message", onMessage);

  const rootUri = fileUri(workspacePath);
  const client: LspMonacoClient = new LspMonacoClient(port, {
    languageSelector: { language },
    dedicatedServer: true,
    initialParams: {
      processId: null,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: rootName(workspacePath) }],
      clientInfo: { name: "rnd-workflow", version: "0.1.0" },
      locale: navigator.language || "en-US",
      capabilities: clientCapabilities(),
    } as never,
  });

  let ready = false;
  const readyTimer = setTimeout(() => {
    if (ready) return;
    onStatus?.({ status: "error", message: "Language server tidak merespons initialize." });
  }, 10_000);

  const offEvent = client.onEvent((event) => {
    if (event.type === "initialized") {
      ready = true;
      clearTimeout(readyTimer);
      onStatus?.({ status: "ready" });
    } else if (event.type === "error") {
      clearTimeout(readyTimer);
      onStatus?.({ status: "error", message: event.error.message });
    } else if (event.type === "shutdownError") {
      clearTimeout(readyTimer);
      onStatus?.({ status: "error", message: "Language server gagal shutdown." });
    }
  });

  const onSocketClose = (event: CloseEvent) => {
    clearTimeout(readyTimer);
    onStatus?.({ status: "error", message: event.reason || "Koneksi LSP terputus." });
  };
  const onSocketError = () => {
    clearTimeout(readyTimer);
    onStatus?.({ status: "error", message: "Koneksi LSP error." });
  };
  socket.addEventListener("close", onSocketClose);
  socket.addEventListener("error", onSocketError);

  client.connect(monacoApi, editor);

  return async () => {
    clearTimeout(readyTimer);
    offEvent();
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("close", onSocketClose);
    socket.removeEventListener("error", onSocketError);
    try {
      await client.dispose();
    } catch {
      // ignore
    }
    try {
      socket.close();
    } catch {
      // ignore
    }
    onStatus?.({ status: "off" });
  };
}
