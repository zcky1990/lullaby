import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface ActivityEvent {
  type: string;
  ts: string;
  payload?: unknown;
}

export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Activity</CardTitle>
      </CardHeader>
      <CardContent className="max-h-64 overflow-y-auto text-sm">
        {events.length === 0 && <p className="text-muted-foreground">Belum ada aktivitas.</p>}
        {events.map((event, index) => (
          <div
            key={`${event.ts}-${index}`}
            className="flex items-center justify-between border-b border-border/50 py-1.5 last:border-0"
          >
            <span className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-primary" />
              {event.type}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(event.ts).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
