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
      <PanelHeader title="Tickets" count={count} />
      <div className="flex flex-col gap-3 px-3 pb-3">
        <Button
          size="sm"
          onClick={onCreate}
          disabled={!canCreate}
          data-icon="inline-start"
          className="w-full"
        >
          <Plus />
          Tiket baru
        </Button>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-muted-foreground">Filter assignee</span>
          <Select value={assigneeFilter} onValueChange={onFilter}>
            <SelectTrigger size="sm" className="w-full" aria-label="Filter assignee">
              <SelectValue placeholder="Semua user" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">Semua user</SelectItem>
                {hasUnassigned ? <SelectItem value="none">Tanpa assignee</SelectItem> : null}
                {assignees.map((assignee) => (
                  <SelectItem key={assignee} value={assignee}>
                    {assignee}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={onRefresh}
          disabled={loading}
          data-icon="inline-start"
          className="w-full"
        >
          {loading ? <Spinner /> : <RefreshCw />}
          Refresh
        </Button>
      </div>

      <p className="px-3 text-[11px] leading-relaxed text-muted-foreground">
        Tiket lokal dan Jira. Drag kartu antar kolom untuk mengubah status.
      </p>
    </>
  );
}
