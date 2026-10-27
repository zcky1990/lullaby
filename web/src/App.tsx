import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from "react";
import {
  Code2,
  Eye,
  Inbox,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Upload,
} from "lucide-react";
import type { ActivityEvent } from "@/components/ActivityFeed";
import { ActivityBar, type Menu } from "@/components/ActivityBar";
import { ChatSidebar } from "@/components/ChatSidebar";
import { DocumentPanel, type PanelDocSource } from "@/components/DocumentPanel";
import {
  Empty as EmptyState,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { FileTreePanel } from "@/components/FileTreePanel";
import { GitPanel } from "@/components/GitPanel";
import { GitTab } from "@/components/GitTab";
import { GlobalSettingsPanel, type GlobalSection } from "@/components/GlobalSettingsPanel";
import { GlobalSettingsView } from "@/components/GlobalSettingsView";
import { SettingsPanel, type SettingsSection } from "@/components/SettingsPanel";
import { SettingsView } from "@/components/SettingsView";
import { ReviewTab } from "@/components/ReviewTab";
import { StatusBar } from "@/components/StatusBar";
import { TerminalPanel } from "@/components/TerminalPanel";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { type EditorTab, type TabKind, TabsBar } from "@/components/TabsBar";
import { PANEL_FOR_KIND, useEditorTabs } from "@/hooks/useEditorTabs";
import { TicketCreateDialog } from "@/components/TicketCreateDialog";
import { TicketPanel } from "@/components/TicketPanel";
import { TicketDetailDialog } from "@/components/TicketDetailDialog";
import { TicketKanban } from "@/components/TicketKanban";
import { useTheme } from "@/components/ThemeProvider";
import { WorkflowPanel } from "@/components/WorkflowPanel";
import { WorkspacePanel } from "@/components/WorkspacePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { triggerFind } from "@/lib/find";
import { dispatchAutoBuild } from "@/lib/auto-build-events";
import { CHANGES_APPLIED_EVENT, REVIEW_EVENT, type ReviewDetail } from "@/lib/review-events";
import { isTodoToInProgress } from "@/lib/ticket-columns";
import { cn } from "@/lib/utils";
import {
  api,
  type DocSummary,
  type DocumentSource,
  type CreatedTicket,
  type GitBranch,
  type GitCommit,
  type GitRemoteBranch,
  type GitStash,
  type GitStatus,
  type IntegrationPayload,
  type LlmProvider,
  type LlmProviderPayload,
  type LocalDocSummary,
  type PendingFileChange,
  type Project,
  type Role,
  type ProjectDetail,
  type TestResult,
  type TicketSummary,
  type WorkflowRunSummary,
  type WorkflowSummary,
} from "@/lib/api";

const MonacoViewer = lazy(() => import("@/components/MonacoViewer"));
const MarkdownView = lazy(() => import("@/components/MarkdownView"));
const WorkflowTabComponent = lazy(() =>
  import("@/components/WorkflowTab").then((module) => ({ default: module.WorkflowTab }))
);

const ACTIVE_PROJECT_KEY = "rnd.activeProjectId:v1";
const PANEL_WIDTH_KEY = "rnd.panelWidth:v1";
const PANEL_MIN_WIDTH = 180;
const PANEL_MAX_WIDTH = 560;

function readActiveProjectId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

function readPanelWidth(): number {
  try {
    const value = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(value) && value >= PANEL_MIN_WIDTH && value <= PANEL_MAX_WIDTH) {
      return value;
    }
  } catch {
    // ignore
  }
  return 256;
}

export default function App() {
  const [menu, setMenu] = useState<Menu>("workspace");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("workspace");
  const [globalSection, setGlobalSection] = useState<GlobalSection>("appearance");
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [addingProvider, setAddingProvider] = useState(false);
  const [llmProviders, setLlmProviders] = useState<LlmProvider[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [addingRole, setAddingRole] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRunSummary[]>([]);
  const [workflowRootPath, setWorkflowRootPath] = useState<string | undefined>();
  const [workflowSource, setWorkflowSource] = useState<"workspace" | "app">("app");
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | undefined>();

  const {
    tabs,
    setTabs,
    tabsRef,
    activeTabId,
    setActiveTabId,
    focusTab,
    patchTab,
    closeTab,
    openSingleton,
  } = useEditorTabs(setMenu, currentId);

  const [docSource, setDocSource] = useState<PanelDocSource>("local");
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [docsConfigured, setDocsConfigured] = useState(true);
  const [docsError, setDocsError] = useState<string | undefined>();
  const [docsDebug, setDocsDebug] = useState<string | undefined>();
  const [docsLoading, setDocsLoading] = useState(false);

  const [localDocs, setLocalDocs] = useState<LocalDocSummary[]>([]);
  const [localDocsConfigured, setLocalDocsConfigured] = useState(false);
  const [localDocsError, setLocalDocsError] = useState<string | undefined>();
  const [localDocsLoading, setLocalDocsLoading] = useState(false);

  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [ticketsError, setTicketsError] = useState<string | undefined>();
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [detailTicket, setDetailTicket] = useState<TicketSummary | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createTicketOpen, setCreateTicketOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [autoBuildOnInProgress, setAutoBuildOnInProgress] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [gitStatusData, setGitStatusData] = useState<GitStatus | null>(null);
  const [gitBranchList, setGitBranchList] = useState<GitBranch[]>([]);
  const [gitRemoteList, setGitRemoteList] = useState<GitRemoteBranch[]>([]);
  const [gitStashList, setGitStashList] = useState<GitStash[]>([]);
  const [gitCommits, setGitCommits] = useState<GitCommit[]>([]);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitError, setGitError] = useState<string | undefined>();
  const [review, setReview] = useState<{
    runId: string;
    changes: PendingFileChange[];
  } | null>(null);
  const [panelWidth, setPanelWidth] = useState(readPanelWidth);

  const hasWorkspace = !!detail?.project.workspace_path;
  const workspaceBase =
    detail?.project.workspace_path?.split(/[\\/]/).filter(Boolean).pop() ?? null;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

  const assignees = useMemo(() => {
    const set = new Set<string>();
    for (const ticket of tickets) {
      if (ticket.assignee) set.add(ticket.assignee);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [tickets]);

  const hasUnassigned = useMemo(() => tickets.some((ticket) => !ticket.assignee), [tickets]);

  const enabledDocRemotes = useMemo(() => {
    const kinds = new Set(
      (detail?.integrations ?? [])
        .map((item) => item.kind)
        .filter((kind): kind is DocumentSource =>
          kind === "docmost" || kind === "notion" || kind === "confluence"
        ),
    );
    return (["docmost", "notion", "confluence"] as DocumentSource[]).filter((kind) =>
      kinds.has(kind)
    );
  }, [detail]);

  const visibleTickets = useMemo(() => {
    if (assigneeFilter === "all") return tickets;
    if (assigneeFilter === "none") return tickets.filter((ticket) => !ticket.assignee);
    return tickets.filter((ticket) => ticket.assignee === assigneeFilter);
  }, [tickets, assigneeFilter]);

  const loadProjects = useCallback(async () => {
    const data = await api.listProjects();
    setProjects(data.projects);
    setCurrentId((current) => {
      if (current) return current;
      const stored = readActiveProjectId();
      const saved = stored ? data.projects.find((project) => project.id === stored) : undefined;
      return saved?.id ?? data.projects[0]?.id ?? null;
    });
  }, []);

  const loadLlmProviders = useCallback(async () => {
    try {
      const result = await api.listLlm();
      setLlmProviders(result.providers);
    } catch (error) {
      console.error(error);
    }
  }, []);

  const loadRoles = useCallback(async () => {
    try {
      const result = await api.listRoles();
      setRoles(result.roles);
    } catch (error) {
      console.error(error);
    }
  }, []);

  const loadAutomationSettings = useCallback(async () => {
    try {
      const result = await api.getAutomationSettings();
      setAutoBuildOnInProgress(result.autoBuildOnInProgress);
    } catch (error) {
      console.error(error);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetail(await api.projectDetail(id));
  }, []);

  const loadDocuments = useCallback(async (id: string, source: DocumentSource = "docmost") => {
    setDocsLoading(true);
    setDocsError(undefined);
    setDocsDebug(undefined);
    try {
      const res = await api.listDocuments(id, undefined, source);
      setDocsConfigured(res.configured);
      setDocs(res.documents);
      setDocsError(res.error);
      setDocsDebug(res.debug);
    } catch (error) {
      setDocsError((error as Error).message);
      setDocs([]);
    } finally {
      setDocsLoading(false);
    }
  }, []);

  const loadLocalDocuments = useCallback(async (id: string) => {
    setLocalDocsLoading(true);
    setLocalDocsError(undefined);
    try {
      const res = await api.listLocalDocuments(id);
      setLocalDocs(res.documents);
      setLocalDocsConfigured(res.configured);
      setLocalDocsError(res.error);
    } catch (error) {
      setLocalDocsError((error as Error).message);
      setLocalDocs([]);
    } finally {
      setLocalDocsLoading(false);
    }
  }, []);

  const loadGit = useCallback(async (id: string) => {
    setGitLoading(true);
    setGitError(undefined);
    try {
      const [status, branches, log] = await Promise.all([
        api.gitStatus(id),
        api.gitBranches(id),
        api.gitLog(id),
      ]);
      setGitStatusData(status.status);
      setGitBranchList(branches.branches);
      setGitRemoteList(branches.remotes ?? []);
      setGitStashList(branches.stashes ?? []);
      setGitCommits(log.commits);
    } catch (error) {
      setGitError((error as Error).message);
      setGitStatusData(null);
      setGitBranchList([]);
      setGitRemoteList([]);
      setGitStashList([]);
      setGitCommits([]);
    } finally {
      setGitLoading(false);
    }
  }, []);

  const loadWorkflows = useCallback(async (id: string) => {
    setWorkflowLoading(true);
    setWorkflowError(undefined);
    try {
      const [list, runs] = await Promise.all([
        api.listWorkflows(id),
        api.listWorkflowRuns(id, { limit: 20 }),
      ]);
      setWorkflows(list.workflows);
      setWorkflowRuns(runs.runs);
      setWorkflowRootPath(list.root);
      setWorkflowSource(list.source);
    } catch (error) {
      setWorkflowError((error as Error).message);
      setWorkflows([]);
      setWorkflowRuns([]);
    } finally {
      setWorkflowLoading(false);
    }
  }, []);

  const openWorkflow = useCallback(
    (slug: string, title: string) => {
      if (!currentId) return;
      focusTab({
        id: `workflow:${currentId}:${slug}`,
        kind: "workflow",
        title,
        ref: slug,
      });
    },
    [currentId, focusTab],
  );

  const createWorkflow = useCallback(async () => {
    if (!currentId) return;
    const existing = new Set(workflows.map((workflow) => workflow.slug));
    let slug = "new-workflow";
    let index = 2;
    while (existing.has(slug)) slug = `new-workflow-${index++}`;
    try {
      const result = await api.createWorkflow(currentId, { name: slug });
      await loadWorkflows(currentId);
      openWorkflow(result.workflow.slug, result.workflow.name);
    } catch (error) {
      setWorkflowError((error as Error).message);
    }
  }, [currentId, workflows, loadWorkflows, openWorkflow]);

  const stageGit = useCallback(
    async (paths: string[]) => {
      if (!currentId) return;
      await api.gitStage(currentId, paths);
      await loadGit(currentId);
    },
    [currentId, loadGit],
  );

  const unstageGit = useCallback(
    async (paths: string[]) => {
      if (!currentId) return;
      await api.gitUnstage(currentId, paths);
      await loadGit(currentId);
    },
    [currentId, loadGit],
  );

  const commitGit = useCallback(
    async (message: string) => {
      if (!currentId) return;
      await api.gitCommit(currentId, message);
      await loadGit(currentId);
    },
    [currentId, loadGit],
  );

  const checkoutGit = useCallback(
    async (branch: string) => {
      if (!currentId) return;
      await api.gitCheckout(currentId, branch);
      await loadGit(currentId);
    },
    [currentId, loadGit],
  );

  const applyGitStash = useCallback(
    async (index: number, pop = false) => {
      if (!currentId) return;
      await api.gitStashApply(currentId, { index, pop });
      await loadGit(currentId);
    },
    [currentId, loadGit],
  );

  const loadTickets = useCallback(async (id: string) => {
    setTicketsLoading(true);
    setTicketsError(undefined);
    try {
      const res = await api.listTickets(id);
      setTickets(res.tickets);
      setTicketsError(res.error);
    } catch (error) {
      setTicketsError((error as Error).message);
      setTickets([]);
    } finally {
      setTicketsLoading(false);
    }
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "v") return;
      const tab = tabs.find((item) => item.id === activeTabId);
      if (!tab || tab.kind !== "file") return;
      const path = tab.ref ?? tab.title;
      if (!/\.(md|markdown|mdx)$/i.test(path)) return;
      event.preventDefault();
      patchTab(tab.id, { preview: !tab.preview });
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [tabs, activeTabId, patchTab]);

  const openDocument = useCallback(
    async (pageId: string, title: string, source: DocumentSource = "docmost") => {
      if (!currentId) return;
      if (pageId.startsWith("space:")) return;
      setMenu("document");
      const id = `doc:${source}:${currentId}:${pageId}`;
      const existing = tabs.find((tab) => tab.id === id);
      if (existing && !existing.error) {
        setActiveTabId(id);
        return;
      }
      focusTab({ id, kind: "document", title, ref: pageId, source, loading: true });
      try {
        const res = await api.getDocument(currentId, pageId, source);
        patchTab(id, {
          content: res.document.content,
          title: res.document.title ?? title,
          loading: false,
        });
      } catch (error) {
        patchTab(id, { loading: false, error: (error as Error).message });
      }
    },
    [currentId, tabs, focusTab, patchTab, setActiveTabId, setMenu],
  );

  const openLocalDocument = useCallback(
    async (path: string, title: string) => {
      if (!currentId) return;
      setMenu("document");
      const id = `doclocal:${currentId}:${path}`;
      const existing = tabs.find(
        (tab) => tab.id === id || (tab.source === "local" && tab.ref === path),
      );
      if (existing && !existing.error) {
        setActiveTabId(existing.id);
        return;
      }
      focusTab({ id, kind: "document", title, ref: path, source: "local", loading: true });
      try {
        const res = await api.getLocalDocument(currentId, path);
        patchTab(id, {
          content: res.document.content,
          title: res.document.title,
          ref: res.document.path,
          syncStatus: res.document.syncStatus,
          pageId: res.document.pageId,
          loading: false,
        });
      } catch (error) {
        patchTab(id, { loading: false, error: (error as Error).message });
      }
    },
    [currentId, tabs, focusTab, patchTab],
  );

  const openFile = useCallback(
    async (path: string, reload = false) => {
      if (!currentId) return;
      setMenu("files");
      const id = `file:${currentId}:${path}`;
      const existing = tabs.find((tab) => tab.id === id);
      if (existing && !existing.error && !reload) {
        setActiveTabId(id);
        return;
      }
      if (existing) {
        patchTab(id, { loading: true, error: undefined });
        setActiveTabId(id);
      } else {
        focusTab({ id, kind: "file", title: path, ref: path, loading: true });
      }
      try {
        const res = await api.readFile(currentId, path);
        patchTab(id, { content: res.content, binary: res.binary, size: res.size, loading: false });
      } catch (error) {
        patchTab(id, { loading: false, error: (error as Error).message });
      }
    },
    [currentId, tabs, focusTab, patchTab],
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ReviewDetail | null>).detail;
      if (!detail) {
        setReview(null);
        setTabs((current) => current.filter((tab) => tab.kind !== "review"));
        setActiveTabId((current) =>
          current && tabsRef.current.some((tab) => tab.id === current && tab.kind === "review")
            ? null
            : current
        );
        return;
      }
      setReview({ runId: detail.runId, changes: detail.changes });
      const id = `review:${detail.runId}`;
      setTabs((current) => {
        if (current.some((tab) => tab.kind === "review")) {
          return current.map((tab) =>
            tab.kind === "review"
              ? {
                ...tab,
                id,
                ref: detail.runId,
                title: `Review changes (${detail.changes.length})`,
              }
              : tab
          );
        }
        return [
          ...current,
          {
            id,
            kind: "review" as const,
            ref: detail.runId,
            title: `Review changes (${detail.changes.length})`,
          },
        ];
      });
      setActiveTabId(id);
    };
    window.addEventListener(REVIEW_EVENT, handler);
    return () => window.removeEventListener(REVIEW_EVENT, handler);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const paths = (event as CustomEvent<{ paths: string[] }>).detail?.paths ?? [];
      for (const path of paths.slice(0, 8)) void openFile(path, true);
    };
    window.addEventListener(CHANGES_APPLIED_EVENT, handler);
    return () => window.removeEventListener(CHANGES_APPLIED_EVENT, handler);
  }, [openFile]);

  const saveFile = useCallback(
    async (path: string, content: string) => {
      if (!currentId) return;
      await api.writeFile(currentId, path, content);
      patchTab(`file:${currentId}:${path}`, { content, dirty: false });
    },
    [currentId, patchTab],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "f") return;
      if (triggerFind()) event.preventDefault();
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey) return;
      if (event.key.toLowerCase() !== "s") return;
      const tab = tabs.find((item) => item.id === activeTabId);
      if (!tab || tab.kind !== "file" || tab.preview) return;
      event.preventDefault();
      if (!tab.dirty) return;
      void saveFile(tab.ref ?? tab.title, tab.content ?? "").catch(() => {});
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [tabs, activeTabId, saveFile]);

  const createDocument = useCallback(
    async (title: string, parentPageId?: string) => {
      if (!currentId) return;
      const { document } = await api.createDocument(currentId, { title, parentPageId });
      await loadDocuments(currentId, "docmost");
      await openDocument(document.id, document.title, "docmost");
    },
    [currentId, loadDocuments, openDocument],
  );

  const changeDocSource = useCallback((source: PanelDocSource) => {
    setDocSource(source);
  }, []);

  useEffect(() => {
    if (docSource !== "local" && !enabledDocRemotes.includes(docSource)) {
      setDocSource("local");
    }
  }, [docSource, enabledDocRemotes]);

  const saveDocument = useCallback(
    async (pageId: string, payload: { title?: string; content: string }) => {
      if (!currentId) return;
      const { document } = await api.updateDocument(currentId, pageId, payload);
      patchTab(`doc:docmost:${currentId}:${pageId}`, {
        content: document.content,
        title: document.title ?? payload.title,
      });
      await loadDocuments(currentId, "docmost");
    },
    [currentId, patchTab, loadDocuments],
  );

  const createLocalDocument = useCallback(
    async (title: string) => {
      if (!currentId) return;
      const { document } = await api.createLocalDocument(currentId, { title });
      await loadLocalDocuments(currentId);
      await openLocalDocument(document.path, document.title);
    },
    [currentId, loadLocalDocuments, openLocalDocument],
  );

  const generateTicketsFromDocument = useCallback(
    async (title: string, content: string) => {
      if (!currentId) throw new Error("Pilih project dulu.");
      const result = await api.generateTickets(currentId, { title, content });
      await loadTickets(currentId);
      return result;
    },
    [currentId, loadTickets],
  );

  const patchLocalDocTab = useCallback((path: string, patch: Partial<EditorTab>) => {
    setTabs((current) =>
      current.map((tab) =>
        tab.kind === "document" && tab.source === "local" && tab.ref === path
          ? { ...tab, ...patch }
          : tab
      ),
    );
  }, []);

  const saveLocalDocument = useCallback(
    async (path: string, payload: { title?: string; content: string }) => {
      if (!currentId) return;
      const { document } = await api.updateLocalDocument(currentId, {
        path,
        title: payload.title,
        content: payload.content,
      });
      patchLocalDocTab(path, {
        ref: document.path,
        title: document.title,
        content: document.content,
        syncStatus: document.syncStatus,
      });
      await loadLocalDocuments(currentId);
    },
    [currentId, patchLocalDocTab, loadLocalDocuments],
  );

  const syncLocalDocument = useCallback(
    async (path: string) => {
      if (!currentId) return;
      const { document } = await api.syncLocalDocument(currentId, path);
      patchLocalDocTab(path, {
        ref: document.path,
        title: document.title,
        syncStatus: document.syncStatus,
        pageId: document.pageId,
      });
      await loadLocalDocuments(currentId);
    },
    [currentId, patchLocalDocTab, loadLocalDocuments],
  );

  useEffect(() => {
    loadProjects().catch(console.error);
    loadLlmProviders().catch(console.error);
    loadRoles().catch(console.error);
    loadAutomationSettings().catch(console.error);
  }, [loadProjects, loadLlmProviders, loadRoles, loadAutomationSettings]);

  useEffect(() => {
    if (!currentId) return;
    try {
      localStorage.setItem(ACTIVE_PROJECT_KEY, currentId);
    } catch {
      // ignore storage errors
    }
  }, [currentId]);

  useEffect(() => {
    if (!currentId) return;
    setAddingProvider(false);
    setAssigneeFilter("all");
    setDetailOpen(false);
    setDetailTicket(null);
    setCreateTicketOpen(false);
    setSettingsSection("workspace");
    setLocalDocs([]);
    setLocalDocsConfigured(false);
    setLocalDocsError(undefined);
    setGitStatusData(null);
    setGitBranchList([]);
    setGitRemoteList([]);
    setGitStashList([]);
    setGitCommits([]);
    setGitError(undefined);
    const workspaceTab: EditorTab = {
      id: `workspace:${currentId}`,
      kind: "workspace",
      title: "Workspace",
    };
    setTabs([workspaceTab]);
    setActiveTabId(workspaceTab.id);
    setMenu("workspace");
    loadDetail(currentId).catch(console.error);
  }, [currentId, loadDetail]);

  useEffect(() => {
    if (!currentId) return;
    if (menu === "document") {
      if (docSource !== "local") loadDocuments(currentId, docSource).catch(console.error);
      loadLocalDocuments(currentId).catch(console.error);
    }
    if (menu === "ticket") loadTickets(currentId).catch(console.error);
    if (menu === "git") loadGit(currentId).catch(console.error);
    if (menu === "workflow") loadWorkflows(currentId).catch(console.error);
  }, [
    menu,
    currentId,
    docSource,
    loadDocuments,
    loadLocalDocuments,
    loadTickets,
    loadGit,
    loadWorkflows,
  ]);

  useEffect(() => {
    if (menu === "settings" && !currentId) setMenu("workspace");
    if (menu === "files" && (!currentId || !hasWorkspace)) setMenu("workspace");
  }, [menu, currentId, hasWorkspace]);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as ActivityEvent;
        if (event.type.startsWith("workflow.step.")) return;
        setActivity((current) => [event, ...current].slice(0, 50));
      } catch {
        // ignore malformed events
      }
    };
    return () => source.close();
  }, []);

  const onMenuChange = (next: Menu) => {
    if (next === "global") openSingleton("global", "Global Settings");
    else if (next === "workspace") openSingleton("workspace", "Workspace");
    else if (next === "ticket") openSingleton("ticket", "Ticket Board");
    else if (next === "terminal") {
      setTerminalOpen((value) => !value);
      return;
    }
    else if (next === "git") openSingleton("git", "Git");
    else if (next === "workflow") openSingleton("workflow", "Workflows");
    else if (next === "settings") openSingleton("settings", "Project Settings");
    else setMenu(next);
  };

  const selectTab = (id: string) => {
    const tab = tabs.find((item) => item.id === id);
    setActiveTabId(id);
    if (tab) setMenu(PANEL_FOR_KIND[tab.kind]);
  };

  useEffect(() => {
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
    } catch {
      // ignore
    }
  }, [panelWidth]);

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    const onMove = (moveEvent: MouseEvent) => {
      const next = Math.min(
        PANEL_MAX_WIDTH,
        Math.max(PANEL_MIN_WIDTH, startWidth + (moveEvent.clientX - startX)),
      );
      setPanelWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const createProject = async (input: { name: string; workspacePath?: string }) => {
    const { project } = await api.createProject(input);
    setProjects((current) => [project, ...current]);
    setCurrentId(project.id);
  };

  const removeProject = async (id: string) => {
    await api.deleteProject(id);
    setProjects((current) => {
      const next = current.filter((project) => project.id !== id);
      if (currentId === id) {
        setCurrentId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  const saveIntegration = async (payload: IntegrationPayload) => {
    if (!currentId) return;
    await api.saveIntegration(currentId, payload);
    await loadDetail(currentId);
  };

  const testIntegration = async (payload: IntegrationPayload): Promise<TestResult> =>
    (await api.testIntegration(payload, currentId ?? undefined)).result;

  const testLlm = async (
    payload: LlmProviderPayload,
    providerId?: string,
  ): Promise<TestResult> =>
    (
      await api.testRaw({
        kind: "llm",
        mode: payload.mode,
        config: {
          baseUrl: payload.baseUrl ?? "",
          provider: payload.provider,
          model: payload.model ?? "",
          apiKey: payload.apiKey ?? "",
          ...(providerId ? { providerId } : {}),
        },
      })
    ).result;

  const saveRole = async (
    id: string | null,
    payload: { name: string; description?: string; persona: string; providerId?: string },
  ) => {
    if (id) await api.updateRole(id, payload);
    else await api.createRole(payload);
    setAddingRole(false);
    await loadRoles();
  };

  const deleteRole = async (id: string) => {
    await api.deleteRole(id);
    await loadRoles();
  };

  const saveLlm = async (id: string | null, payload: LlmProviderPayload) => {
    if (id) await api.updateLlm(id, payload);
    else await api.createLlm(payload);
    setAddingProvider(false);
    await loadLlmProviders();
  };

  const deleteLlm = async (id: string) => {
    await api.deleteLlm(id);
    await loadLlmProviders();
  };

  const moveTicket = async (key: string, from: string, to: string) => {
    if (!currentId) return;
    const ticket = tickets.find((item) => item.key === key);
    if (ticket?.source === "local" && ticket.localId) {
      await api.updateLocalTicket(currentId, ticket.localId, { status: to });
    } else {
      await api.transitionTicket(currentId, key, to);
    }
    await loadTickets(currentId);

    if (!isTodoToInProgress(from, to) || llmProviders.length === 0) return;
    try {
      const settings = await api.getAutomationSettings();
      setAutoBuildOnInProgress(settings.autoBuildOnInProgress);
      if (!settings.autoBuildOnInProgress) return;
    } catch {
      if (!autoBuildOnInProgress) return;
    }

    let description = ticket?.description?.trim() || undefined;
    if (!description) {
      try {
        const detail = await api.getTicket(currentId, key);
        description = detail.ticket.description?.trim() || undefined;
      } catch {
        // continue with summary only
      }
    }

    setChatOpen(true);
    dispatchAutoBuild({
      projectId: currentId,
      key,
      summary: ticket?.summary ?? key,
      description,
    });
  };

  const updateWorkspace = async (path: string, documentPath?: string) => {
    if (!currentId) return;
    const { project } = await api.updateProject(currentId, {
      workspacePath: path,
      documentPath,
    });
    setProjects((current) => current.map((p) => (p.id === project.id ? project : p)));
    await loadDetail(currentId);
    await loadLocalDocuments(currentId);
  };

  const cloneRepository = async (input: {
    url: string;
    protocol: "https" | "ssh";
  }) => {
    if (!currentId) throw new Error("Belum ada project.");
    const { project } = await api.gitClone(currentId, input);
    setProjects((current) => current.map((p) => (p.id === project.id ? project : p)));
    await loadDetail(currentId);
    await loadLocalDocuments(currentId);
    return project;
  };

  const renderTab = (tab: EditorTab) => {
    switch (tab.kind) {
      case "workspace":
        return detail ? (
          <WorkspaceOverview
            detail={detail}
            onOpenSettings={() => {
              setSettingsSection("workspace");
              openSingleton("settings", "Project Settings");
            }}
          />
        ) : (
          <Empty text="Pilih atau buat project di panel kiri." />
        );
      case "ticket":
        return (
          <TicketTab
            hasProject={!!currentId}
            loading={ticketsLoading}
            error={ticketsError}
            tickets={tickets}
            visibleTickets={visibleTickets}
            assigneeFilter={assigneeFilter}
            boardKey={`${currentId}:${assigneeFilter}`}
            onMove={moveTicket}
            onOpenDetail={(ticket) => {
              setDetailTicket(ticket);
              setDetailOpen(true);
            }}
            onError={setTicketsError}
          />
        );
      case "settings":
        return (
          <SettingsTab
            section={settingsSection}
            detail={detail}
            activity={activity}
            onSaveIntegration={saveIntegration}
            onTestIntegration={testIntegration}
            onUpdateWorkspace={updateWorkspace}
            onCloneRepository={cloneRepository}
          />
        );
      case "global":
        return (
          <div className="h-full overflow-y-auto p-6">
            <GlobalSettingsView
              section={globalSection}
              projectId={currentId}
              llmProviders={llmProviders}
              addingProvider={addingProvider}
              onAddProvider={setAddingProvider}
              onTestLlm={testLlm}
              onSaveLlm={saveLlm}
              onDeleteLlm={deleteLlm}
              roles={roles}
              addingRole={addingRole}
              onAddRole={setAddingRole}
              onSaveRole={saveRole}
              onDeleteRole={deleteRole}
            />
          </div>
        );
      case "document":
        return (
          <DocumentTab
            key={tab.id}
            tab={tab}
            onSave={saveDocument}
            onSaveLocal={saveLocalDocument}
            onSyncLocal={syncLocalDocument}
            onGenerateTickets={generateTicketsFromDocument}
            onOpenTickets={() => openSingleton("ticket", "Ticket Board")}
          />
        );
      case "workflow":
        return (
          <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
            <WorkflowTabComponent
              projectId={currentId}
              slug={tab.ref ?? null}
              onSaved={() => currentId && loadWorkflows(currentId)}
              onDeleted={() => {
                closeTab(tab.id);
                if (currentId) loadWorkflows(currentId).catch(console.error);
              }}
            />
          </Suspense>
        );
      case "git":
        return (
          <GitTab
            projectId={currentId}
            status={gitStatusData}
            branches={gitBranchList}
            commits={gitCommits}
            loading={gitLoading}
            error={gitError}
            onRefresh={() => (currentId ? loadGit(currentId) : Promise.resolve())}
            onStage={stageGit}
            onUnstage={unstageGit}
            onCommit={commitGit}
          />
        );
      case "review":
        return review ? (
          <ReviewTab runId={review.runId} changes={review.changes} />
        ) : (
          <Empty text="Tidak ada perubahan yang menunggu review." />
        );
      case "file":
        return (
          <FileTab
            key={tab.id}
            tab={tab}
            onChange={(content) => patchTab(tab.id, { content, dirty: true })}
            onSave={() => saveFile(tab.ref ?? tab.title, tab.content ?? "")}
            onTogglePreview={() => patchTab(tab.id, { preview: !tab.preview })}
          />
        );
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <ActivityBar
        active={menu}
        hasProject={!!currentId}
        hasWorkspace={hasWorkspace}
        terminalOpen={terminalOpen}
        onChange={onMenuChange}
      />

      {(menu === "workspace" ||
        menu === "files" ||
        menu === "document" ||
        menu === "settings" ||
        menu === "ticket" ||
        menu === "git" ||
        menu === "workflow" ||
        menu === "global") && (
        <aside
          style={{ width: panelWidth }}
          className="relative flex min-h-0 shrink-0 flex-col overflow-hidden border-r bg-[var(--sidebar)]"
        >
          {menu === "workspace" && (
            <WorkspacePanel
              projects={projects}
              currentId={currentId}
              onSelect={setCurrentId}
              onCreate={createProject}
              onDelete={removeProject}
            />
          )}
          {menu === "files" && (
            <FileTreePanel
              projectId={currentId}
              selectedPath={activeTab?.kind === "file" ? activeTab.ref ?? null : null}
              onOpenFile={openFile}
            />
          )}
          {menu === "settings" && (
            <SettingsPanel section={settingsSection} onSelect={setSettingsSection} />
          )}
          {menu === "global" && (
            <GlobalSettingsPanel section={globalSection} onSelect={setGlobalSection} />
          )}
          {menu === "workflow" && (
            <WorkflowPanel
              workflows={workflows}
              runs={workflowRuns}
              root={workflowRootPath}
              source={workflowSource}
              loading={workflowLoading}
              error={workflowError}
              onRefresh={() => currentId && void loadWorkflows(currentId)}
              onCreate={() => void createWorkflow()}
              onSelect={openWorkflow}
              onOpenRun={openWorkflow}
            />
          )}
          {menu === "git" && (
            <GitPanel
              status={gitStatusData}
              branches={gitBranchList}
              remotes={gitRemoteList}
              stashes={gitStashList}
              loading={gitLoading}
              error={gitError}
              onRefresh={() => currentId && loadGit(currentId)}
              onCheckout={(branch) => void checkoutGit(branch)}
              onApplyStash={(index, pop) => void applyGitStash(index, pop)}
            />
          )}
          {menu === "ticket" && (
            <TicketPanel
              count={tickets.length}
              loading={ticketsLoading}
              assignees={assignees}
              hasUnassigned={hasUnassigned}
              assigneeFilter={assigneeFilter}
              onFilter={setAssigneeFilter}
              onRefresh={() => currentId && loadTickets(currentId)}
              onCreate={() => setCreateTicketOpen(true)}
              canCreate={!!currentId}
            />
          )}
          {menu === "document" && (
            <DocumentPanel
              projectId={currentId}
              source={docSource}
              onSourceChange={changeDocSource}
              enabledRemotes={enabledDocRemotes}
              remote={{
                loading: docsLoading,
                configured: docsConfigured,
                error: docsError,
                debug: docsDebug,
                documents: docs,
              }}
              selectedId={activeTab?.kind === "document" ? activeTab.ref ?? null : null}
              onSelect={openDocument}
              onRefresh={() =>
                currentId && docSource !== "local" && loadDocuments(currentId, docSource)
              }
              onCreate={createDocument}
              localDocuments={localDocs}
              localConfigured={localDocsConfigured}
              localLoading={localDocsLoading}
              localError={localDocsError}
              onSelectLocal={openLocalDocument}
              onRefreshLocal={() => currentId && loadLocalDocuments(currentId)}
              onCreateLocal={createLocalDocument}
            />
          )}
          <div
            onMouseDown={startResize}
            role="separator"
            aria-orientation="vertical"
            className="hover:bg-primary/40 absolute inset-y-0 right-0 w-1 cursor-col-resize transition-colors"
          />
        </aside>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[35px] items-center justify-between border-b px-3">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate font-medium text-foreground">
              {detail?.project.name ?? "RND Workflow"}
            </span>
            {workspaceBase ? <span className="truncate">{workspaceBase}</span> : null}
          </div>
          <Button
            size="sm"
            variant={chatOpen ? "secondary" : "ghost"}
            onClick={() => setChatOpen((open) => !open)}
            data-icon="inline-start"
            className="h-7"
          >
            <MessageSquare />
            Chat
          </Button>
        </header>

        <TabsBar tabs={tabs} activeId={activeTabId} onSelect={selectTab} onClose={closeTab} />

        <div
          className={cn(
            "min-h-0 flex-1",
            activeTab?.kind === "file" ||
              activeTab?.kind === "review" ||
              activeTab?.kind === "git" ||
              activeTab?.kind === "workflow" ||
              activeTab?.kind === "document" ||
              activeTab?.kind === "settings" ||
              activeTab?.kind === "global"
              ? "overflow-hidden"
              : "overflow-y-auto p-6",
          )}
        >
          {activeTab ? renderTab(activeTab) : <Empty text="Buka menu dari activity bar di kiri." />}
        </div>
        <TerminalPanel
          projectId={currentId}
          open={terminalOpen}
          onClose={() => setTerminalOpen(false)}
        />
      </main>

      <ChatSidebar
        projectId={currentId}
        providers={llmProviders}
        roles={roles}
        onClose={() => setChatOpen(false)}
        onTicketsChanged={() => currentId && loadTickets(currentId)}
        hidden={!chatOpen}
      />

      </div>

      <StatusBar
        projectName={detail?.project.name}
        workspacePath={detail?.project.workspace_path}
        activeTitle={activeTab?.title}
        branch={gitStatusData?.branch}
      />

      <TicketDetailDialog
        projectId={currentId}
        ticketKey={detailTicket?.key ?? null}
        localId={detailTicket?.localId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onChanged={() => currentId && loadTickets(currentId)}
      />

      <TicketCreateDialog
        projectId={currentId}
        open={createTicketOpen}
        onOpenChange={setCreateTicketOpen}
        onCreated={() => currentId && loadTickets(currentId)}
      />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <EmptyState>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox />
        </EmptyMedia>
        <EmptyTitle>Kosong</EmptyTitle>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </EmptyState>
  );
}

function WorkspaceOverview({
  detail,
  onOpenSettings,
}: {
  detail: ProjectDetail;
  onOpenSettings: () => void;
}) {
  const { project, integrations } = detail;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{project.name}</h1>
        <p className="text-sm text-muted-foreground">
          Workspace: {project.workspace_path ?? "—"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Integrations" value={integrations.length} />
        <StatCard label="Workspace" value={project.workspace_path ? 1 : 0} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mulai dari sini</CardTitle>
          <CardDescription>
            Set workspace folder di <span className="font-medium">Settings → Workspace</span> agar
            menu <span className="font-medium">Explorer</span> aktif.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" onClick={onOpenSettings}>
            Buka Settings
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function FileTab({
  tab,
  onChange,
  onSave,
  onTogglePreview,
}: {
  tab: EditorTab;
  onChange: (content: string) => void;
  onSave: () => Promise<void>;
  onTogglePreview: () => void;
}) {
  const { resolvedEditorTheme } = useTheme();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const path = tab.ref ?? tab.title;
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(path);

  if (tab.loading) return <Skeleton className="h-full w-full rounded-none" />;
  if (tab.error) return <p className="p-6 text-sm text-destructive">{tab.error}</p>;
  if (tab.binary) {
    return <p className="p-6 text-sm text-muted-foreground">File biner (tidak ditampilkan).</p>;
  }

  const save = async () => {
    setSaving(true);
    setSaveError(undefined);
    try {
      await onSave();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-xs text-muted-foreground">{path}</span>
          {tab.dirty ? (
            <span className="size-1.5 shrink-0 rounded-full bg-primary" title="Belum disimpan" />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {saveError ? <span className="text-xs text-destructive">{saveError}</span> : null}
          {isMarkdown ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onTogglePreview}
              title="Cmd/Ctrl+Shift+V"
              data-icon="inline-start"
            >
              {tab.preview ? <Code2 /> : <Eye />}
              {tab.preview ? "Kode" : "Preview"}
            </Button>
          ) : null}
          {!tab.preview ? (
            <Button
              size="sm"
              onClick={save}
              disabled={saving || !tab.dirty}
              title="Cmd/Ctrl+S"
              data-icon="inline-start"
            >
              {saving ? <Spinner /> : <Save />}
              Simpan
            </Button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab.preview ? (
          <div className="h-full overflow-y-auto">
            <div className="px-8 py-6">
              <Suspense
                fallback={
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                }
              >
                <MarkdownView content={tab.content || "_(kosong)_"} />
              </Suspense>
            </div>
          </div>
        ) : (
          <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
            <MonacoViewer
              path={path}
              content={tab.content ?? ""}
              theme={resolvedEditorTheme}
              readOnly={false}
              onChange={onChange}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

function DocumentTab({
  tab,
  onSave,
  onSaveLocal,
  onSyncLocal,
  onGenerateTickets,
  onOpenTickets,
}: {
  tab: EditorTab;
  onSave: (pageId: string, payload: { title?: string; content: string }) => Promise<void>;
  onSaveLocal: (path: string, payload: { title?: string; content: string }) => Promise<void>;
  onSyncLocal: (path: string) => Promise<void>;
  onGenerateTickets: (
    title: string,
    content: string,
  ) => Promise<{ tickets: CreatedTicket[]; message: string }>;
  onOpenTickets: () => void;
}) {
  const { resolvedEditorTheme } = useTheme();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(tab.title);
  const [draftContent, setDraftContent] = useState(tab.content ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | undefined>();
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | undefined>();
  const [generated, setGenerated] = useState<CreatedTicket[] | null>(null);

  const docRef = tab.ref ?? "";
  const isLocal = tab.source === "local";
  const canEdit = isLocal || tab.source === "docmost" || !tab.source;

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const payload = { title: draftTitle.trim() || undefined, content: draftContent };
      if (isLocal) await onSaveLocal(docRef, payload);
      else await onSave(docRef, payload);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    setSyncError(undefined);
    try {
      await onSyncLocal(docRef);
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const generate = async () => {
    setGenerating(true);
    setGenerateError(undefined);
    setGenerated(null);
    try {
      const result = await onGenerateTickets(tab.title, tab.content ?? "");
      setGenerated(result.tickets);
    } catch (e) {
      setGenerateError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const cancel = () => {
    setEditing(false);
    setError(undefined);
    setDraftTitle(tab.title);
    setDraftContent(tab.content ?? "");
  };

  if (tab.loading) {
    return (
      <div className="flex flex-col gap-2 p-8">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }
  if (tab.error) return <p className="p-8 text-sm text-destructive">{tab.error}</p>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        {editing ? (
          <Input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            placeholder="Judul dokumen"
            className="max-w-md"
          />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-base font-semibold">{tab.title}</h1>
            {isLocal ? (
              <Badge
                variant={
                  tab.syncStatus === "synced"
                    ? "secondary"
                    : tab.syncStatus === "error"
                    ? "destructive"
                    : "outline"
                }
              >
                {tab.syncStatus === "synced"
                  ? "Synced"
                  : tab.syncStatus === "error"
                  ? "Sync error"
                  : "Local"}
              </Badge>
            ) : null}
          </div>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
          {syncError ? <span className="text-xs text-destructive">{syncError}</span> : null}
          {!editing ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={generate}
              disabled={generating || !(tab.content ?? "").trim()}
              data-icon="inline-start"
              title="Buat tiket lokal dengan AI dari dokumen ini"
            >
              {generating ? <Spinner /> : <Sparkles />}
              Generate ticket
            </Button>
          ) : null}
          {isLocal && !editing ? (
            <Button
              size="sm"
              variant="outline"
              onClick={sync}
              disabled={syncing}
              data-icon="inline-start"
            >
              {syncing ? <Spinner /> : <Upload />}
              {tab.syncStatus === "synced" ? "Sync ulang" : "Sync ke Docmost"}
            </Button>
          ) : null}
          {canEdit && editing ? (
            <>
              <Button size="sm" variant="ghost" onClick={cancel} disabled={busy}>
                Batal
              </Button>
              <Button size="sm" onClick={save} disabled={busy} data-icon="inline-start">
                {busy ? <Spinner /> : <Save />}
                Simpan
              </Button>
            </>
          ) : null}
          {canEdit && !editing ? (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-icon="inline-start">
              <Pencil />
              Edit
            </Button>
          ) : null}
        </div>
      </div>

      {generateError ? (
        <p className="border-b px-4 py-2 text-xs text-destructive">{generateError}</p>
      ) : null}
      {generated ? (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
          {generated.length ? (
            <>
              <span className="text-muted-foreground">
                {generated.length} tiket lokal dibuat:
              </span>
              {generated.map((ticket) => (
                <Badge key={ticket.id} variant="outline">
                  {ticket.key}
                </Badge>
              ))}
            </>
          ) : (
            <span className="text-muted-foreground">AI tidak membuat tiket.</span>
          )}
          <Button size="sm" variant="ghost" onClick={onOpenTickets}>
            Lihat board
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {editing ? (
          <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
            <MonacoViewer
              path={isLocal ? docRef : `${docRef}.md`}
              language="markdown"
              content={draftContent}
              theme={resolvedEditorTheme}
              readOnly={false}
              onChange={setDraftContent}
            />
          </Suspense>
        ) : (
          <div className="h-full overflow-y-auto">
            <div className="px-8 py-6">
              <Suspense
                fallback={
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                }
              >
                <MarkdownView content={tab.content || "_(kosong)_"} />
              </Suspense>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsTab({
  section,
  detail,
  activity,
  onSaveIntegration,
  onTestIntegration,
  onUpdateWorkspace,
  onCloneRepository,
}: {
  section: SettingsSection;
  detail: ProjectDetail | null;
  activity: ActivityEvent[];
  onSaveIntegration: (payload: IntegrationPayload) => Promise<void>;
  onTestIntegration: (payload: IntegrationPayload) => Promise<TestResult>;
  onUpdateWorkspace: (path: string) => Promise<void>;
  onCloneRepository: (input: {
    url: string;
    protocol: "https" | "ssh";
  }) => Promise<Project>;
}) {
  if (!detail) return <Empty text="Belum ada project." />;
  return (
    <div className="h-full overflow-y-auto p-6">
      <SettingsView
        detail={detail}
        section={section}
        activity={activity}
        onSaveIntegration={onSaveIntegration}
        onTestIntegration={onTestIntegration}
        onUpdateWorkspace={onUpdateWorkspace}
        onCloneRepository={onCloneRepository}
      />
    </div>
  );
}

function TicketTab({
  hasProject,
  loading,
  error,
  tickets,
  visibleTickets,
  assigneeFilter,
  boardKey,
  onMove,
  onOpenDetail,
  onError,
}: {
  hasProject: boolean;
  loading: boolean;
  error?: string;
  tickets: TicketSummary[];
  visibleTickets: TicketSummary[];
  assigneeFilter: string;
  boardKey: string;
  onMove: (key: string, from: string, to: string) => Promise<void>;
  onOpenDetail: (ticket: TicketSummary) => void;
  onError: (message: string) => void;
}) {
  if (!hasProject) return <Empty text="Pilih project dulu di menu Workspace." />;

  return (
    <div className="flex flex-col gap-4">
      {error && tickets.length > 0 ? (
        <p className="text-xs text-destructive">Jira: {error}</p>
      ) : null}

      {loading ? (
        <Empty text="Memuat tiket…" />
      ) : error && tickets.length === 0 ? (
        <Empty text={error} />
      ) : tickets.length === 0 ? (
        <Empty text="Belum ada tiket. Buat tiket lokal (bisa disync ke Jira nanti) atau periksa integrasi Jira." />
      ) : visibleTickets.length === 0 ? (
        <Empty
          text={`Tidak ada tiket untuk "${assigneeFilter === "none" ? "tanpa assignee" : assigneeFilter}".`}
        />
      ) : (
        <TicketKanban
          key={boardKey}
          tickets={visibleTickets}
          onMove={onMove}
          onOpenDetail={onOpenDetail}
          onError={onError}
        />
      )}
    </div>
  );
}
