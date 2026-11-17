import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import type { ProjectDetail } from "@/lib/api";

interface Props {
  detail: ProjectDetail;
  onOpenSettings: () => void;
}

export function WorkspaceOverview({ detail, onOpenSettings }: Props) {
  const { t } = useI18n();
  const { project, integrations } = detail;
  const workspacePath = project.workspace_path ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-sm font-semibold">{project.name}</h1>
        <p className="text-xs text-muted-foreground">
          {t("app.workspaceOverview.pathLabel", { path: workspacePath })}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label={t("app.workspaceOverview.statIntegrations")}
          value={integrations.length}
        />
        <StatCard
          label={t("app.workspaceOverview.statWorkspace")}
          value={project.workspace_path ? 1 : 0}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xs">{t("app.workspaceOverview.startHere")}</CardTitle>
          <CardDescription>
            {t("app.workspaceOverview.startHerePrefix")}
            <span className="font-medium">{t("app.workspaceOverview.startHereAction")}</span>
            {t("app.workspaceOverview.startHereSuffix")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" onClick={onOpenSettings}>
            {t("app.workspaceOverview.openSettings")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
