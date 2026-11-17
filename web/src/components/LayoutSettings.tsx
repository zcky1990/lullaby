import { Maximize2, Rows3 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/lib/i18n";
import { type LayoutMode, LAYOUT_SHORTCUT, setLayoutMode } from "@/lib/layout-mode";
import { useLayoutMode } from "@/hooks/useLayoutMode";

const LAYOUT_OPTIONS: { id: LayoutMode; labelKey: string; icon: typeof Rows3 }[] = [
  { id: "standard", labelKey: "settings.layout.modeStandard", icon: Rows3 },
  { id: "focus", labelKey: "settings.layout.modeFocus", icon: Maximize2 },
];

/** Global Settings → Appearance: shell layout (`web/src/lib/layout-mode.ts`). */
export function LayoutSettings() {
  const layout = useLayoutMode();
  const { t } = useI18n();
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {t("settings.layout.title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">{t("settings.layout.deepWork")}</span>{" "}
          {t("settings.layout.descriptionPrefix")}{" "}
          <kbd className="rounded border px-1 font-mono text-[10px]">{LAYOUT_SHORTCUT}</kbd>.
        </p>
        <Separator />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">{t("settings.layout.modeLabel")}</span>
        <ToggleGroup
          type="single"
          variant="outline"
          value={layout}
          onValueChange={(value) => value && setLayoutMode(value as LayoutMode)}
          className="w-fit"
        >
          {LAYOUT_OPTIONS.map((option) => (
            <ToggleGroupItem key={option.id} value={option.id} aria-label={t(option.labelKey)}>
              <option.icon />
              {t(option.labelKey)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="text-xs text-muted-foreground">
          {t("settings.layout.savedLocally")}
        </span>
      </div>
    </section>
  );
}
