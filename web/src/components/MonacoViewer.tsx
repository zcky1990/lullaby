import Editor from "@monaco-editor/react";
import "@/lib/monaco";
import { Skeleton } from "@/components/ui/skeleton";
import { languageForPath } from "@/lib/languages";
import { EDITOR_FONT_STACKS, useTheme } from "@/components/ThemeProvider";

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
  return (
    <Editor
      height={height}
      path={path}
      language={language ?? languageForPath(path)}
      value={content}
      theme={theme}
      loading={<Skeleton className="h-full w-full rounded-none" />}
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
