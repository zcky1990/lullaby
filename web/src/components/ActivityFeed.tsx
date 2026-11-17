import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

export interface ActivityEvent {
  type: string;
  ts: string;
  payload?: unknown;
}

export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs">{t("chat.activity.title")}</CardTitle>
      </CardHeader>
      <CardContent className="max-h-64 overflow-y-auto text-xs">
        {events.length === 0 && (
          <p className="text-muted-foreground">{t("chat.activity.empty")}</p>
        )}
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
