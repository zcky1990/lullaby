import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/PanelHeader";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n";

export interface TicketPanelProps {
  count: number;
  loading: boolean;
  assignees: string[];
  hasUnassigned: boolean;
  assigneeFilter: string;
  onFilter: (value: string) => void;
  onRefresh: () => void;
  onCreate: () => void;
  canCreate: boolean;
}

export function TicketPanel({
  count,
  loading,
  assignees,
  hasUnassigned,
  assigneeFilter,
  onFilter,
  onRefresh,
  onCreate,
  canCreate,
}: TicketPanelProps) {
  const { t } = useI18n();

  return (
    <>
      <div className="flex items-center justify-between pr-2">
        <PanelHeader title={t("tickets.panel.title")} count={count} />
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={onCreate}
            disabled={!canCreate}
            aria-label={t("tickets.panel.newTicket")}
            title={t("tickets.panel.newTicket")}
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            disabled={loading}
            aria-label={t("tickets.panel.refreshAria")}
            title={t("tickets.panel.refreshTitle")}
          >
            {loading ? <Spinner /> : <RefreshCw />}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 px-3 pb-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {t("tickets.panel.filterAssignee")}
          </span>
          <Select value={assigneeFilter} onValueChange={onFilter}>
            <SelectTrigger
              size="sm"
              className="w-full text-xs"
              aria-label={t("tickets.panel.filterAssignee")}
            >
              <SelectValue placeholder={t("tickets.panel.allUsers")} className="text-xs"/>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all" className="text-xs">{t("tickets.panel.allUsers")}</SelectItem>
                {hasUnassigned ? (
                  <SelectItem value="none" className="text-xs">
                    {t("tickets.panel.unassigned")}
                  </SelectItem>
                ) : null}
                {assignees.map((assignee) => (
                  <SelectItem className="text-xs" key={assignee} value={assignee}>
                    {assignee}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("tickets.panel.hintPrefix")}
          <span className="font-medium">{t("tickets.panel.hintAction")}</span>
          {t("tickets.panel.hintSuffix")}
        </p>
      </div>
    </>
  );
}
