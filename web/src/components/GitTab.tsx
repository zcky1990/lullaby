import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { GitTabProps } from "@/components/git/GitTab";

/**
 * Lazy boundary (PERF-9). Implementasi GitTab (±31 KB, ikon lucide + dialog +
 * diff viewer) dipisah ke `components/git/GitTab.tsx` lalu dimuat saat menu Git
 * dibuka, jadi tidak ikut chunk utama. Call site di `App.tsx` tidak berubah.
 */
export type { GitTabProps };

const GitTabImpl = lazy(() =>
  import("@/components/git/GitTab").then((module) => ({ default: module.GitTab }))
);

export function GitTab(props: GitTabProps) {
  return (
    <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
      <GitTabImpl {...props} />
    </Suspense>
  );
}
