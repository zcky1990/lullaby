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

interface Props {
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
}: Props) {
  return (
    <>
      <div className="flex items-center justify-between pr-2">
        <PanelHeader title="Tickets" count={count} />
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={onCreate}
            disabled={!canCreate}
            aria-label="Tiket baru"
            title="Tiket baru"
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh tickets"
            title="Refresh"
          >
            {loading ? <Spinner /> : <RefreshCw />}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 px-3 pb-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Filter assignee</span>
          <Select value={assigneeFilter} onValueChange={onFilter}>
            <SelectTrigger size="sm" className="w-full text-xs" aria-label="Filter assignee">
              <SelectValue placeholder="Semua user" className="text-xs"/>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all" className="text-xs">Semua user</SelectItem>
                {hasUnassigned ? <SelectItem value="none" className="text-xs">Tanpa assignee</SelectItem> : null}
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
          Tiket lokal dan Jira. Drag kartu antar kolom untuk mengubah status.
        </p>
      </div>
    </>
  );
}
