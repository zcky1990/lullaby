import { Badge } from "@/components/ui/badge";

export function PanelHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex h-[35px] items-center justify-between px-4">
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </span>
      {count !== undefined && (
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
          {count}
        </Badge>
      )}
    </div>
  );
}
