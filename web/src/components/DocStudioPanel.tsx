import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { DocStudioPanelProps } from "@/components/docstudio/DocStudioPanel";

/**
 * Lazy boundary (PERF-9). Implementasi panel Doc Studio dipisah ke
 * `components/docstudio/DocStudioPanel.tsx` dan baru dimuat saat menu dibuka,
 * jadi tidak ikut chunk utama.
 *
 * Semua prop opsional: `ActivityBar` merender `<DocStudioPanel />` tanpa prop
 * (panel membaca project aktif sendiri), sedangkan shell bisa memberi `projectId`
 * eksplisit bila wiring-nya ditambahkan ke `App.tsx`.
 */
export type { DocStudioPanelProps };

const DocStudioPanelImpl = lazy(() =>
  import("@/components/docstudio/DocStudioPanel").then((module) => ({
    default: module.DocStudioPanel,
  }))
);

export function DocStudioPanel(props: DocStudioPanelProps = {}) {
  return (
    <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
      <DocStudioPanelImpl {...props} />
    </Suspense>
  );
}
