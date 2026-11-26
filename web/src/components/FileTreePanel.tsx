import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { FileTreePanelProps } from "@/components/explorer/FileTreePanel";

/**
 * Lazy boundary (PERF-9). Implementasi explorer (±30 KB) dipisah ke
 * `components/explorer/FileTreePanel.tsx` lalu dimuat saat menu Files dibuka,
 * jadi tidak ikut chunk utama. Call site di `App.tsx` tidak berubah.
 */
export type { FileTreePanelProps };

const FileTreePanelImpl = lazy(() =>
  import("@/components/explorer/FileTreePanel").then((module) => ({
    default: module.FileTreePanel,
  }))
);

export function FileTreePanel(props: FileTreePanelProps) {
  return (
    <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
      <FileTreePanelImpl {...props} />
    </Suspense>
  );
}
