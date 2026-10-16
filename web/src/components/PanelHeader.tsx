import { Badge } from "@/components/ui/badge";

export function PanelHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center justify-between px-3 py-3">
      <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
        {title}
      </span>
      {count !== undefined && <Badge variant="secondary">{count}</Badge>}
    </div>
  );
}
