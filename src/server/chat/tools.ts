import { LocalTicketInput } from "../../config/schema.ts";
import { createLocalTicket } from "../../db/db.ts";
import {
  listDirectory,
  readWorkspaceFile,
  readWorkspaceFileRaw,
  writeWorkspaceFile,
} from "../../fs/workspace.ts";
import { readSkillBody } from "../skills.ts";
import {
  createDocumentTool,
  getDocumentTool,
  listDocumentsTool,
  syncDocumentTool,
  updateDocumentTool,
} from "./document-tools.ts";
import { safeParse } from "./llm.ts";
import {
  deleteTicketTool,
  getTicketTool,
  listTicketsTool,
  syncTicketTool,
  transitionTicketTool,
  updateTicketTool,
} from "./ticket-tools.ts";
import type { ChatAttachment, Run, ToolCall, ToolDef } from "./types.ts";

export interface ChatToolCatalogEntry {
  name: string;
  description: string;
  requiresApproval: boolean;
}

export const CHAT_TOOL_CATALOG: ChatToolCatalogEntry[] = [
  {
    name: "list_files",
    description: "List files and directories at a path relative to the workspace root.",
    requiresApproval: false,
  },
  {
    name: "read_file",
    description: "Read a text file from the workspace.",
    requiresApproval: false,
  },
  {
    name: "write_file",
    description: "Create or overwrite a text file in the workspace with the given content.",
    requiresApproval: true,
  },
  {
    name: "list_documents",
    description: "List documents from local, docmost, notion, or confluence.",
    requiresApproval: false,
  },
  {
    name: "get_document",
    description: "Read one document (local path or remote pageId).",
    requiresApproval: false,
  },
  {
    name: "create_document",
    description: "Create a local markdown doc or a Docmost page.",
    requiresApproval: false,
  },
  {
    name: "update_document",
    description: "Update a local markdown doc or a Docmost page.",
    requiresApproval: false,
  },
  {
    name: "sync_document",
    description: "Sync a local document to Docmost (create/update remote page).",
    requiresApproval: false,
  },
  {
    name: "list_tickets",
    description: "List local backlog tickets merged with Jira issues when configured.",
    requiresApproval: false,
  },
  {
    name: "get_ticket",
    description: "Get a local ticket by id or a Jira issue by key.",
    requiresApproval: false,
  },
  {
    name: "create_ticket",
    description: "Create a ticket in the project's local backlog (not synced to Jira).",
    requiresApproval: false,
  },
  {
    name: "update_ticket",
    description: "Update a local ticket by id.",
    requiresApproval: false,
  },
  {
    name: "delete_ticket",
    description: "Delete an unsynced local ticket by id.",
    requiresApproval: false,
  },
  {
    name: "sync_ticket",
    description: "Sync a local ticket to Jira (creates a remote issue).",
    requiresApproval: false,
  },
  {
    name: "transition_ticket",
    description: "Transition a Jira issue to a named status.",
    requiresApproval: false,
  },
  {
    name: "use_skill",
    description: "Load the full instructions of an available skill by name (read-only).",
    requiresApproval: false,
  },
];

const TOOL_DEFS: ToolDef[] = [
  {
    name: "list_files",
    description: "List files and directories at a path relative to the workspace root.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative path (default root)." } },
    },
  },
  {
    name: "read_file",
    description: "Read a text file from the workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative file path." } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a text file in the workspace with the given content.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path." },
        content: { type: "string", description: "Full new file content." },
      },
      required: ["path", "content"],
    },
  },
];

const DOC_READ_TOOLS: ToolDef[] = [
  {
    name: "list_documents",
    description:
      "List documents. source: local | docmost | notion | confluence. Optional pageId for remote tree.",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          enum: ["local", "docmost", "notion", "confluence"],
          description: "Document source (default local).",
        },
        pageId: { type: "string", description: "Optional parent page id for remote sources." },
      },
    },
  },
  {
    name: "get_document",
    description: "Read one document. Local needs path; remote needs pageId (or path as pageId).",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          enum: ["local", "docmost", "notion", "confluence"],
        },
        path: { type: "string", description: "Local relative .md path." },
        pageId: { type: "string", description: "Remote page id." },
      },
    },
  },
];

const DOC_WRITE_TOOLS: ToolDef[] = [
  {
    name: "create_document",
    description: "Create a local markdown document or a Docmost page (source local|docmost).",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["local", "docmost"] },
        title: { type: "string" },
        parentId: { type: "string", description: "Docmost parent page id (optional)." },
        content: { type: "string", description: "Optional Docmost content after create." },
      },
      required: ["title"],
    },
  },
  {
    name: "update_document",
    description: "Update local (path) or Docmost (pageId) document title/content.",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["local", "docmost"] },
        path: { type: "string" },
        pageId: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
      },
    },
  },
  {
    name: "sync_document",
    description: "Sync a local document path to Docmost (create/update remote page).",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Local document path." } },
      required: ["path"],
    },
  },
];

const TICKET_READ_TOOLS: ToolDef[] = [
  {
    name: "list_tickets",
    description: "List local backlog tickets merged with Jira issues when configured.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_ticket",
    description: "Get a local ticket by UUID/LOCAL- prefix or a Jira issue by key.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Local ticket UUID or LOCAL-xxxxxx." },
        key: { type: "string", description: "Jira issue key." },
      },
    },
  },
];

export const TICKET_TOOL: ToolDef = {
  name: "create_ticket",
  description:
    "Create a ticket in the project's local backlog. It is stored locally and NOT synced to " +
    "Jira; use sync_ticket later or let the user sync manually.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short ticket title." },
      description: { type: "string", description: "Detailed ticket description." },
      status: {
        type: "string",
        enum: ["Backlog", "To Do", "In Progress", "Test", "Done"],
      },
      priority: { type: "string", enum: ["Low", "Medium", "High", "Urgent"] },
      type: { type: "string", enum: ["Task", "Bug", "Story"] },
    },
    required: ["title"],
  },
};

const TICKET_WRITE_TOOLS: ToolDef[] = [
  TICKET_TOOL,
  {
    name: "update_ticket",
    description: "Update fields on a local ticket by id.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        status: {
          type: "string",
          enum: ["Backlog", "To Do", "In Progress", "Test", "Done"],
        },
        priority: { type: "string", enum: ["Low", "Medium", "High", "Urgent"] },
        type: { type: "string", enum: ["Task", "Bug", "Story"] },
        assignee: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_ticket",
    description: "Delete an unsynced local ticket (fails if jira_key is set).",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "sync_ticket",
    description: "Push a local ticket to Jira and store jira_key.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "transition_ticket",
    description: "Transition a Jira issue to a status name (e.g. In Progress).",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string" },
        status: { type: "string" },
      },
      required: ["key", "status"],
    },
  },
];

const USE_SKILL_TOOL: ToolDef = {
  name: "use_skill",
  description:
    "Load the full instructions of an available skill by name (read-only). Call this when a " +
    "listed skill matches the task, then follow the returned instructions.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Skill name exactly as listed." },
    },
    required: ["name"],
  },
};

const TICKET_STATUSES = ["Backlog", "To Do", "In Progress", "Test", "Done"] as const;
const TICKET_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
const TICKET_TYPES = ["Task", "Bug", "Story"] as const;

function pickTicketValue<T extends string>(
  options: readonly T[],
  value: unknown,
  fallback: T,
): T {
  const wanted = String(value ?? "").toLowerCase();
  return options.find((option) => option.toLowerCase() === wanted) ?? fallback;
}

export const WRITE_TOOLS = new Set(["write_file"]);

const MAX_TOOL_RESULT = 60_000;

export function toolsFor(
  workspace: string | null,
  mode: "plan" | "build",
  hasSkills: boolean,
  disabledTools: ReadonlySet<string> = new Set(),
): ToolDef[] {
  const tools: ToolDef[] = [];
  if (hasSkills) tools.push(USE_SKILL_TOOL);
  tools.push(...DOC_READ_TOOLS, ...TICKET_READ_TOOLS);
  if (mode === "plan") {
    return tools.filter((tool) => !disabledTools.has(tool.name));
  }
  tools.push(...DOC_WRITE_TOOLS, ...TICKET_WRITE_TOOLS);
  if (workspace) tools.push(...TOOL_DEFS);
  return tools.filter((tool) => !disabledTools.has(tool.name));
}

export async function applyWriteFile(workspace: string, call: ToolCall): Promise<string> {
  const args = safeParse(call.arguments);
  const path = typeof args.path === "string" ? args.path : "";
  const content = String(args.content ?? "");
  if (!path) return "Error: path wajib diisi.";
  await writeWorkspaceFile(workspace, path, content);
  return `Wrote ${path} (${content.length} chars).`;
}

export async function executeTool(run: Run, call: ToolCall): Promise<string> {
  const args = safeParse(call.arguments);
  if (call.name === "use_skill") {
    const name = String(args.name ?? "").trim().toLowerCase();
    const skill = run.skills.get(name);
    if (!skill) {
      const available = [...run.skills.keys()].join(", ") || "(tidak ada)";
      return `Skill "${name}" tidak ditemukan. Tersedia: ${available}`;
    }
    try {
      const body = await readSkillBody(skill);
      return `Skill: ${skill.name} (${skill.source})\n\n${body}`;
    } catch (error) {
      return `Gagal memuat skill "${skill.name}": ${(error as Error).message}`;
    }
  }

  if (call.name === "list_documents") return await listDocumentsTool(run.projectId, args);
  if (call.name === "get_document") return await getDocumentTool(run.projectId, args);
  if (call.name === "create_document") return await createDocumentTool(run.projectId, args);
  if (call.name === "update_document") return await updateDocumentTool(run.projectId, args);
  if (call.name === "sync_document") return await syncDocumentTool(run.projectId, args);

  if (call.name === "list_tickets") return await listTicketsTool(run.projectId);
  if (call.name === "get_ticket") return await getTicketTool(run.projectId, args);
  if (call.name === "update_ticket") return await updateTicketTool(run.projectId, args);
  if (call.name === "delete_ticket") return await deleteTicketTool(run.projectId, args);
  if (call.name === "sync_ticket") return await syncTicketTool(run.projectId, args);
  if (call.name === "transition_ticket") return await transitionTicketTool(run.projectId, args);

  if (call.name === "create_ticket") {
    const parsed = LocalTicketInput.safeParse({
      title: args.title,
      description: typeof args.description === "string" ? args.description : undefined,
      status: pickTicketValue(TICKET_STATUSES, args.status, "Backlog"),
      priority: args.priority == null || args.priority === ""
        ? undefined
        : pickTicketValue(TICKET_PRIORITIES, args.priority, "Medium"),
      type: pickTicketValue(TICKET_TYPES, args.type, "Task"),
    });
    if (!parsed.success) {
      return `Error: ticket tidak valid (${parsed.error.issues[0]?.message ?? "invalid"}).`;
    }
    const ticket = await createLocalTicket(run.projectId, parsed.data);
    const key = `LOCAL-${ticket.id.slice(0, 6).toUpperCase()}`;
    run.createdTickets.push({ id: ticket.id, key, title: ticket.title });
    return `Created local ticket ${key}: "${ticket.title}" (status ${ticket.status}). ` +
      "It is stored locally and NOT synced to Jira yet.";
  }

  const workspace = run.workspace;
  if (!workspace) return "No workspace configured.";
  const path = typeof args.path === "string" ? args.path : "";
  if (call.name === "list_files") {
    const listing = await listDirectory(workspace, path);
    return JSON.stringify(listing.entries).slice(0, MAX_TOOL_RESULT);
  }
  if (call.name === "read_file") {
    const file = await readWorkspaceFile(workspace, path);
    if (file.binary) return "(binary file, not shown)";
    return file.content.slice(0, MAX_TOOL_RESULT);
  }
  return `Unknown tool: ${call.name}`;
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const MAX_WORKSPACE_IMAGE_BYTES = 4_000_000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export async function resolveAttachments(
  workspace: string | null,
  attachments: ChatAttachment[] | undefined,
): Promise<ChatAttachment[]> {
  if (!attachments?.length) return [];
  const result: ChatAttachment[] = [];
  for (const item of attachments) {
    if (item.type !== "workspace") {
      result.push(item);
      continue;
    }
    const path = item.path ?? "";
    if (!workspace) {
      result.push({
        type: "text",
        name: item.name,
        data: `(file ${path} tidak dapat dibaca: workspace belum diatur)`,
      });
      continue;
    }
    const extension = path.split(".").pop()?.toLowerCase() ?? "";
    const mime = IMAGE_MIME[extension];
    try {
      if (mime) {
        const raw = await readWorkspaceFileRaw(workspace, path);
        if (raw.size > MAX_WORKSPACE_IMAGE_BYTES) {
          result.push({
            type: "text",
            name: item.name,
            data: `(gambar ${path} terlalu besar untuk dilampirkan)`,
          });
          continue;
        }
        result.push({
          type: "image",
          name: item.name,
          mime,
          data: `data:${mime};base64,${toBase64(raw.bytes)}`,
        });
        continue;
      }
      const file = await readWorkspaceFile(workspace, path);
      if (file.binary) {
        result.push({
          type: "text",
          name: item.name,
          data: `(file biner ${path} tidak dapat ditampilkan)`,
        });
        continue;
      }
      result.push({
        type: "text",
        name: item.name,
        data: `${file.content}${file.truncated ? "\n… (dipotong)" : ""}`,
      });
    } catch (error) {
      result.push({
        type: "text",
        name: item.name,
        data: `(gagal membaca ${path}: ${(error as Error).message})`,
      });
    }
  }
  return result;
}
