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
}

export interface WorkflowStep {
  id: string;
  kind: "shell" | "llm";
  run?: string;
  action?: string;
  with?: WorkflowLlmWith;
  output?: string;
  depends: string[];
  env: Record<string, string>;
  workingDir?: string;
  retry: WorkflowRetryPolicy;
  timeoutSec?: number;
  continueOn?: string;
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  env: Record<string, string>;
  workingDir?: string;
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
