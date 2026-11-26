import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { GitPanelProps } from "@/components/git/GitPanel";

/**
 * Lazy boundary (PERF-9). Implementasi GitPanel (±12 KB) dipisah ke
 * `components/git/GitPanel.tsx` lalu dimuat saat menu Git dibuka, jadi tidak
 * ikut chunk utama. Call site di `App.tsx` tidak berubah.
 */
export type { GitPanelProps };

const GitPanelImpl = lazy(() =>
  import("@/components/git/GitPanel").then((module) => ({ default: module.GitPanel }))
);

export function GitPanel(props: GitPanelProps) {
  return (
    <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
      <GitPanelImpl {...props} />
    </Suspense>
  );
}
