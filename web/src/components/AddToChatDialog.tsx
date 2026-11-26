import { lazy, Suspense } from "react";
import type { AddToChatDialogProps } from "@/components/chat/AddToChatDialog";

/**
 * Lazy boundary (PERF-9). Implementasi dialog "Add to chat" (±3 KB) dipisah ke
 * `components/chat/AddToChatDialog.tsx`. Dialog tidak di-mount sebelum dibuka,
 * jadi chunk baru diunduh saat shortcut Cmd/Ctrl+Shift+L dipakai.
 */
export type { AddToChatDialogProps };

const AddToChatDialogImpl = lazy(() =>
  import("@/components/chat/AddToChatDialog").then((module) => ({
    default: module.AddToChatDialog,
  }))
);

export function AddToChatDialog(props: AddToChatDialogProps) {
  if (!props.open) return null;
  return (
    <Suspense fallback={null}>
      <AddToChatDialogImpl {...props} />
    </Suspense>
  );
}
