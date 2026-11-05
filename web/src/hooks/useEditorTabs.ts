import { useCallback, useEffect, useRef, useState } from "react";
import type { Menu } from "@/components/ActivityBar";
import type { EditorTab, TabKind } from "@/components/TabsBar";
import { collectDirtyPaths, publishDirtyPaths, resolveDirtyFlag } from "@/lib/dirty-paths";

export const PANEL_FOR_KIND: Record<TabKind, Menu> = {
  workspace: "workspace",
  ticket: "ticket",
  git: "git",
  settings: "settings",
  global: "global",
  review: "files",
  document: "document",
  file: "files",
  workflow: "workflow",
  "workflow-docs": "workflow",
  cron: "cron",
  "cron-docs": "cron",
};

export function useEditorTabs(setMenu: (menu: Menu) => void, currentId: string | null) {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  /** Isi terakhir yang diketahui berasal dari disk, per tab id. */
  const diskContentRef = useRef(new Map<string, string>());

  // Explorer menebalkan file yang belum disimpan; ringkasannya dipublikasikan ke store
  // supaya panel file tidak perlu menerima prop dari `App.tsx`.
  useEffect(() => {
    publishDirtyPaths(collectDirtyPaths(tabs));
  }, [tabs]);

  const focusTab = useCallback(
    (tab: EditorTab, keepMenu = false) => {
      setTabs((current) =>
        current.some((item) => item.id === tab.id)
          ? current.map((item) => (item.id === tab.id ? { ...item, title: tab.title } : item))
          : [...current, tab],
      );
      setActiveTabId(tab.id);
      if (!keepMenu) setMenu(PANEL_FOR_KIND[tab.kind]);
    },
    [setMenu],
  );

  const patchTab = useCallback((id: string, patch: Partial<EditorTab>) => {
    const diskContent = diskContentRef.current;
    const { dirty, baseline } = resolveDirtyFlag(patch, diskContent.get(id));
    if (baseline !== undefined) diskContent.set(id, baseline);

    const changes: Partial<EditorTab> = dirty === undefined ? patch : { ...patch, dirty };
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, ...changes } : tab)));
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      const index = tabs.findIndex((tab) => tab.id === id);
      if (index === -1) return;
      diskContentRef.current.delete(id);
      const next = tabs.filter((tab) => tab.id !== id);
      setTabs(next);
      if (activeTabId === id) {
        setActiveTabId(next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? null);
      }
    },
    [tabs, activeTabId],
  );

  const openSingleton = useCallback(
    (kind: TabKind, title: string) => {
      if (kind === "global") {
        focusTab({ id: "global", kind, title });
        return;
      }
      if (!currentId) return;
      focusTab({ id: `${kind}:${currentId}`, kind, title });
    },
    [currentId, focusTab],
  );

  return {
    tabs,
    setTabs,
    tabsRef,
    activeTabId,
    setActiveTabId,
    focusTab,
    patchTab,
    closeTab,
    openSingleton,
  };
}
