import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { DocumentPanelProps } from "@/components/documents/DocumentPanel";

/**
 * Lazy boundary (PERF-9). Implementasi panel dokumen (±17 KB) dipisah ke
 * `components/documents/DocumentPanel.tsx` lalu dimuat saat menu Document
 * dibuka, jadi tidak ikut chunk utama. Call site di `App.tsx` tidak berubah.
 */
export type { DocumentPanelProps, PanelDocSource } from "@/components/documents/DocumentPanel";

const DocumentPanelImpl = lazy(() =>
  import("@/components/documents/DocumentPanel").then((module) => ({
    default: module.DocumentPanel,
  }))
);

export function DocumentPanel(props: DocumentPanelProps) {
  return (
    <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
      <DocumentPanelImpl {...props} />
    </Suspense>
  );
}
