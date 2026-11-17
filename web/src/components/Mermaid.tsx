import { useEffect, useId, useMemo, useState } from "react";
import { useTheme } from "@/components/ThemeProvider";
import { renderMermaidSvg } from "@/lib/mermaid-render";
import {
  readCachedMermaidSvg,
  rewriteSvgIds,
  writeCachedMermaidSvg,
  type CachedMermaidSvg,
} from "@/lib/mermaid-svg-cache";

interface Props {
  chart: string;
}

/**
 * PERF-4: mermaid tidak diimpor di sini.
 *
 * Alur render:
 * 1. Cache SVG dicek secara sinkron. Kena cache → chunk mermaid (±618 KB) tidak
 *    diunduh sama sekali (termasuk setelah restart aplikasi).
 * 2. Cache miss → `renderMermaidSvg()` mengimpor mermaid lewat dynamic import,
 *    hasilnya disimpan ke cache.
 *
 * Id SVG selalu dibuat baru per instance supaya dua diagram identik di satu
 * halaman tidak bertabrakan id/style-nya.
 */
export function Mermaid({ chart }: Props) {
  const { resolved } = useTheme();
  const reactId = useId();
  const theme = resolved === "dark" ? "dark" : "default";
  const instanceId = useMemo(
    () =>
      `mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, "")}-${Math.random()
        .toString(36)
        .slice(2)}`,
    [reactId],
  );
  const [diagram, setDiagram] = useState<CachedMermaidSvg | null>(() =>
    readCachedMermaidSvg(chart, theme)
  );
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    const cached = readCachedMermaidSvg(chart, theme);
    if (cached) {
      setDiagram(cached);
      setError(undefined);
      return;
    }

    // Diagram sebelumnya dibiarkan tampil sampai render baru selesai (tanpa flicker).
    renderMermaidSvg(chart, theme, instanceId)
      .then((svg) => {
        if (cancelled) return;
        setDiagram({ id: instanceId, svg });
        setError(undefined);
        writeCachedMermaidSvg(chart, theme, { id: instanceId, svg });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [chart, theme, instanceId]);

  if (error) {
    return (
      <pre className="my-4 overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs text-destructive">
        Mermaid error: {error}
      </pre>
    );
  }

  const svg = diagram ? rewriteSvgIds(diagram.svg, diagram.id, instanceId) : "";

  return (
    <div
      className="my-4 flex justify-center overflow-x-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
