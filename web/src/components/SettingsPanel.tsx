import { Database, FolderCog, Plug, ScrollText, type LucideIcon } from "lucide-react";
import { PanelHeader } from "@/components/PanelHeader";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type SettingsSection = "workspace" | "integrations" | "activity" | "backup";

const SECTIONS: { id: SettingsSection; labelKey: string; icon: LucideIcon }[] = [
  { id: "workspace", labelKey: "settings.panel.workspace", icon: FolderCog },
  { id: "integrations", labelKey: "settings.panel.integrations", icon: Plug },
  { id: "activity", labelKey: "settings.panel.activity", icon: ScrollText },
  { id: "backup", labelKey: "settings.panel.backup", icon: Database },
];

interface Props {
  section: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}

export function SettingsPanel({ section, onSelect }: Props) {
  const { t } = useI18n();
  return (
    <>
      <PanelHeader title={t("settings.panel.title")} />
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {SECTIONS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={cn(
                "mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors hover:bg-accent",
                item.id === section && "bg-accent",
              )}
            >
              <Icon className="size-4 text-muted-foreground" />
              {t(item.labelKey)}
            </button>
          );
        })}
      </div>
    </>
  );
}
