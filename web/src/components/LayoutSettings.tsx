import { Maximize2, Rows3 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type LayoutMode, LAYOUT_SHORTCUT, setLayoutMode } from "@/lib/layout-mode";
import { useLayoutMode } from "@/hooks/useLayoutMode";

const LAYOUT_OPTIONS: { id: LayoutMode; label: string; icon: typeof Rows3 }[] = [
  { id: "standard", label: "Standard", icon: Rows3 },
  { id: "focus", label: "Deep work", icon: Maximize2 },
];

/** Global Settings → Appearance: shell layout (`web/src/lib/layout-mode.ts`). */
export function LayoutSettings() {
  const layout = useLayoutMode();
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Layout
        </h2>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Deep work</span> menyembunyikan activity bar, panel kiri,
          tab strip, dan status bar sehingga tersisa Kanban + chat. Toggle cepat{" "}
          <kbd className="rounded border px-1 font-mono text-[10px]">{LAYOUT_SHORTCUT}</kbd>.
        </p>
        <Separator />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">Mode layout</span>
        <ToggleGroup
          type="single"
          variant="outline"
          value={layout}
          onValueChange={(value) => value && setLayoutMode(value as LayoutMode)}
          className="w-fit"
        >
          {LAYOUT_OPTIONS.map((option) => (
            <ToggleGroupItem key={option.id} value={option.id} aria-label={option.label}>
              <option.icon />
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="text-xs text-muted-foreground">
          Disimpan lokal di mesin ini (tidak ikut export/import config).
        </span>
      </div>
    </section>
  );
}
