import { Cpu, FolderCog, type LucideIcon, Plug, ScrollText } from "lucide-react";
import { PanelHeader } from "@/components/PanelHeader";
import { cn } from "@/lib/utils";

export type SettingsSection = "workspace" | "integrations" | "llm" | "activity";

const SECTIONS: { id: SettingsSection; label: string; icon: LucideIcon }[] = [
  { id: "workspace", label: "Workspace", icon: FolderCog },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "llm", label: "LLM Providers", icon: Cpu },
  { id: "activity", label: "Activity", icon: ScrollText },
];

interface Props {
  section: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}

export function SettingsPanel({ section, onSelect }: Props) {
  return (
    <>
      <PanelHeader title="Settings" />
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {SECTIONS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={cn(
                "mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                item.id === section && "bg-accent",
              )}
            >
              <Icon className="size-4 text-muted-foreground" />
              {item.label}
            </button>
          );
        })}
      </div>
    </>
  );
}
