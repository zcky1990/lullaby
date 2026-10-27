import {
  FileText,
  FolderTree,
  GitBranch,
  LayoutGrid,
  Settings,
  SlidersHorizontal,
  SquareTerminal,
  Ticket,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type Menu =
  | "workspace"
  | "files"
  | "terminal"
  | "git"
  | "document"
  | "ticket"
  | "workflow"
  | "settings"
  | "global";

const ITEMS: {
  id: Menu;
  label: string;
  icon: LucideIcon;
  requiresProject?: boolean;
  requiresWorkspace?: boolean;
  group: "main" | "tools";
}[] = [
  { id: "workspace", label: "Workspace", icon: LayoutGrid, group: "main" },
  {
    id: "files",
    label: "Explorer",
    icon: FolderTree,
    requiresProject: true,
    requiresWorkspace: true,
    group: "main",
  },
  { id: "document", label: "Document", icon: FileText, group: "main" },
  { id: "ticket", label: "Ticket", icon: Ticket, group: "main" },
  {
    id: "workflow",
    label: "Workflows",
    icon: Workflow,
    requiresProject: true,
    requiresWorkspace: true,
    group: "main",
  },
  {
    id: "settings",
    label: "Project Settings",
    icon: Settings,
    requiresProject: true,
    group: "main",
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: SquareTerminal,
    requiresProject: true,
    group: "tools",
  },
  {
    id: "git",
    label: "Git",
    icon: GitBranch,
    requiresProject: true,
    requiresWorkspace: true,
    group: "tools",
  },
  { id: "global", label: "Global Settings", icon: SlidersHorizontal, group: "tools" },
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
  const Icon = item.icon;
  const selected = item.id === "terminal" ? !!terminalOpen : active === item.id;
  return (
    <Button
      variant="ghost"
      size="icon"
      title={item.label}
      aria-label={item.label}
      aria-current={selected ? "page" : undefined}
      onClick={() => onChange(item.id)}
      className={cn(
        "relative size-12 shrink-0 rounded-none text-muted-foreground hover:bg-accent/60 hover:text-foreground [&_svg]:size-6",
        selected &&
          "bg-[var(--sidebar)] text-foreground before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary",
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
    <nav className="flex w-12 shrink-0 flex-col items-center border-r bg-[var(--activitybar)] py-2">
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
  );
}
