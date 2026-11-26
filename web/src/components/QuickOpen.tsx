import { lazy, Suspense } from "react";
import type { QuickOpenProps } from "@/components/explorer/QuickOpen";

/**
 * Lazy boundary (PERF-9). Implementasi Cmd+P (±7 KB: dialog + fuzzy index)
 * dipisah ke `components/explorer/QuickOpen.tsx`. Dialog tidak di-mount sebelum
 * dibuka, jadi chunk baru diunduh saat pertama kali Cmd+P ditekan.
 */
export type { QuickOpenProps };

const QuickOpenImpl = lazy(() =>
  import("@/components/explorer/QuickOpen").then((module) => ({ default: module.QuickOpen }))
);

export function QuickOpen(props: QuickOpenProps) {
  if (!props.open) return null;
  return (
    <Suspense fallback={null}>
      <QuickOpenImpl {...props} />
    </Suspense>
  );
}
