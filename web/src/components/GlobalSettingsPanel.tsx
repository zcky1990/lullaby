import { Code2, Info, type LucideIcon, Palette } from "lucide-react";
import { PanelHeader } from "@/components/PanelHeader";
import { cn } from "@/lib/utils";

export type GlobalSection = "appearance" | "editor" | "about";

const SECTIONS: { id: GlobalSection; label: string; icon: LucideIcon }[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "editor", label: "Editor", icon: Code2 },
  { id: "about", label: "About", icon: Info },
];

interface Props {
  section: GlobalSection;
  onSelect: (section: GlobalSection) => void;
}

export function GlobalSettingsPanel({ section, onSelect }: Props) {
  return (
    <>
      <PanelHeader title="Global Settings" />
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
