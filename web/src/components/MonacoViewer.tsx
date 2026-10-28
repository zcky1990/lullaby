import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import type * as MonacoNS from "monaco-editor";
import "@/lib/monaco";
import { Skeleton } from "@/components/ui/skeleton";
import { languageForPath } from "@/lib/languages";
import { EDITOR_FONT_STACKS, useTheme } from "@/components/ThemeProvider";
import { fileUri, type LspStatusEvent } from "@/lib/lsp";

export interface MonacoLspConfig {
  projectId: string;
  workspacePath: string;
  absolutePath: string;
  initializationOptions?: Record<string, unknown>;
}

interface Props {
  path: string;
  content: string;
  theme: string;
  height?: string;
  language?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  lsp?: MonacoLspConfig;
  onLspStatus?: (event: LspStatusEvent) => void;
}

export default function MonacoViewer({
  path,
  content,
  theme,
  height = "100%",
  language,
  readOnly = true,
  onChange,
  lsp,
  onLspStatus,
}: Props) {
  const { editorFont, editorFontSize } = useTheme();
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof MonacoNS | null>(null);
  const disposeLspRef = useRef<(() => Promise<void>) | null>(null);
  const onLspStatusRef = useRef(onLspStatus);
  onLspStatusRef.current = onLspStatus;
  const [editorReady, setEditorReady] = useState(0);
  const languageId = language ?? languageForPath(path);
  const modelPath = lsp ? fileUri(lsp.absolutePath) : path;
  const lspKey = lsp
    ? `${lsp.projectId}|${lsp.workspacePath}|${lsp.absolutePath}|${languageId}`
    : "";

  useEffect(() => {
    if (!lsp) onLspStatusRef.current?.({ status: "off" });
  }, [lsp]);

  useEffect(() => {
    let cancelled = false;

    const disposeCurrent = async () => {
      const dispose = disposeLspRef.current;
      disposeLspRef.current = null;
      if (dispose) await dispose();
    };

    void (async () => {
      await disposeCurrent();
      if (cancelled) return;

      const editor = editorRef.current;
      const monacoApi = monacoRef.current;
      if (!lsp || !editor || !monacoApi) {
        if (!lsp) onLspStatusRef.current?.({ status: "off" });
        return;
      }

      const { connectLsp } = await import("@/lib/lsp");
      if (cancelled) return;

      const dispose = await connectLsp(monacoApi, editor, {
        projectId: lsp.projectId,
        workspacePath: lsp.workspacePath,
        absolutePath: lsp.absolutePath,
        language: languageId,
        initializationOptions: lsp.initializationOptions,
        onStatus: (event) => onLspStatusRef.current?.(event),
      });

      if (cancelled) {
        await dispose();
        return;
      }
      disposeLspRef.current = dispose;
    })();

    return () => {
      cancelled = true;
      void disposeCurrent();
    };
  }, [lsp, lspKey, languageId, editorReady]);

  return (
    <Editor
      height={height}
      path={modelPath}
      language={languageId}
      value={content}
      theme={theme}
      loading={<Skeleton className="h-full w-full rounded-none" />}
      onMount={(editor, monacoApi) => {
        editorRef.current = editor;
        monacoRef.current = monacoApi as unknown as typeof MonacoNS;
        setEditorReady((value) => value + 1);
      }}
      onChange={(value) => onChange?.(value ?? "")}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontFamily: EDITOR_FONT_STACKS[editorFont],
        fontSize: editorFontSize,
        scrollBeyondLastLine: false,
        wordWrap: "off",
        renderWhitespace: "selection",
        automaticLayout: true,
        scrollbar: { alwaysConsumeMouseWheel: false },
      }}
    />
  );
}
