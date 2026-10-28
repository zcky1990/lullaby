import { useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import "@/lib/monaco";
import { Skeleton } from "@/components/ui/skeleton";
import { languageForPath } from "@/lib/languages";
import { EDITOR_FONT_STACKS, useTheme } from "@/components/ThemeProvider";
import { registerFinder } from "@/lib/find";
import { fileUri, type LspStatusEvent } from "@/lib/lsp";

export interface MonacoLspConfig {
  projectId: string;
  workspacePath: string;
  absolutePath: string;
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
  const disposeLspRef = useRef<(() => Promise<void>) | null>(null);
  const languageRef = useRef(language ?? languageForPath(path));
  languageRef.current = language ?? languageForPath(path);
  const modelPath = lsp ? fileUri(lsp.absolutePath) : path;

  useEffect(() => {
    if (!lsp) onLspStatus?.({ status: "off" });
  }, [lsp, onLspStatus]);

  useEffect(() => {
    return () => {
      const dispose = disposeLspRef.current;
      disposeLspRef.current = null;
      if (dispose) void dispose();
    };
  }, []);

  return (
    <Editor
      height={height}
      path={modelPath}
      language={languageRef.current}
      value={content}
      theme={theme}
      loading={<Skeleton className="h-full w-full rounded-none" />}
      onMount={(editor, monacoApi) => {
        editorRef.current = editor;
        if (!lsp) return;
        void (async () => {
          const { connectLsp } = await import("@/lib/lsp");
          const dispose = await connectLsp(
            monacoApi as unknown as typeof import("monaco-editor"),
            editor,
            {
              projectId: lsp.projectId,
              workspacePath: lsp.workspacePath,
              absolutePath: lsp.absolutePath,
              language: languageRef.current,
              onStatus: onLspStatus,
            },
          );
          disposeLspRef.current = dispose;
        })();
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
