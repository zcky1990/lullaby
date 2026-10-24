import { ApiError } from "@/lib/api-error";

export { ApiError };

export interface Project {
  id: string;
  name: string;
  workspace_path: string | null;
  document_path: string | null;
  docmost_space_id: string | null;
  jira_project_key: string | null;
  github_repo: string | null;
  created_at: string;
  updated_at: string;
}

export interface Integration {
  kind: string;
  mode: string;
  config: Record<string, unknown>;
  updatedAt: string;
  hasSecrets?: boolean;
}

export interface LlmProvider {
  id: string;
  name: string;
  provider: string;
  model: string | null;
  baseUrl: string | null;
  apiKey: string | null;
  hasApiKey?: boolean;
  mode: string;
  updatedAt: string;
}

export const SECRET_MASK = "••••••••";

export interface ProjectDetail {
  project: Project;
  integrations: Integration[];
}

export interface TestResult {
  ok: boolean;
  status?: number;
  message: string;
  detail?: unknown;
  latencyMs: number;
}

export type DocumentSource = "docmost" | "notion" | "confluence";

export interface DocSummary {
  id: string;
  title: string;
  spaceId?: string;
  hasChildren?: boolean;
  children?: DocSummary[];
}

export interface DocContent {
  id: string;
  title?: string;
  content: string;
}

export interface McpServer {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  enabled: boolean;
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  persona: string;
  providerId?: string;
  updatedAt: string;
}

export interface GitFile {
  path: string;
  status: string;
  staged: boolean;
  untracked: boolean;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFile[];
  unstaged: GitFile[];
  untracked: GitFile[];
  clean: boolean;
}

export interface GitBranch {
  name: string;
  current: boolean;
}

export interface GitCommit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  date: string;
  refs: string;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpSettingsResponse {
  servers: McpServer[];
  enabled: boolean;
  disabledTools: string[];
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  source: "global" | "workspace" | "project";
  path: string;
  enabled: boolean;
}

export interface SkillsResponse {
  enabled: boolean;
  disabled: string[];
  globalPath: string;
  workspacePath: string | null;
  projectPath: string | null;
  skills: SkillInfo[];
}

export interface LocalDocSummary {
  id: string;
  path: string;
  title: string;
  syncStatus: "local" | "synced" | "error";
  pageId?: string;
  syncError?: string;
}

export interface LocalDocContent extends LocalDocSummary {
  content: string;
}

export interface LocalDocumentsResponse {
  configured: boolean;
  path?: string;
  error?: string;
  documents: LocalDocSummary[];
}

export interface TicketSummary {
  key: string;
  summary: string;
  description?: string;
  status?: string;
  assignee?: string;
  priority?: string;
  url: string;
  source?: "local" | "jira";
  localId?: string;
  syncStatus?: "local" | "synced" | "error";
  syncError?: string;
}

export interface TicketDetail {
  key: string;
  summary: string;
  status?: string;
  priority?: string;
  assignee?: string;
  reporter?: string;
  type?: string;
  created?: string;
  updated?: string;
  labels: string[];
  description: string;
  url: string;
  source?: "local" | "jira";
  localId?: string;
  syncStatus?: "local" | "synced" | "error";
  syncError?: string;
}

export interface LocalTicketPayload {
  title: string;
  description?: string;
  status?: string;
  priority?: string | null;
  type?: string;
  assignee?: string;
  labels?: string[];
}

export type ChatMode = "plan" | "build";

export interface ChatPending {
  id: string;
  tool: string;
  summary: string;
}

export interface ChatAttachment {
  type: "image" | "text" | "workspace";
  name: string;
  mime?: string;
  path?: string;
  data?: string;
}

export interface FileChange {
  path: string;
  action: "create" | "update";
  diff: string;
  added: number;
  removed: number;
}

export interface DiffHunkLine {
  type: " " | "+" | "-";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface PendingHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffHunkLine[];
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

export interface CreatedTicket {
  id: string;
  key: string;
  title: string;
}

export type ChatResponse =
  | {
    status: "done";
    message: string;
    sessionId: string;
    changes: FileChange[];
    createdTickets: CreatedTicket[];
  }
  | {
    status: "approval_required";
    runId: string;
    pending: ChatPending[];
    pendingChanges: PendingFileChange[];
    sessionId: string;
    changes: FileChange[];
    createdTickets: CreatedTicket[];
  }
  | { status: "error"; error: string; sessionId?: string };

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ChatSessionDetail {
  session: ChatSession;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    changes?: FileChange[];
  }>;
}

export interface DocumentsResponse {
  configured: boolean;
  source?: DocumentSource;
  error?: string;
  documents: DocSummary[];
  debug?: string;
}

export interface TicketsResponse {
  configured: boolean;
  error?: string;
  tickets: TicketSummary[];
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

export interface FilesResponse {
  configured: boolean;
  path: string;
  entries: FileEntry[];
  truncated?: boolean;
  error?: string;
}

export interface FileContentResponse {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
  binary: boolean;
}

export interface IntegrationPayload {
  kind: string;
  mode: string;
  config: Record<string, string>;
}

export interface LlmProviderPayload {
  name: string;
  provider: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  mode: string;
}

export type RequestOptions = RequestInit & {
  timeoutMs?: number;
};

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  init?.signal?.addEventListener("abort", onAbort);
  try {
    const { timeoutMs: _timeout, signal: _signal, ...rest } = init ?? {};
    const res = await fetch(path, { ...rest, signal: controller.signal });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const error = (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
      throw new ApiError(res.status, error, data);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as Error).name === "AbortError") {
      throw new ApiError(408, "Request timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", onAbort);
  }
}

const jsonInit = (method: string, body: unknown, options?: { timeoutMs?: number }): RequestOptions => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
  ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
});

export const api = {
  health: () =>
    request<{ ok: boolean; name: string; version: string; dataDir: string }>("/api/health"),
  listProjects: () => request<{ projects: Project[] }>("/api/projects"),
  createProject: (input: { name: string; workspacePath?: string }) =>
    request<{ project: Project }>("/api/projects", jsonInit("POST", input)),
  updateProject: (
    id: string,
    input: { name?: string; workspacePath?: string; documentPath?: string },
  ) =>
    request<{ project: Project }>(`/api/projects/${id}`, jsonInit("PUT", input)),
  listFiles: (projectId: string, path: string) =>
    request<FilesResponse>(`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`),
  readFile: (projectId: string, path: string) =>
    request<FileContentResponse>(
      `/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
    ),
  writeFile: (projectId: string, path: string, content: string) =>
    request<{ ok: boolean; path: string; size: number }>(
      `/api/projects/${projectId}/files/content`,
      jsonInit("PUT", { path, content }),
    ),
  projectDetail: (id: string) => request<ProjectDetail>(`/api/projects/${id}`),
  listDocuments: (projectId: string, pageId?: string, source: DocumentSource = "docmost") => {
    const params = new URLSearchParams({ source });
    if (pageId) params.set("pageId", pageId);
    return request<DocumentsResponse>(`/api/projects/${projectId}/documents?${params}`);
  },
  getDocument: (projectId: string, pageId: string, source: DocumentSource = "docmost") =>
    request<{ document: DocContent; source?: DocumentSource }>(
      `/api/projects/${projectId}/documents/${encodeURIComponent(pageId)}?source=${source}`,
    ),
  createDocument: (projectId: string, payload: { title: string; parentPageId?: string }) =>
    request<{ document: DocSummary }>(
      `/api/projects/${projectId}/documents`,
      jsonInit("POST", payload),
    ),
  updateDocument: (
    projectId: string,
    pageId: string,
    payload: { title?: string; content: string },
  ) =>
    request<{ document: DocContent }>(
      `/api/projects/${projectId}/documents/${encodeURIComponent(pageId)}`,
      jsonInit("PUT", payload),
    ),
  listLocalDocuments: (projectId: string) =>
    request<LocalDocumentsResponse>(`/api/projects/${projectId}/local-documents`),
  getLocalDocument: (projectId: string, path: string) =>
    request<{ document: LocalDocContent }>(
      `/api/projects/${projectId}/local-documents/content?path=${encodeURIComponent(path)}`,
    ),
  createLocalDocument: (projectId: string, payload: { title: string }) =>
    request<{ document: LocalDocContent }>(
      `/api/projects/${projectId}/local-documents`,
      jsonInit("POST", payload),
    ),
  updateLocalDocument: (
    projectId: string,
    payload: { path: string; title?: string; content?: string },
  ) =>
    request<{ document: LocalDocContent }>(
      `/api/projects/${projectId}/local-documents`,
      jsonInit("PUT", payload),
    ),
  syncLocalDocument: (projectId: string, path: string) =>
    request<{ document: LocalDocContent }>(
      `/api/projects/${projectId}/local-documents/sync`,
      jsonInit("POST", { path }),
    ),
  listTickets: (projectId: string) =>
    request<TicketsResponse>(`/api/projects/${projectId}/tickets`),
  generateTickets: (
    projectId: string,
    payload: { title: string; content: string; providerId?: string; variant?: string },
  ) =>
    request<{ tickets: CreatedTicket[]; message: string }>(
      `/api/projects/${projectId}/generate-tickets`,
      jsonInit("POST", payload),
    ),
  getTicket: (projectId: string, key: string) =>
    request<{ ticket: TicketDetail }>(
      `/api/projects/${projectId}/tickets/${encodeURIComponent(key)}`,
    ),
  transitionTicket: (projectId: string, key: string, status: string) =>
    request<{ ok: boolean }>(
      `/api/projects/${projectId}/tickets/${encodeURIComponent(key)}/transition`,
      jsonInit("POST", { status }),
    ),
  createLocalTicket: (projectId: string, payload: LocalTicketPayload) =>
    request<{ ticket: TicketDetail }>(
      `/api/projects/${projectId}/local-tickets`,
      jsonInit("POST", payload),
    ),
  getLocalTicket: (projectId: string, id: string) =>
    request<{ ticket: TicketDetail }>(
      `/api/projects/${projectId}/local-tickets/${encodeURIComponent(id)}`,
    ),
  updateLocalTicket: (projectId: string, id: string, payload: Partial<LocalTicketPayload>) =>
    request<{ ticket: TicketDetail }>(
      `/api/projects/${projectId}/local-tickets/${encodeURIComponent(id)}`,
      jsonInit("PATCH", payload),
    ),
  deleteLocalTicket: (projectId: string, id: string) =>
    request<{ ok: boolean }>(
      `/api/projects/${projectId}/local-tickets/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  syncLocalTicket: (projectId: string, id: string) =>
    request<{ ticket: TicketDetail }>(
      `/api/projects/${projectId}/local-tickets/${encodeURIComponent(id)}/sync`,
      { method: "POST" },
    ),
  saveIntegration: (projectId: string, payload: IntegrationPayload) =>
    request<{ integration: Integration }>(
      `/api/projects/${projectId}/integrations/${payload.kind}`,
      jsonInit("PUT", payload),
    ),
  testIntegration: (payload: IntegrationPayload, projectId?: string) =>
    request<{ result: TestResult }>(
      "/api/integrations/test",
      jsonInit("POST", projectId ? { ...payload, projectId } : payload),
    ),
  listRoles: () => request<{ roles: Role[] }>("/api/roles"),
  createRole: (payload: { name: string; description?: string; persona: string; providerId?: string }) =>
    request<{ role: Role }>("/api/roles", jsonInit("POST", payload)),
  updateRole: (
    id: string,
    payload: { name: string; description?: string; persona: string; providerId?: string },
  ) => request<{ role: Role }>(`/api/roles/${id}`, jsonInit("PUT", payload)),
  deleteRole: (id: string) => request<{ ok: boolean }>(`/api/roles/${id}`, { method: "DELETE" }),
  listLlm: () => request<{ providers: LlmProvider[] }>("/api/llm"),
  createLlm: (payload: LlmProviderPayload) =>
    request<{ provider: LlmProvider }>("/api/llm", jsonInit("POST", payload)),
  updateLlm: (id: string, payload: LlmProviderPayload) =>
    request<{ provider: LlmProvider }>(`/api/llm/${id}`, jsonInit("PUT", payload)),
  deleteLlm: (id: string) =>
    request<{ ok: boolean }>(`/api/llm/${id}`, { method: "DELETE" }),
  chat: (
    projectId: string,
    payload: {
      providerId?: string;
      sessionId?: string;
      roleId?: string;
      skillName?: string;
      variant?: string;
      mode?: ChatMode;
      messages: { role: string; content: string; attachments?: ChatAttachment[] }[];
    },
  ) =>
    request<ChatResponse>(
      `/api/projects/${projectId}/chat`,
      jsonInit("POST", payload, { timeoutMs: 180_000 }),
    ),
  chatChange: (payload: { runId: string; callId: string; hunk: number; accept: boolean }) =>
    request<ChatResponse>("/api/chat/change", jsonInit("POST", payload, { timeoutMs: 180_000 })),
  chatChangeAll: (payload: { runId: string; accept: boolean }) =>
    request<ChatResponse>(
      "/api/chat/change-all",
      jsonInit("POST", payload, { timeoutMs: 180_000 }),
    ),
  listChatSessions: (projectId: string) =>
    request<{ sessions: ChatSession[] }>(`/api/projects/${projectId}/chat/sessions`),
  getChatSession: (projectId: string, sessionId: string) =>
    request<ChatSessionDetail>(
      `/api/projects/${projectId}/chat/sessions/${encodeURIComponent(sessionId)}`,
    ),
  deleteChatSession: (projectId: string, sessionId: string) =>
    request<{ ok: boolean }>(
      `/api/projects/${projectId}/chat/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    ),
  testRaw: (body: IntegrationPayload) =>
    request<{ result: TestResult }>("/api/integrations/test", jsonInit("POST", body)),
  getSkills: (projectId?: string) =>
    request<SkillsResponse>(
      `/api/skills${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
    ),
  saveSkillsSettings: (payload: { enabled: boolean; disabled: string[] }) =>
    request<{ ok: boolean }>("/api/settings/skills", jsonInit("PUT", payload)),
  gitStatus: (projectId: string) =>
    request<{ status: GitStatus }>(`/api/projects/${projectId}/git/status`),
  gitBranches: (projectId: string) =>
    request<{ branches: GitBranch[] }>(`/api/projects/${projectId}/git/branches`),
  gitLog: (projectId: string, limit = 50) =>
    request<{ commits: GitCommit[] }>(`/api/projects/${projectId}/git/log?limit=${limit}`),
  gitDiff: (projectId: string, path: string, staged: boolean) =>
    request<{ diff: string }>(
      `/api/projects/${projectId}/git/diff?path=${encodeURIComponent(path)}&staged=${staged ? "1" : "0"}`,
    ),
  gitStage: (projectId: string, paths: string[]) =>
    request<{ ok: boolean }>(
      `/api/projects/${projectId}/git/stage`,
      jsonInit("POST", { paths }),
    ),
  gitUnstage: (projectId: string, paths: string[]) =>
    request<{ ok: boolean }>(
      `/api/projects/${projectId}/git/unstage`,
      jsonInit("POST", { paths }),
    ),
  gitCommit: (projectId: string, message: string) =>
    request<{ ok: boolean; output: string }>(
      `/api/projects/${projectId}/git/commit`,
      jsonInit("POST", { message }),
    ),
  gitCheckout: (projectId: string, branch: string) =>
    request<{ ok: boolean }>(
      `/api/projects/${projectId}/git/checkout`,
      jsonInit("POST", { branch }),
    ),
  getMcpSettings: () => request<McpSettingsResponse>("/api/settings/mcp"),
  saveMcpSettings: (payload: {
    servers: McpServer[];
    enabled: boolean;
    disabledTools: string[];
  }) =>
    request<McpSettingsResponse>("/api/settings/mcp", jsonInit("PUT", payload)),
  listMcpTools: (server: McpServer) =>
    request<{ tools: McpTool[] }>("/api/settings/mcp/tools", jsonInit("POST", { server })),
  getAutomationSettings: () =>
    request<{ autoBuildOnInProgress: boolean }>("/api/settings/automation"),
  saveAutomationSettings: (payload: { autoBuildOnInProgress: boolean }) =>
    request<{ autoBuildOnInProgress: boolean }>(
      "/api/settings/automation",
      jsonInit("PUT", payload),
    ),
};
