import {
  File as FileIcon,
  FileText,
  LayoutGrid,
  Settings,
  SlidersHorizontal,
  Ticket,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type TabKind = "workspace" | "ticket" | "settings" | "global" | "document" | "file";

export interface EditorTab {
  id: string;
  kind: TabKind;
  title: string;
  ref?: string;
  loading?: boolean;
  error?: string;
  content?: string;
  binary?: boolean;
  size?: number;
  source?: "local" | "docmost";
  syncStatus?: "local" | "synced" | "error";
  pageId?: string;
  preview?: boolean;
  dirty?: boolean;
}

const ICONS: Record<TabKind, typeof FileIcon> = {
  workspace: LayoutGrid,
  ticket: Ticket,
  settings: Settings,
  global: SlidersHorizontal,
  document: FileText,
  file: FileIcon,
};

interface Props {
  tabs: EditorTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export function TabsBar({ tabs, activeId, onSelect, onClose }: Props) {
  if (tabs.length === 0) return null;
  return (
    <div className="flex items-stretch overflow-x-auto border-b bg-[var(--tabbar)]">
      {tabs.map((tab) => {
        const Icon = ICONS[tab.kind];
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className={cn(
              "group flex h-[35px] items-center gap-2 border-t border-r border-t-transparent px-3 text-[13px]",
              active
                ? "border-t-primary bg-background text-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(tab.id)}
              className="flex max-w-[14rem] items-center gap-2"
              title={tab.title}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{tab.title}</span>
              {tab.dirty ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
            </button>
            <button
              type="button"
              onClick={() => onClose(tab.id)}
              aria-label={`Tutup ${tab.title}`}
              className={cn(
                "rounded p-0.5 hover:bg-accent",
                active ? "opacity-60" : "opacity-0 group-hover:opacity-60",
              )}
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
