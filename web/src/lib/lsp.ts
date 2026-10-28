import type * as monaco from "monaco-editor";
import type { LspMonacoClient } from "monaco-lsp-bridge";
import { fileUri, lspLanguageId } from "./lsp-paths";

export { fileUri, lspLanguageId, normalizeWorkspacePath } from "./lsp-paths";

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
  initializationOptions?: Record<string, unknown>;
  onStatus?: (event: LspStatusEvent) => void;
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
  const {
    projectId,
    workspacePath,
    absolutePath,
    language,
    initializationOptions,
    onStatus,
  } = options;
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
  // monaco-lsp-bridge never sends the LSP `initialized` notification after
  // initialize; servers like gopls then fail with "no views in session".
  let pendingInitializeId: string | number | null = null;
  let sentInitialized = false;

  const sendJson = (message: unknown) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  const sendInitializedNotification = () => {
    if (sentInitialized) return;
    sentInitialized = true;
    sendJson({ jsonrpc: "2.0", method: "initialized", params: {} });
  };

  const port = {
    postMessage(message: unknown) {
      if (message && typeof message === "object") {
        const frame = message as {
          id?: string | number;
          method?: string;
          params?: Record<string, unknown>;
        };
        if (frame.method === "initialize" && frame.id != null) {
          pendingInitializeId = frame.id;
          sentInitialized = false;
        }
        if (frame.method === "textDocument/didOpen") {
          const params = frame.params as {
            textDocument?: { languageId?: string };
          } | undefined;
          if (params?.textDocument) {
            params.textDocument.languageId = lspLanguageId(absolutePath, language);
          }
        }
      }
      sendJson(message);
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
      const payload = JSON.parse(data) as {
        id?: string | number;
        result?: unknown;
        error?: { message?: string };
        method?: string;
      };
      if (
        pendingInitializeId != null &&
        payload.id === pendingInitializeId &&
        payload.result !== undefined
      ) {
        pendingInitializeId = null;
        sendInitializedNotification();
      }
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
      rootPath: workspacePath,
      workspaceFolders: [{ uri: rootUri, name: rootName(workspacePath) }],
      clientInfo: { name: "rnd-workflow", version: "0.1.0" },
      locale: navigator.language || "en-US",
      capabilities: clientCapabilities(),
      ...(initializationOptions ? { initializationOptions } : {}),
    } as never,
  });

  let ready = false;
  const readyTimer = setTimeout(() => {
    if (ready) return;
    onStatus?.({ status: "error", message: "Language server tidak merespons initialize." });
  }, 10_000);

  const formatLspError = (message: string): string => {
    if (/no views/i.test(message)) {
      return `${message} (handshake initialize/initialized gagal — coba buka ulang file)`;
    }
    return message;
  };

  // Completion/hover/etc. cancel often; monaco-lsp-bridge surfaces those as errors.
  const isBenignLspError = (error: { code?: number; message?: string }): boolean => {
    const code = error.code;
    if (code === -32800 || code === -32801 || code === -32802) return true;
    if (code === 1002) return true;
    const message = error.message ?? "";
    return /cancel|disposed before response/i.test(message);
  };

  let closed = false;

  const offEvent = client.onEvent((event) => {
    if (closed) return;
    if (event.type === "initialized") {
      sendInitializedNotification();
      ready = true;
      clearTimeout(readyTimer);
      onStatus?.({ status: "ready" });
    } else if (event.type === "error") {
      if (isBenignLspError(event.error)) return;
      clearTimeout(readyTimer);
      onStatus?.({ status: "error", message: formatLspError(event.error.message) });
    } else if (event.type === "shutdownError") {
      if (closed) return;
      clearTimeout(readyTimer);
      onStatus?.({ status: "error", message: "Language server gagal shutdown." });
    }
  });

  const onSocketClose = (event: CloseEvent) => {
    if (closed) return;
    clearTimeout(readyTimer);
    onStatus?.({ status: "error", message: event.reason || "Koneksi LSP terputus." });
  };
  const onSocketError = () => {
    if (closed) return;
    clearTimeout(readyTimer);
    onStatus?.({ status: "error", message: "Koneksi LSP error." });
  };
  socket.addEventListener("close", onSocketClose);
  socket.addEventListener("error", onSocketError);

  client.connect(monacoApi, editor);

  return async () => {
    closed = true;
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
