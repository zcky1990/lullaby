import type { ChatChange, LlmProviderRow } from "../../db/db.ts";
import type { DiffHunk } from "../diff.ts";
import type { SkillInfo } from "../skills.ts";

export interface ChatAttachment {
  type: "image" | "text" | "workspace";
  name: string;
  mime?: string;
  path?: string;
  data?: string;
}

export interface ChatTurn {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  attachments?: ChatAttachment[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface VisibleMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
}

export interface CreatedTicket {
  id: string;
  key: string;
  title: string;
}

export interface PendingHunk extends DiffHunk {
  decision: "pending" | "accepted" | "rejected";
}

export interface PendingFileChange {
  callId: string;
  path: string;
  action: "create" | "update";
  added: number;
  removed: number;
  hunks: PendingHunk[];
}

export type ChatResponse =
  | {
    status: "done";
    message: string;
    sessionId: string;
    changes: ChatChange[];
    createdTickets: CreatedTicket[];
  }
  | {
    status: "approval_required";
    runId: string;
    pending: PendingApproval[];
    pendingChanges: PendingFileChange[];
    sessionId: string;
    changes: ChatChange[];
    createdTickets: CreatedTicket[];
  }
  | { status: "error"; error: string; sessionId?: string };

export interface PendingApproval {
  id: string;
  tool: string;
  summary: string;
}

export interface Run {
  id: string;
  provider: LlmProviderRow;
  workspace: string | null;
  sessionId: string;
  temperature?: number;
  turns: ChatTurn[];
  pendingBatch: ToolCall[];
  pendingChanges: Map<string, PendingChange>;
  batchResults: Map<string, string>;
  changes: ChatChange[];
  projectId: string;
  mode: "plan" | "build";
  skills: Map<string, SkillInfo>;
  createdTickets: CreatedTicket[];
  createdAt: number;
}

export interface PendingChange {
  call: ToolCall;
  path: string;
  action: "create" | "update";
  before: string;
  after: string;
  hunks: DiffHunk[];
  added: number;
  removed: number;
  decisions: Map<number, boolean>;
}
