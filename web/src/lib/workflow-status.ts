import type { WorkflowRunStatus, WorkflowStepStatus } from "@/lib/api";

export function runBadgeVariant(
  status: WorkflowRunStatus,
): "success" | "destructive" | "secondary" | "outline" {
  switch (status) {
    case "success":
      return "success";
    case "failed":
      return "destructive";
    case "running":
      return "secondary";
    default:
      return "outline";
  }
}

export function stepBadgeVariant(
  status: WorkflowStepStatus,
): "success" | "destructive" | "secondary" | "outline" {
  switch (status) {
    case "success":
      return "success";
    case "failed":
      return "destructive";
    case "running":
      return "secondary";
    default:
      return "outline";
  }
}

export function stepBorderClass(status?: WorkflowStepStatus): string {
  switch (status) {
    case "success":
      return "border-emerald-500/70";
    case "failed":
      return "border-red-500/70";
    case "running":
      return "border-amber-500/70";
    case "skipped":
      return "border-muted-foreground/40";
    case "canceled":
      return "border-muted-foreground/40";
    default:
      return "border-border";
  }
}
