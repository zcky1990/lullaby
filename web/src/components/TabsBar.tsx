import {
  ArrowLeftToLine,
  ArrowRightToLine,
  BookOpen,
  CircleX,
  Clock,
  File as FileIcon,
  FileText,
  GitBranch,
  GitCompare,
  LayoutGrid,
  ListX,
  Settings,
  SlidersHorizontal,
  Ticket,
  Workflow,
  X,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useI18n } from "@/lib/i18n";
import { requestTabMenuAction } from "@/lib/tab-menu";
import { cn } from "@/lib/utils";

export type TabKind =
  | "workspace"
  | "ticket"
  | "settings"
  | "global"
  | "document"
  | "file"
  | "review"
  | "git"
  | "workflow"
  | "workflow-docs"
  | "cron"
  | "cron-docs";

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
  source?: "local" | "docmost" | "notion" | "confluence";
  syncStatus?: "local" | "synced" | "error";
  syncTarget?: "docmost" | "notion" | "confluence";
  pageId?: string;
  preview?: boolean;
  dirty?: boolean;
  line?: number;
}

const ICONS: Record<TabKind, typeof FileIcon> = {
  workspace: LayoutGrid,
  ticket: Ticket,
  settings: Settings,
  global: SlidersHorizontal,
  document: FileText,
  file: FileIcon,
  review: GitCompare,
  git: GitBranch,
  workflow: Workflow,
  "workflow-docs": BookOpen,
  cron: Clock,
  "cron-docs": BookOpen,
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
      {tabs.map((tab, index) => (
        <TabItem
          key={tab.id}
          tab={tab}
          index={index}
          total={tabs.length}
          active={tab.id === activeId}
          onSelect={onSelect}
          onClose={onClose}
        />
      ))}
    </div>
  );
}

function TabItem({
  tab,
  index,
  total,
  active,
  onSelect,
  onClose,
}: {
  tab: EditorTab;
  index: number;
  total: number;
  active: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const { t } = useI18n();
  const Icon = ICONS[tab.kind];
  const hasAfter = index < total - 1;
  const hasBefore = index > 0;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-tab-id={tab.id}
          className={cn(
            "group flex h-[35px] items-center gap-2 border-t border-r border-t-transparent px-3 text-xs",
            active
              ? "border-t-primary bg-background text-foreground"
              : "text-muted-foreground hover:bg-accent",
          )}
          onAuxClick={(event) => {
            if (event.button !== 1) return;
            event.preventDefault();
            onClose(tab.id);
          }}
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
            aria-label={t("nav.tab.closeTab", { title: tab.title })}
            className={cn(
              "rounded p-0.5 hover:bg-accent",
              active ? "opacity-60" : "opacity-0 group-hover:opacity-60",
            )}
          >
            <X className="size-3" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => onClose(tab.id)}>
          <X />
          {t("nav.tab.close")}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={total <= 1}
          onSelect={() => requestTabMenuAction("close-others", tab.id)}
        >
          <CircleX />
          {t("nav.tab.closeOthers")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!hasAfter}
          onSelect={() => requestTabMenuAction("close-after", tab.id)}
        >
          <ArrowRightToLine />
          {t("nav.tab.closeRight")}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!hasBefore}
          onSelect={() => requestTabMenuAction("close-before", tab.id)}
        >
          <ArrowLeftToLine />
          {t("nav.tab.closeLeft")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => requestTabMenuAction("close-all")}>
          <ListX />
          {t("nav.tab.closeAll")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
