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
}

export interface LlmProvider {
  id: string;
  name: string;
  provider: string;
  model: string | null;
  baseUrl: string | null;
  apiKey: string | null;
  mode: string;
  updatedAt: string;
}

export interface ProjectDetail {
  project: Project;
  integrations: Integration[];
  llmProviders: LlmProvider[];
}

export interface TestResult {
  ok: boolean;
  status?: number;
  message: string;
  detail?: unknown;
  latencyMs: number;
}

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
  priority?: string;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const error = (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new Error(error);
  }
  return data as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
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
  projectDetail: (id: string) => request<ProjectDetail>(`/api/projects/${id}`),
  listDocuments: (projectId: string, pageId?: string) =>
    request<DocumentsResponse>(
      `/api/projects/${projectId}/documents${pageId ? `?pageId=${encodeURIComponent(pageId)}` : ""}`,
    ),
  getDocument: (projectId: string, pageId: string) =>
    request<{ document: DocContent }>(`/api/projects/${projectId}/documents/${pageId}`),
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
  testIntegration: (payload: IntegrationPayload) =>
    request<{ result: TestResult }>("/api/integrations/test", jsonInit("POST", payload)),
  createLlm: (projectId: string, payload: LlmProviderPayload) =>
    request<{ provider: LlmProvider }>(`/api/projects/${projectId}/llm`, jsonInit("POST", payload)),
  updateLlm: (projectId: string, id: string, payload: LlmProviderPayload) =>
    request<{ provider: LlmProvider }>(
      `/api/projects/${projectId}/llm/${id}`,
      jsonInit("PUT", payload),
    ),
  deleteLlm: (projectId: string, id: string) =>
    request<{ ok: boolean }>(`/api/projects/${projectId}/llm/${id}`, { method: "DELETE" }),
  chat: (
    projectId: string,
    payload: {
      providerId?: string;
      sessionId?: string;
      variant?: string;
      mode?: ChatMode;
      messages: { role: string; content: string; attachments?: ChatAttachment[] }[];
    },
  ) => request<ChatResponse>(`/api/projects/${projectId}/chat`, jsonInit("POST", payload)),
  chatApprove: (payload: { runId: string; id: string; action: "once" | "always" | "deny" }) =>
    request<ChatResponse>("/api/chat/approve", jsonInit("POST", payload)),
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
  getMcpSettings: () => request<{ servers: McpServer[] }>("/api/settings/mcp"),
  saveMcpSettings: (servers: McpServer[]) =>
    request<{ servers: McpServer[] }>("/api/settings/mcp", jsonInit("PUT", { servers })),
};
