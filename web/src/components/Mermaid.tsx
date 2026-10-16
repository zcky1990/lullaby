import { useEffect, useId, useState } from "react";
import mermaid from "mermaid";
import { useTheme } from "@/components/ThemeProvider";

interface Props {
  chart: string;
}

export function Mermaid({ chart }: Props) {
  const { resolved } = useTheme();
  const reactId = useId();
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: resolved === "dark" ? "dark" : "default",
    });
    const id = `mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, "")}-${Math.random()
      .toString(36)
      .slice(2)}`;

    mermaid
      .render(id, chart)
      .then((result) => {
        if (!cancelled) {
          setSvg(result.svg);
          setError(undefined);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [chart, resolved, reactId]);

  if (error) {
    return (
      <pre className="my-4 overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs text-destructive">
        Mermaid error: {error}
      </pre>
    );
  }

  return (
    <div
      className="my-4 flex justify-center overflow-x-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
