import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Mermaid } from "@/components/Mermaid";
import { useTheme } from "@/components/ThemeProvider";
import { cn } from "@/lib/utils";

interface Props {
  content: string;
}

function isMermaidBlock(node: unknown): boolean {
  const element = node as
    | { children?: Array<{ properties?: { className?: unknown } }> }
    | undefined;
  const className = element?.children?.[0]?.properties?.className;
  if (Array.isArray(className)) return className.includes("language-mermaid");
  return typeof className === "string" && className.includes("language-mermaid");
}

export default function MarkdownView({ content }: Props) {
  const { resolved } = useTheme();

  const components: Components = {
    code(props) {
      const { className, children } = props;
      const language = /language-(\w+)/.exec(className ?? "")?.[1];
      if (language === "mermaid") {
        return <Mermaid chart={String(children).replace(/\n$/, "")} />;
      }
      return <code className={className}>{children}</code>;
    },
    pre(props) {
      if (isMermaidBlock(props.node)) return <>{props.children}</>;
      return <pre className="overflow-x-auto">{props.children}</pre>;
    },
  };

  return (
    <div className={cn("prose max-w-none", resolved === "dark" && "prose-invert")}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
