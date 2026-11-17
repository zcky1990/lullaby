import {
  Bell,
  Cpu,
  Database,
  Info,
  type LucideIcon,
  MessageSquareText,
  Palette,
  Server,
  ServerCog,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Users,
  Zap,
} from "lucide-react";
import { PanelHeader } from "@/components/PanelHeader";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type GlobalSection =
  | "appearance"
  | "llm"
  | "roles"
  | "prompts"
  | "mcp"
  | "skills"
  | "tools"
  | "lsp"
  | "automation"
  | "notifications"
  | "terminal"
  | "backup"
  | "about";

const SECTIONS: { id: GlobalSection; labelKey: string; icon: LucideIcon }[] = [
  { id: "appearance", labelKey: "settings.global.section.appearance", icon: Palette },
  { id: "llm", labelKey: "settings.global.section.llm", icon: Cpu },
  { id: "roles", labelKey: "settings.global.section.roles", icon: Users },
  { id: "prompts", labelKey: "settings.global.section.prompts", icon: MessageSquareText },
  { id: "mcp", labelKey: "settings.global.section.mcp", icon: Server },
  { id: "skills", labelKey: "settings.global.section.skills", icon: Sparkles },
  { id: "tools", labelKey: "settings.global.section.tools", icon: ShieldCheck },
  { id: "lsp", labelKey: "settings.global.section.lsp", icon: ServerCog },
  { id: "automation", labelKey: "settings.global.section.automation", icon: Zap },
  { id: "notifications", labelKey: "settings.global.section.notifications", icon: Bell },
  { id: "terminal", labelKey: "settings.global.section.terminal", icon: SquareTerminal },
  { id: "backup", labelKey: "settings.global.section.backup", icon: Database },
  { id: "about", labelKey: "settings.global.section.about", icon: Info },
];

interface Props {
  section: GlobalSection;
  onSelect: (section: GlobalSection) => void;
}

export function GlobalSettingsPanel({ section, onSelect }: Props) {
  const { t } = useI18n();
  return (
    <>
      <PanelHeader title={t("settings.global.title")} />
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
