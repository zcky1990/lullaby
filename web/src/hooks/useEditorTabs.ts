import { useCallback, useRef, useState } from "react";
import type { Menu } from "@/components/ActivityBar";
import type { EditorTab, TabKind } from "@/components/TabsBar";

export const PANEL_FOR_KIND: Record<TabKind, Menu> = {
  workspace: "workspace",
  ticket: "ticket",
  git: "git",
  settings: "settings",
  global: "global",
  review: "files",
  document: "document",
  file: "files",
  find: "find",
  workflow: "workflow",
  "workflow-docs": "workflow",
};

export function useEditorTabs(setMenu: (menu: Menu) => void, currentId: string | null) {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const focusTab = useCallback(
    (tab: EditorTab) => {
      setTabs((current) =>
        current.some((item) => item.id === tab.id)
          ? current.map((item) => (item.id === tab.id ? { ...item, title: tab.title } : item))
          : [...current, tab],
      );
      setActiveTabId(tab.id);
      setMenu(PANEL_FOR_KIND[tab.kind]);
    },
    [setMenu],
  );

  const patchTab = useCallback((id: string, patch: Partial<EditorTab>) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      const index = tabs.findIndex((tab) => tab.id === id);
      if (index === -1) return;
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
