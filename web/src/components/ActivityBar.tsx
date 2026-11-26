import {
  Clock,
  FileText,
  FolderTree,
  GitBranch,
  LayoutGrid,
  ScrollText,
  Search,
  Settings,
  SlidersHorizontal,
  SquareTerminal,
  Ticket,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { DocStudioPanel } from "@/components/DocStudioPanel";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type Menu =
  | "workspace"
  | "files"
  | "find"
  | "terminal"
  | "git"
  | "document"
  | "docstudio"
  | "ticket"
  | "workflow"
  | "cron"
  | "settings"
  | "global";

/** Lebar panel Doc Studio (dirender dari sini, bukan dari `App.tsx`). */
const DOC_STUDIO_WIDTH = 288;

const ITEMS: {
  id: Menu;
  labelKey: string;
  icon: LucideIcon;
  requiresProject?: boolean;
  requiresWorkspace?: boolean;
  group: "main" | "tools";
}[] = [
  { id: "workspace", labelKey: "nav.workspace", icon: LayoutGrid, group: "main" },
  {
    id: "files",
    labelKey: "nav.files",
    icon: FolderTree,
    requiresProject: true,
    requiresWorkspace: true,
    group: "main",
  },
  {
    id: "find",
    labelKey: "nav.find",
    icon: Search,
    requiresProject: true,
    requiresWorkspace: true,
    group: "main",
  },
  { id: "document", labelKey: "nav.document", icon: FileText, group: "main" },
  {
    id: "docstudio",
    labelKey: "nav.docStudio",
    icon: ScrollText,
    requiresProject: true,
    group: "main",
  },
  { id: "ticket", labelKey: "nav.ticket", icon: Ticket, group: "main" },
  {
    id: "workflow",
    labelKey: "nav.workflow",
    icon: Workflow,
    requiresProject: true,
    requiresWorkspace: true,
    group: "main",
  },
  {
    id: "cron",
    labelKey: "nav.cron",
    icon: Clock,
    requiresProject: true,
    requiresWorkspace: true,
    group: "main",
  },
  {
    id: "settings",
    labelKey: "nav.settings",
    icon: Settings,
    requiresProject: true,
    group: "main",
  },
  {
    id: "terminal",
    labelKey: "nav.terminal",
    icon: SquareTerminal,
    requiresProject: true,
    group: "tools",
  },
  {
    id: "git",
    labelKey: "nav.git",
    icon: GitBranch,
    requiresProject: true,
    requiresWorkspace: true,
    group: "tools",
  },
  { id: "global", labelKey: "nav.global", icon: SlidersHorizontal, group: "tools" },
];

interface Props {
  active: Menu;
  hasProject: boolean;
  hasWorkspace: boolean;
  terminalOpen?: boolean;
  onChange: (menu: Menu) => void;
}

function MenuButton({
  item,
  active,
  terminalOpen,
  onChange,
}: {
  item: (typeof ITEMS)[number];
  active: Menu;
  terminalOpen?: boolean;
  onChange: (menu: Menu) => void;
}) {
  const { t } = useI18n();
  const Icon = item.icon;
  const selected = item.id === "terminal" ? !!terminalOpen : active === item.id;
  const label = t(item.labelKey);
  return (
    <Button
      variant="ghost"
      size="icon"
      title={label}
      aria-label={label}
      data-menu={item.id}
      aria-current={selected ? "page" : undefined}
      onClick={() => onChange(item.id)}
      className={cn(
        "size-9 shrink-0 rounded-xl text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground [&_svg]:size-5",
        selected && "bg-accent text-foreground shadow-sm",
      )}
    >
      <Icon />
    </Button>
  );
}

export function ActivityBar({
  active,
  hasProject,
  hasWorkspace,
  terminalOpen,
  onChange,
}: Props) {
  const visible = ITEMS.filter(
    (item) =>
      (!item.requiresProject || hasProject) && (!item.requiresWorkspace || hasWorkspace),
  );
  const main = visible.filter((item) => item.group === "main");
  const tools = visible.filter((item) => item.group === "tools");

  return (
    <>
      <nav className="flex w-12 shrink-0 flex-col items-center border-r border-border/50 bg-[var(--activitybar)]/70 py-2 backdrop-blur-xl">
        <div className="flex w-full flex-col items-center gap-0.5">
          {main.map((item) => (
            <MenuButton
              key={item.id}
              item={item}
              active={active}
              terminalOpen={terminalOpen}
              onChange={onChange}
            />
          ))}
        </div>

        {tools.length > 0 ? (
          <div className="mt-auto flex w-full flex-col items-center gap-0.5 border-t border-border/60 pt-2">
            {tools.map((item) => (
              <MenuButton
                key={item.id}
                item={item}
                active={active}
                terminalOpen={terminalOpen}
                onChange={onChange}
              />
            ))}
          </div>
        ) : null}
      </nav>

      {/*
        Panel Doc Studio dirender di sini (bukan di `App.tsx`) supaya menu baru
        tidak butuh perubahan shell: sibling `<aside>` ikut jadi flex item di
        antara rail dan `<main>`, sama seperti panel menu lain.
      */}
      {active === "docstudio" && hasProject ? (
        <aside
          style={{ width: DOC_STUDIO_WIDTH }}
          className="flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-border/50 bg-[var(--sidebar)]/70 backdrop-blur-xl"
        >
          <DocStudioPanel />
        </aside>
      ) : null}
    </>
  );
}
