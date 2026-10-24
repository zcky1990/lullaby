import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SkillOption {
  name: string;
  description: string;
  source: string;
}

interface Props {
  skills: SkillOption[];
  activeIndex: number;
  onSelect: (skill: SkillOption) => void;
  onHover: (index: number) => void;
}

export function SkillMentionMenu({ skills, activeIndex, onSelect, onHover }: Props) {
  if (skills.length === 0) {
    return (
      <div className="absolute bottom-full left-0 z-20 mb-1 w-full max-w-sm rounded-md border bg-popover p-2 text-xs text-muted-foreground shadow-md">
        Tidak ada skill yang cocok.
      </div>
    );
  }

  return (
    <div
      role="listbox"
      aria-label="Pilih skill"
      className="absolute bottom-full left-0 z-20 mb-1 max-h-56 w-full max-w-sm overflow-y-auto rounded-md border bg-popover py-1 shadow-md"
    >
      {skills.map((skill, index) => (
        <button
          key={`${skill.source}:${skill.name}`}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={cn(
            "flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-sm",
            index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
          )}
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(skill);
          }}
        >
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-xs font-medium">/{skill.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {skill.description || skill.source}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
