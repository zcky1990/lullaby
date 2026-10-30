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
  models?: CursorModel[];
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

export interface GitRemoteBranch {
  name: string;
  remote: string;
  shortName: string;
}

export interface GitStash {
  index: number;
  label: string;
  message: string;
}

export interface GitCommit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  date: string;
  refs: string;
}

export interface GitCommitDetail extends GitCommit {
  body: string;
  diff: string;
}

export type WorkflowRunStatus =
  | "running"
  | "success"
  | "failed"
  | "canceled"
  | "interrupted";

export type WorkflowStepStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped"
  | "canceled";

export interface WorkflowRunSummary {
  id: string;
  workflowSlug: string;
  workflowName: string;
  status: WorkflowRunStatus;
  trigger: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

export interface WorkflowRunStep {
  id: string;
  stepId: string;
  status: WorkflowStepStatus;
  command: string;
  exitCode?: number;
  log: string;
  startedAt?: string;
  finishedAt?: string;
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
  lastRun?: WorkflowRunSummary;
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

export interface WorkflowDefinitionStep {
  id: string;
  kind: "shell" | "llm" | "agent";
  run?: string;
  action?: string;
  with?: WorkflowLlmWith;
  output?: string;
  depends: string[];
  env: Record<string, string>;
  workingDir?: string;
  retry: { limit: number; intervalSec: number };
  timeoutSec?: number;
  continueOn?: string;
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  env: Record<string, string>;
  workingDir?: string;
  llm?: {
    provider?: string;
    model?: string;
    role?: string;
    session?: string;
    system?: string;
    temperature?: number;
  };
  steps: WorkflowDefinitionStep[];
  layers: string[][];
}

export interface PromptsSettings {
  systemPrompt: string;
  planPrompt: string;
  defaultSystemPrompt: string;
  defaultPlanPrompt: string;
  customized: { systemPrompt: boolean; planPrompt: boolean };
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

export interface ChatToolCatalogEntry {
  name: string;
  description: string;
  requiresApproval: boolean;
}

export interface ChatToolsSettingsResponse {
  autoApproveWrites: boolean;
  disabledTools: string[];
  tools: ChatToolCatalogEntry[];
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  source: "global" | "workspace" | "project" | "builtin";
  path: string;
  enabled: boolean;
}

export interface SkillsResponse {
  enabled: boolean;
  disabled: string[];
  globalPath: string;
  builtinPath: string;
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
export type TerminalShell = "zsh" | "bash";

export type LspMode = "local" | "npx";

export interface LspServer {
  id?: string;
  name: string;
  languages: string[];
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  mode: LspMode;
  initializationOptions?: Record<string, unknown>;
}

export interface LspSettings {
  enabled: boolean;
  servers: LspServer[];
}

export interface LspPresetVariant {
  label: string;
  mode: LspMode;
  command: string;
  args: string[];
}

export interface LspPreset {
  id: string;
  name: string;
  languages: string[];
  note?: string;
  variants: LspPresetVariant[];
}

export interface UiPreferences {
  theme?: "light" | "dark" | "system";
  colorTheme?: "vscode" | "shadcn" | "claude" | "supabase";
  appFont?: "system" | "inter" | "manrope" | "jetbrains";
  editorTheme?: "auto" | "vs" | "vs-dark" | "hc-black" | "hc-light";
  editorFont?: "jetbrains" | "fira" | "menlo" | "consolas" | "monospace";
  editorFontSize?: number;
  chatFont?: "system" | "inter" | "manrope" | "jetbrains";
  chatFontSize?: number;
  iconSize?: "sm" | "md" | "lg";
  iconWeight?: "light" | "regular" | "bold";
}

export interface LspProbeResult {
  found: boolean;
  path?: string;
  command: string;
}

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

export interface WorkspaceFileIndexResponse {
  files: string[];
  truncated: boolean;
  error?: string;
}

export interface WorkspaceFindMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface WorkspaceFindResponse {
  matches: WorkspaceFindMatch[];
  scanned: number;
  truncated: boolean;
  error?: string;
}

export interface IntegrationPayload {
  kind: string;
  mode: string;
  config: Record<string, string>;
}

export interface CursorModel {
  id: string;
  name: string;
  description?: string;
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
  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
  listFiles: (projectId: string, path: string) =>
    request<FilesResponse>(`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`),
  listFileIndex: (projectId: string) =>
    request<WorkspaceFileIndexResponse>(`/api/projects/${projectId}/files/index`),
  findInFiles: (
    projectId: string,
    query: string,
    options: { caseSensitive?: boolean; regex?: boolean } = {},
  ) =>
    request<WorkspaceFindResponse>(
      `/api/projects/${projectId}/files/find?q=${encodeURIComponent(query)}&case=${
        options.caseSensitive ? "1" : "0"
      }&regex=${options.regex ? "1" : "0"}`,
    ),
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
  listCursorModels: (payload: { apiKey?: string; providerId?: string }) =>
    request<{ models: CursorModel[] }>("/api/llm/cursor/models", jsonInit("POST", payload)),
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
      model?: string;
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
  listWorkflows: (projectId: string) =>
    request<{ root: string; source: "workspace" | "app"; workflows: WorkflowSummary[] }>(
      `/api/projects/${projectId}/workflows`,
    ),
  getWorkflow: (projectId: string, slug: string) =>
    request<{ workflow: WorkflowSummary; yaml: string; definition: WorkflowDefinition }>(
      `/api/projects/${projectId}/workflows/${encodeURIComponent(slug)}`,
    ),
  createWorkflow: (projectId: string, payload: { name: string; yaml?: string }) =>
    request<{ workflow: WorkflowSummary }>(
      `/api/projects/${projectId}/workflows`,
      jsonInit("POST", payload),
    ),
  saveWorkflow: (projectId: string, slug: string, yaml: string) =>
    request<{ workflow: WorkflowSummary }>(
      `/api/projects/${projectId}/workflows/${encodeURIComponent(slug)}`,
      jsonInit("PUT", { yaml }),
    ),
  deleteWorkflow: (projectId: string, slug: string) =>
    request<{ ok: boolean }>(
      `/api/projects/${projectId}/workflows/${encodeURIComponent(slug)}`,
      { method: "DELETE" },
    ),
  runWorkflow: (projectId: string, slug: string) =>
    request<{ runId: string }>(
      `/api/projects/${projectId}/workflows/${encodeURIComponent(slug)}/run`,
      { method: "POST" },
    ),
  listWorkflowRuns: (projectId: string, options?: { workflow?: string; limit?: number }) =>
    request<{ runs: WorkflowRunSummary[] }>(
      `/api/projects/${projectId}/workflow-runs?${
        new URLSearchParams({
          ...(options?.workflow ? { workflow: options.workflow } : {}),
          limit: String(options?.limit ?? 50),
        }).toString()
      }`,
    ),
  getWorkflowRun: (projectId: string, runId: string) =>
    request<{ run: WorkflowRunSummary; steps: WorkflowRunStep[] }>(
      `/api/projects/${projectId}/workflow-runs/${encodeURIComponent(runId)}`,
    ),
  cancelWorkflowRun: (projectId: string, runId: string) =>
    request<{ ok: boolean }>(
      `/api/projects/${projectId}/workflow-runs/${encodeURIComponent(runId)}/cancel`,
      { method: "POST" },
    ),
  gitStatus: (projectId: string) =>
    request<{ status: GitStatus }>(`/api/projects/${projectId}/git/status`),
  gitBranches: (projectId: string) =>
    request<{
      branches: GitBranch[];
      remotes: GitRemoteBranch[];
      stashes: GitStash[];
    }>(`/api/projects/${projectId}/git/branches`),
  gitStashApply: (projectId: string, payload: { index: number; pop?: boolean }) =>
    request<{ ok: boolean }>(
      `/api/projects/${projectId}/git/stash/apply`,
      jsonInit("POST", payload),
    ),
  gitLog: (projectId: string, limit = 50) =>
    request<{ commits: GitCommit[] }>(`/api/projects/${projectId}/git/log?limit=${limit}`),
  gitDiff: (projectId: string, path: string, staged: boolean) =>
    request<{ diff: string }>(
      `/api/projects/${projectId}/git/diff?path=${encodeURIComponent(path)}&staged=${staged ? "1" : "0"}`,
    ),
  gitShow: (projectId: string, hash: string) =>
    request<{ commit: GitCommitDetail }>(
      `/api/projects/${projectId}/git/show?hash=${encodeURIComponent(hash)}`,
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
  gitClone: (
    projectId: string,
    payload: { url: string; protocol?: "https" | "ssh" },
  ) =>
    request<{ ok: boolean; path: string; output: string; project: Project }>(
      `/api/projects/${projectId}/git/clone`,
      jsonInit("POST", payload, { timeoutMs: 320_000 }),
    ),
  gitFetch: (projectId: string) =>
    request<{ ok: boolean; output: string }>(
      `/api/projects/${projectId}/git/fetch`,
      jsonInit("POST", {}, { timeoutMs: 180_000 }),
    ),
  gitPull: (projectId: string) =>
    request<{ ok: boolean; output: string }>(
      `/api/projects/${projectId}/git/pull`,
      jsonInit("POST", {}, { timeoutMs: 180_000 }),
    ),
  gitPush: (projectId: string) =>
    request<{ ok: boolean; output: string }>(
      `/api/projects/${projectId}/git/push`,
      jsonInit("POST", {}, { timeoutMs: 180_000 }),
    ),
  gitCreateBranch: (projectId: string, payload: { name: string; checkout?: boolean }) =>
    request<{ ok: boolean }>(
      `/api/projects/${projectId}/git/branch`,
      jsonInit("POST", payload),
    ),
  gitMerge: (projectId: string, branch: string) =>
    request<{ ok: boolean; output: string }>(
      `/api/projects/${projectId}/git/merge`,
      jsonInit("POST", { branch }),
    ),
  gitStashCreate: (
    projectId: string,
    payload: { message?: string; includeUntracked?: boolean } = {},
  ) =>
    request<{ ok: boolean; output: string }>(
      `/api/projects/${projectId}/git/stash`,
      jsonInit("POST", payload),
    ),
  getPrompts: () => request<PromptsSettings>("/api/settings/prompts"),
  savePrompts: (payload: { systemPrompt: string; planPrompt: string }) =>
    request<{ ok: boolean }>("/api/settings/prompts", jsonInit("PUT", payload)),
  getMcpSettings: () => request<McpSettingsResponse>("/api/settings/mcp"),
  saveMcpSettings: (payload: {
    servers: McpServer[];
    enabled: boolean;
    disabledTools: string[];
  }) =>
    request<McpSettingsResponse>("/api/settings/mcp", jsonInit("PUT", payload)),
  listMcpTools: (server: McpServer) =>
    request<{ tools: McpTool[] }>("/api/settings/mcp/tools", jsonInit("POST", { server })),
  getChatToolsSettings: () =>
    request<ChatToolsSettingsResponse>("/api/settings/chat-tools"),
  saveChatToolsSettings: (payload: {
    autoApproveWrites: boolean;
    disabledTools: string[];
  }) =>
    request<ChatToolsSettingsResponse>(
      "/api/settings/chat-tools",
      jsonInit("PUT", payload),
    ),
  getAutomationSettings: () =>
    request<{ autoBuildOnInProgress: boolean }>("/api/settings/automation"),
  saveAutomationSettings: (payload: { autoBuildOnInProgress: boolean }) =>
    request<{ autoBuildOnInProgress: boolean }>(
      "/api/settings/automation",
      jsonInit("PUT", payload),
    ),
  getTerminalSettings: () =>
    request<{ shell: TerminalShell }>("/api/settings/terminal"),
  saveTerminalSettings: (payload: { shell: TerminalShell }) =>
    request<{ shell: TerminalShell }>("/api/settings/terminal", jsonInit("PUT", payload)),
  getUiPreferences: () =>
    request<{ preferences: UiPreferences }>("/api/settings/ui"),
  saveUiPreferences: (preferences: UiPreferences) =>
    request<{ preferences: UiPreferences }>("/api/settings/ui", jsonInit("PUT", preferences)),
  getLspSettings: () =>
    request<{ settings: LspSettings; presets: LspPreset[] }>("/api/settings/lsp"),
  saveLspSettings: (payload: LspSettings) =>
    request<{ settings: LspSettings }>("/api/settings/lsp", jsonInit("PUT", payload)),
  probeLspServer: (command: string) =>
    request<LspProbeResult>("/api/settings/lsp/probe", jsonInit("POST", { command })),
  runAutoskills: (projectId: string, payload: { dryRun?: boolean } = {}) =>
    request<{
      ok: boolean;
      dryRun: boolean;
      output: string;
      skills: Array<{
        id: string;
        name: string;
        description: string;
        source: string;
        path: string;
      }>;
      error?: string;
      code?: number;
    }>(`/api/projects/${projectId}/autoskills`, jsonInit("POST", payload, { timeoutMs: 320_000 })),
};
