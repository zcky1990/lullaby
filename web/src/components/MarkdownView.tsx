import { lazy, Suspense } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "@/components/ThemeProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// PERF-4: Mermaid (±778 KB + renderer diagram) dulu diimpor statis sehingga ikut
// terunduh untuk setiap dokumen Markdown, termasuk yang tidak punya diagram.
// Sekarang chunk-nya baru diambil saat ada blok ```mermaid.
const MermaidDiagram = lazy(() =>
  import("@/components/Mermaid").then((module) => ({ default: module.Mermaid }))
);

interface Props {
  content: string;
  fontSize?: number;
  fontFamily?: string;
}

function isMermaidBlock(node: unknown): boolean {
  const element = node as
    | { children?: Array<{ properties?: { className?: unknown } }> }
    | undefined;
  const className = element?.children?.[0]?.properties?.className;
  if (Array.isArray(className)) return className.includes("language-mermaid");
  return typeof className === "string" && className.includes("language-mermaid");
}

export default function MarkdownView({ content, fontSize, fontFamily }: Props) {
  const { resolved } = useTheme();

  const components: Components = {
    code(props) {
      const { className, children } = props;
      const language = /language-(\w+)/.exec(className ?? "")?.[1];
      if (language === "mermaid") {
        return (
          <Suspense fallback={<Skeleton className="my-4 h-24 w-full rounded-md" />}>
            <MermaidDiagram chart={String(children).replace(/\n$/, "")} />
          </Suspense>
        );
      }
      return <code className={className}>{children}</code>;
    },
    pre(props) {
      if (isMermaidBlock(props.node)) return <>{props.children}</>;
      return <pre className="overflow-x-auto">{props.children}</pre>;
    },
  };

  return (
    <div
      className={cn("prose max-w-none", resolved === "dark" && "prose-invert")}
      style={{
        ...(fontSize ? { fontSize: `${fontSize}px` } : {}),
        ...(fontFamily ? { fontFamily } : {}),
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
