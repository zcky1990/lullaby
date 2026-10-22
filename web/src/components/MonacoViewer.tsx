import { useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import "@/lib/monaco";
import { Skeleton } from "@/components/ui/skeleton";
import { languageForPath } from "@/lib/languages";
import { EDITOR_FONT_STACKS, useTheme } from "@/components/ThemeProvider";
import { registerFinder } from "@/lib/find";

interface Props {
  path: string;
  content: string;
  theme: string;
  height?: string;
  language?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}

export default function MonacoViewer({
  path,
  content,
  theme,
  height = "100%",
  language,
  readOnly = true,
  onChange,
}: Props) {
  const { editorFont, editorFontSize } = useTheme();
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);

  useEffect(
    () =>
      registerFinder((context) => {
        if (context.preferTerminal) return false;
        const editor = editorRef.current;
        const dom = editor?.getDomNode();
        if (!editor || !dom || !dom.isConnected) return false;
        editor.focus();
        void editor.getAction("actions.find")?.run();
        return true;
      }),
    [],
  );

  return (
    <Editor
      height={height}
      path={path}
      language={language ?? languageForPath(path)}
      value={content}
      theme={theme}
      loading={<Skeleton className="h-full w-full rounded-none" />}
      onMount={(editor) => {
        editorRef.current = editor;
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
