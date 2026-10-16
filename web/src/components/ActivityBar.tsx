import {
  FileText,
  FolderTree,
  LayoutGrid,
  Settings,
  SlidersHorizontal,
  Ticket,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type Menu = "workspace" | "files" | "document" | "ticket" | "settings" | "global";

const ITEMS: {
  id: Menu;
  label: string;
  icon: LucideIcon;
  requiresProject?: boolean;
  requiresWorkspace?: boolean;
  bottom?: boolean;
}[] = [
  { id: "workspace", label: "Workspace", icon: LayoutGrid },
  { id: "files", label: "Explorer", icon: FolderTree, requiresProject: true, requiresWorkspace: true },
  { id: "document", label: "Document", icon: FileText },
  { id: "ticket", label: "Ticket", icon: Ticket },
  { id: "settings", label: "Project Settings", icon: Settings, requiresProject: true },
  { id: "global", label: "Global Settings", icon: SlidersHorizontal, bottom: true },
];

interface Props {
  active: Menu;
  hasProject: boolean;
  hasWorkspace: boolean;
  onChange: (menu: Menu) => void;
}

export function ActivityBar({ active, hasProject, hasWorkspace, onChange }: Props) {
  const items = ITEMS.filter(
    (item) =>
      (!item.requiresProject || hasProject) && (!item.requiresWorkspace || hasWorkspace),
  );

  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-card/40 py-3">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Button
            key={item.id}
            variant="ghost"
            size="icon"
            title={item.label}
            aria-label={item.label}
            onClick={() => onChange(item.id)}
            className={cn(
              "text-muted-foreground",
              item.bottom && "mt-auto",
              active === item.id && "bg-accent text-accent-foreground",
            )}
          >
            <Icon />
          </Button>
        );
      })}
    </nav>
  );
}
