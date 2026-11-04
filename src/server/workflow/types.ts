export interface WorkflowRetryPolicy {
  limit: number;
  intervalSec: number;
}

export interface WorkflowLlmSettings {
  provider?: string;
  model?: string;
  session?: string;
  role?: string;
  system?: string;
  temperature?: number;
}

export interface WorkflowLlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface WorkflowLlmWith {
  prompt?: string;
  messages?: WorkflowLlmMessage[];
  system?: string;
  provider?: string;
  role?: string;
  session?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  mode?: "plan" | "build";
  skill?: string;
  variant?: "short" | "medium" | "long";
  maxSteps?: number;
}

export interface WorkflowRouterWith {
  value: string;
  routes: Record<string, string[]>;
  /** Targets that jump back to an earlier step (loop). */
  loopBacks: string[];
  maxLoops: number;
}

export interface WorkflowNotifyWith {
  /** Channel id or name from Global Settings → Notifications. */
  channel: string;
  /** Message body (supports ${params.*} / ${steps.*} interpolation). */
  message: string;
}

export type WorkflowParamType = "string" | "integer" | "number" | "boolean" | "agent";

export interface WorkflowParam {
  name: string;
  type?: WorkflowParamType;
  default?: string;
  description?: string;
}

export interface WorkflowStep {
  id: string;
  kind: "shell" | "llm" | "agent" | "router" | "notify";
  run?: string;
  action?: string;
  with?: WorkflowLlmWith;
  router?: WorkflowRouterWith;
  notify?: WorkflowNotifyWith;
  output?: string;
  outputs: string[];
  depends: string[];
  env: Record<string, string>;
  workingDir?: string;
  retry: WorkflowRetryPolicy;
  timeoutSec?: number;
  continueOn?: string;
  /** After success, reset and re-run these steps (loop). */
  next: string[];
  /** Step only runs when this router selected it. */
  routeGate?: { routerId: string };
}

export interface WorkflowSchedule {
  cron: string;
  enabled: boolean;
  timezone?: string;
}

export interface WorkflowEventTrigger {
  event: string;
  /** Optional exact match on payload.status (e.g. ticket.transitioned). */
  status?: string;
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  type?: string;
  params: WorkflowParam[];
  env: Record<string, string>;
  workingDir?: string;
  timeoutSec?: number;
  llm?: WorkflowLlmSettings;
  schedule?: WorkflowSchedule;
  on: WorkflowEventTrigger[];
  steps: WorkflowStep[];
  layers: string[][];
}

export interface WorkflowScheduleInfo {
  cron?: string;
  timezone?: string;
  enabled: boolean;
  events: WorkflowEventTrigger[];
  nextRunAt?: string;
  lastRunAt?: string;
  lastRunId?: string;
}

export interface WorkflowSummary {
  slug: string;
  name: string;
  description?: string;
  path: string;
  source: "workspace" | "app";
  updatedAt?: string;
  stepCount: number;
  schedule?: WorkflowScheduleInfo;
  error?: string;
}

export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}
