import { CHAT_TOOL_CATALOG, WRITE_TOOLS } from "./tools.ts";

/**
 * Tools that may ask for a per-call permission prompt. Derived from the chat
 * tool catalog so the UI badge and the server policy cannot drift apart.
 */
export const APPROVAL_REQUIRED_TOOLS: ReadonlySet<string> = new Set(
  CHAT_TOOL_CATALOG.filter((tool) => tool.requiresApproval).map((tool) => tool.name),
);

export interface ToolPermissionQuery {
  toolName: string;
  disabledTools: readonly string[];
  autoApproveTools: readonly string[];
  allowedTools?: ReadonlySet<string>;
  /** Injectable for tests; defaults to the catalog. */
  approvalRequiredTools?: ReadonlySet<string>;
  writeTools?: ReadonlySet<string>;
}

/**
 * Policy for the per-call permission prompt in chat.
 *
 * File writes never prompt: they are governed by `writeReviewMode` (`end` =
 * apply during the run and review once it finishes, `before` = pause and review
 * before writing). Read-only tools do not prompt either, so turning
 * auto-approve off keeps the run going and only the end-of-run review needs
 * attention.
 */
export function needsToolPermission(query: ToolPermissionQuery): boolean {
  const approvalRequired = query.approvalRequiredTools ?? APPROVAL_REQUIRED_TOOLS;
  const writeTools = query.writeTools ?? WRITE_TOOLS;
  if (!approvalRequired.has(query.toolName)) return false;
  if (writeTools.has(query.toolName)) return false;
  if (query.disabledTools.includes(query.toolName)) return false;
  if (query.autoApproveTools.includes(query.toolName)) return false;
  if (query.allowedTools?.has(query.toolName)) return false;
  return true;
}
