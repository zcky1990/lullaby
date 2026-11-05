import { useSyncExternalStore } from "react";
import { getDirtyPathsSnapshot, subscribeDirtyPaths } from "@/lib/dirty-paths";

/**
 * Path file yang tab editornya punya perubahan belum disimpan.
 * Sumber data: `publishDirtyPaths` yang dipanggil `useEditorTabs` setiap daftar tab berubah.
 */
export function useDirtyPaths(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribeDirtyPaths,
    getDirtyPathsSnapshot,
    getDirtyPathsSnapshot,
  );
}
