import type { ChatAttachment } from "../chat/types.ts";
import type { WorkflowDefinition, WorkflowLlmWith, WorkflowParam } from "./types.ts";

export const AGENT_PROVIDER_SUFFIX = "__provider";
export const AGENT_MODEL_SUFFIX = "__model";
export const AGENT_ATTACHMENTS_SUFFIX = "__attachments";

export function agentProviderKey(name: string): string {
  return `${name}${AGENT_PROVIDER_SUFFIX}`;
}

export function agentModelKey(name: string): string {
  return `${name}${AGENT_MODEL_SUFFIX}`;
}

export function agentAttachmentsKey(name: string): string {
  return `${name}${AGENT_ATTACHMENTS_SUFFIX}`;
}

export function isAgentCompanionKey(paramName: string, key: string): boolean {
  return key === agentProviderKey(paramName) ||
    key === agentModelKey(paramName) ||
    key === agentAttachmentsKey(paramName);
}

export function isAllowedParamOverrideKey(
  params: WorkflowParam[],
  key: string,
): boolean {
  for (const param of params) {
    if (param.name === key) return true;
    if (param.type === "agent" && isAgentCompanionKey(param.name, key)) return true;
  }
  return false;
}

function isParamReferenced(template: string | undefined, name: string): boolean {
  if (!template) return false;
  return template.includes(`\${params.${name}}`) ||
    template.includes(`\${${name}}`) ||
    template.includes(`params.${name}`);
}

function agentParams(definition: WorkflowDefinition): WorkflowParam[] {
  return definition.params.filter((param) => param.type === "agent");
}

function pickAgentParam(
  definition: WorkflowDefinition,
  config: WorkflowLlmWith,
): WorkflowParam | undefined {
  const agents = agentParams(definition);
  if (agents.length === 0) return undefined;
  const templates = [
    config.prompt,
    ...(config.messages ?? []).map((message) => message.content),
    config.provider,
    config.model,
  ];
  for (const param of agents) {
    if (templates.some((template) => isParamReferenced(template, param.name))) {
      return param;
    }
  }
  return agents.length === 1 ? agents[0] : undefined;
}

/** Resolve provider/model from step config, llm defaults, then agent-type param companions. */
export function resolveWorkflowLlmSelection(
  definition: WorkflowDefinition,
  config: WorkflowLlmWith,
  params: Record<string, string>,
  interpolate: (value: string) => string,
): { providerKey?: string; model?: string } {
  const rawProvider = config.provider ?? definition.llm?.provider;
  const rawModel = config.model ?? definition.llm?.model;
  let providerKey = rawProvider ? interpolate(rawProvider).trim() : "";
  let model = rawModel ? interpolate(rawModel).trim() : "";

  const agent = pickAgentParam(definition, config);
  if (agent) {
    if (!providerKey) providerKey = (params[agentProviderKey(agent.name)] ?? "").trim();
    if (!model) model = (params[agentModelKey(agent.name)] ?? "").trim();
  }

  return {
    providerKey: providerKey || undefined,
    model: model || undefined,
  };
}

export function collectAgentParamAttachments(
  definition: WorkflowDefinition,
  config: WorkflowLlmWith,
  params: Record<string, string>,
): ChatAttachment[] {
  const agents = agentParams(definition);
  if (agents.length === 0) return [];

  const selected = pickAgentParam(definition, config);
  const targets = selected ? [selected] : agents.length === 1 ? agents : [];
  const out: ChatAttachment[] = [];

  for (const param of targets) {
    const raw = params[agentAttachmentsKey(param.name)];
    if (!raw?.trim()) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        const type = row.type;
        const name = typeof row.name === "string" ? row.name : "";
        const data = typeof row.data === "string" ? row.data : "";
        const mime = typeof row.mime === "string" ? row.mime : undefined;
        if ((type === "image" || type === "text") && name && data) {
          out.push({ type, name, mime, data });
        }
      }
    } catch {
      // ignore malformed attachment payload
    }
  }
  return out;
}
