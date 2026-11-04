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
}

export interface WorkflowParam {
  name: string;
  type?: "string" | "integer" | "number" | "boolean";
  default?: string;
  description?: string;
}

export interface WorkflowStep {
  id: string;
  kind: "shell" | "llm" | "agent" | "router";
  run?: string;
  action?: string;
  with?: WorkflowLlmWith;
  router?: WorkflowRouterWith;
  output?: string;
  outputs: string[];
  depends: string[];
  env: Record<string, string>;
  workingDir?: string;
  retry: WorkflowRetryPolicy;
  timeoutSec?: number;
  continueOn?: string;
  /** Step only runs when this router selected it. */
  routeGate?: { routerId: string };
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
  steps: WorkflowStep[];
  layers: string[][];
}

export interface WorkflowSummary {
  slug: string;
  name: string;
  description?: string;
  path: string;
  source: "workspace" | "app";
  updatedAt?: string;
  stepCount: number;
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
