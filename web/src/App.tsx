import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from "react";
import { Code2, Eye, Inbox, MessageSquare, Pencil, Plus, RefreshCw, Save, Upload } from "lucide-react";
import type { ActivityEvent } from "@/components/ActivityFeed";
import { ActivityBar, type Menu } from "@/components/ActivityBar";
import { ChatSidebar } from "@/components/ChatSidebar";
import { DocumentPanel } from "@/components/DocumentPanel";
import {
  Empty as EmptyState,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { FileTreePanel } from "@/components/FileTreePanel";
import { GlobalSettingsPanel, type GlobalSection } from "@/components/GlobalSettingsPanel";
import { GlobalSettingsView } from "@/components/GlobalSettingsView";
import { SettingsPanel, type SettingsSection } from "@/components/SettingsPanel";
import { SettingsView } from "@/components/SettingsView";
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
import { TicketCreateDialog } from "@/components/TicketCreateDialog";
import { TicketDetailDialog } from "@/components/TicketDetailDialog";
import { TicketKanban } from "@/components/TicketKanban";
import { useTheme } from "@/components/ThemeProvider";
import { WorkspacePanel } from "@/components/WorkspacePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  api,
  type DocSummary,
  type IntegrationPayload,
  type LlmProviderPayload,
  type LocalDocSummary,
  type Project,
  type ProjectDetail,
  type TestResult,
  type TicketSummary,
} from "@/lib/api";

const MonacoViewer = lazy(() => import("@/components/MonacoViewer"));
const MarkdownView = lazy(() => import("@/components/MarkdownView"));

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

const PANEL_FOR_KIND: Record<TabKind, Menu> = {
  workspace: "workspace",
  ticket: "ticket",
  settings: "settings",
  global: "global",
  document: "document",
  file: "files",
};

export default function App() {
  const [menu, setMenu] = useState<Menu>("workspace");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("workspace");
  const [globalSection, setGlobalSection] = useState<GlobalSection>("appearance");
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [addingProvider, setAddingProvider] = useState(false);

  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

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
  const [panelWidth, setPanelWidth] = useState(readPanelWidth);

  const hasWorkspace = !!detail?.project.workspace_path;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

  const assignees = useMemo(() => {
    const set = new Set<string>();
    for (const ticket of tickets) {
      if (ticket.assignee) set.add(ticket.assignee);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [tickets]);

  const hasUnassigned = useMemo(() => tickets.some((ticket) => !ticket.assignee), [tickets]);

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

  const loadDetail = useCallback(async (id: string) => {
    setDetail(await api.projectDetail(id));
  }, []);

  const loadDocuments = useCallback(async (id: string) => {
    setDocsLoading(true);
    setDocsError(undefined);
    setDocsDebug(undefined);
    try {
      const res = await api.listDocuments(id);
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

  const focusTab = useCallback((tab: EditorTab) => {
    setTabs((current) =>
      current.some((item) => item.id === tab.id)
        ? current.map((item) => (item.id === tab.id ? { ...item, title: tab.title } : item))
        : [...current, tab],
    );
    setActiveTabId(tab.id);
    setMenu(PANEL_FOR_KIND[tab.kind]);
  }, []);

  const patchTab = useCallback((id: string, patch: Partial<EditorTab>) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
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

  const closeTab = useCallback(
    (id: string) => {
      const index = tabs.findIndex((tab) => tab.id === id);
      if (index === -1) return;
      const next = tabs.filter((tab) => tab.id !== id);
      setTabs(next);
      if (activeTabId === id) {
        setActiveTabId(next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? null);
      }
    },
    [tabs, activeTabId],
  );

  const openSingleton = useCallback(
    (kind: TabKind, title: string) => {
      if (kind === "global") {
        focusTab({ id: "global", kind, title });
        return;
      }
      if (!currentId) return;
      focusTab({ id: `${kind}:${currentId}`, kind, title });
    },
    [currentId, focusTab],
  );

  const openDocument = useCallback(
    async (pageId: string, title: string) => {
      if (!currentId) return;
      setMenu("document");
      const id = `doc:${currentId}:${pageId}`;
      const existing = tabs.find((tab) => tab.id === id);
      if (existing && !existing.error) {
        setActiveTabId(id);
        return;
      }
      focusTab({ id, kind: "document", title, ref: pageId, loading: true });
      try {
        const res = await api.getDocument(currentId, pageId);
        patchTab(id, {
          content: res.document.content,
          title: res.document.title ?? title,
          loading: false,
        });
      } catch (error) {
        patchTab(id, { loading: false, error: (error as Error).message });
      }
    },
    [currentId, tabs, focusTab, patchTab],
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

  const createDocument = useCallback(
    async (title: string, parentPageId?: string) => {
      if (!currentId) return;
      const { document } = await api.createDocument(currentId, { title, parentPageId });
      await loadDocuments(currentId);
      await openDocument(document.id, document.title);
    },
    [currentId, loadDocuments, openDocument],
  );

  const saveDocument = useCallback(
    async (pageId: string, payload: { title?: string; content: string }) => {
      if (!currentId) return;
      const { document } = await api.updateDocument(currentId, pageId, payload);
      patchTab(`doc:${currentId}:${pageId}`, {
        content: document.content,
        title: document.title ?? payload.title,
      });
      await loadDocuments(currentId);
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
  }, [loadProjects]);

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
      loadDocuments(currentId).catch(console.error);
      loadLocalDocuments(currentId).catch(console.error);
    }
    if (menu === "ticket") loadTickets(currentId).catch(console.error);
  }, [menu, currentId, loadDocuments, loadLocalDocuments, loadTickets]);

  useEffect(() => {
    if (menu === "settings" && !currentId) setMenu("workspace");
    if (menu === "files" && (!currentId || !hasWorkspace)) setMenu("workspace");
  }, [menu, currentId, hasWorkspace]);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as ActivityEvent;
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

  const saveIntegration = async (payload: IntegrationPayload) => {
    if (!currentId) return;
    await api.saveIntegration(currentId, payload);
    await loadDetail(currentId);
  };

  const testIntegration = async (payload: IntegrationPayload): Promise<TestResult> =>
    (await api.testIntegration(payload)).result;

  const testLlm = async (payload: LlmProviderPayload): Promise<TestResult> =>
    (
      await api.testRaw({
        kind: "llm",
        mode: payload.mode,
        config: {
          baseUrl: payload.baseUrl ?? "",
          provider: payload.provider,
          model: payload.model ?? "",
          apiKey: payload.apiKey ?? "",
        },
      })
    ).result;

  const saveLlm = async (id: string | null, payload: LlmProviderPayload) => {
    if (!currentId) return;
    if (id) await api.updateLlm(currentId, id, payload);
    else await api.createLlm(currentId, payload);
    setAddingProvider(false);
    await loadDetail(currentId);
  };

  const deleteLlm = async (id: string) => {
    if (!currentId) return;
    await api.deleteLlm(currentId, id);
    await loadDetail(currentId);
  };

  const moveTicket = async (key: string, _from: string, to: string) => {
    if (!currentId) return;
    const ticket = tickets.find((item) => item.key === key);
    if (ticket?.source === "local" && ticket.localId) {
      await api.updateLocalTicket(currentId, ticket.localId, { status: to });
    } else {
      await api.transitionTicket(currentId, key, to);
    }
    await loadTickets(currentId);
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
            assignees={assignees}
            hasUnassigned={hasUnassigned}
            assigneeFilter={assigneeFilter}
            onFilter={setAssigneeFilter}
            onRefresh={() => currentId && loadTickets(currentId)}
            boardKey={`${currentId}:${assigneeFilter}:${visibleTickets
              .map((ticket) => `${ticket.key}.${ticket.status ?? ""}`)
              .join(",")}`}
            onMove={moveTicket}
            onOpenDetail={(ticket) => {
              setDetailTicket(ticket);
              setDetailOpen(true);
            }}
            onCreate={() => setCreateTicketOpen(true)}
            onError={setTicketsError}
          />
        );
      case "settings":
        return (
          <SettingsTab
            section={settingsSection}
            onSection={setSettingsSection}
            detail={detail}
            activity={activity}
            addingProvider={addingProvider}
            onAddProvider={setAddingProvider}
            onSaveIntegration={saveIntegration}
            onTestIntegration={testIntegration}
            onTestLlm={testLlm}
            onSaveLlm={saveLlm}
            onDeleteLlm={deleteLlm}
            onUpdateWorkspace={updateWorkspace}
          />
        );
      case "global":
        return (
          <div className="flex h-full">
            <aside className="flex w-56 shrink-0 flex-col border-r bg-card/20">
              <GlobalSettingsPanel section={globalSection} onSelect={setGlobalSection} />
            </aside>
            <div className="min-w-0 flex-1 overflow-y-auto p-6">
              <GlobalSettingsView section={globalSection} projectId={currentId} />
            </div>
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
          />
        );
      case "file":
        return (
          <FileTab
            key={tab.id}
            tab={tab}
            onTogglePreview={() => patchTab(tab.id, { preview: !tab.preview })}
          />
        );
    }
  };

  return (
    <div className="flex h-full">
      <ActivityBar
        active={menu}
        hasProject={!!currentId}
        hasWorkspace={hasWorkspace}
        onChange={onMenuChange}
      />

      {(menu === "workspace" || menu === "files" || menu === "document") && (
        <aside
          style={{ width: panelWidth }}
          className="relative flex shrink-0 flex-col border-r bg-card/20"
        >
          {menu === "workspace" && (
            <WorkspacePanel
              projects={projects}
              currentId={currentId}
              onSelect={setCurrentId}
              onCreate={createProject}
            />
          )}
          {menu === "files" && (
            <FileTreePanel
              projectId={currentId}
              selectedPath={activeTab?.kind === "file" ? activeTab.ref ?? null : null}
              onOpenFile={openFile}
            />
          )}
          {menu === "document" && (
            <DocumentPanel
              projectId={currentId}
              loading={docsLoading}
              configured={docsConfigured}
              error={docsError}
              debug={docsDebug}
              documents={docs}
              selectedId={activeTab?.kind === "document" ? activeTab.ref ?? null : null}
              onSelect={openDocument}
              onRefresh={() => currentId && loadDocuments(currentId)}
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
        <header className="flex items-center justify-end border-b px-6 py-3 max-h-[40px] h-[40px]">
          <Button
            size="sm"
            variant={chatOpen ? "secondary" : "outline"}
            onClick={() => setChatOpen((open) => !open)}
            data-icon="inline-start"
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
              activeTab?.kind === "document" ||
              activeTab?.kind === "settings" ||
              activeTab?.kind === "global"
              ? "overflow-hidden"
              : "overflow-y-auto p-6",
          )}
        >
          {activeTab ? renderTab(activeTab) : <Empty text="Buka menu dari activity bar di kiri." />}
        </div>
      </main>

      {chatOpen && (
        <ChatSidebar
          projectId={currentId}
          providers={detail?.llmProviders ?? []}
          onClose={() => setChatOpen(false)}
          onOpenFile={(path) => void openFile(path, true)}
          onTicketsChanged={() => currentId && loadTickets(currentId)}
        />
      )}

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
  const { project, integrations, llmProviders } = detail;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{project.name}</h1>
        <p className="text-sm text-muted-foreground">
          Workspace: {project.workspace_path ?? "—"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Integrations" value={integrations.length} />
        <StatCard label="LLM Providers" value={llmProviders.length} />
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
  onTogglePreview,
}: {
  tab: EditorTab;
  onTogglePreview: () => void;
}) {
  const { resolvedEditorTheme } = useTheme();
  const path = tab.ref ?? tab.title;
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(path);

  if (tab.loading) return <Skeleton className="h-full w-full rounded-none" />;
  if (tab.error) return <p className="p-6 text-sm text-destructive">{tab.error}</p>;
  if (tab.binary) {
    return <p className="p-6 text-sm text-muted-foreground">File biner (tidak ditampilkan).</p>;
  }

  if (!isMarkdown) {
    return (
      <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
        <MonacoViewer path={path} content={tab.content ?? ""} theme={resolvedEditorTheme} />
      </Suspense>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <span className="truncate font-mono text-xs text-muted-foreground">{path}</span>
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
            <MonacoViewer path={path} content={tab.content ?? ""} theme={resolvedEditorTheme} />
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
}: {
  tab: EditorTab;
  onSave: (pageId: string, payload: { title?: string; content: string }) => Promise<void>;
  onSaveLocal: (path: string, payload: { title?: string; content: string }) => Promise<void>;
  onSyncLocal: (path: string) => Promise<void>;
}) {
  const { resolvedEditorTheme } = useTheme();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(tab.title);
  const [draftContent, setDraftContent] = useState(tab.content ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | undefined>();

  const docRef = tab.ref ?? "";
  const isLocal = tab.source === "local";

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
          {editing ? (
            <>
              <Button size="sm" variant="ghost" onClick={cancel} disabled={busy}>
                Batal
              </Button>
              <Button size="sm" onClick={save} disabled={busy} data-icon="inline-start">
                {busy ? <Spinner /> : <Save />}
                Simpan
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-icon="inline-start">
              <Pencil />
              Edit
            </Button>
          )}
        </div>
      </div>

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
  onSection,
  detail,
  activity,
  addingProvider,
  onAddProvider,
  onSaveIntegration,
  onTestIntegration,
  onTestLlm,
  onSaveLlm,
  onDeleteLlm,
  onUpdateWorkspace,
}: {
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  detail: ProjectDetail | null;
  activity: ActivityEvent[];
  addingProvider: boolean;
  onAddProvider: (value: boolean) => void;
  onSaveIntegration: (payload: IntegrationPayload) => Promise<void>;
  onTestIntegration: (payload: IntegrationPayload) => Promise<TestResult>;
  onTestLlm: (payload: LlmProviderPayload) => Promise<TestResult>;
  onSaveLlm: (id: string | null, payload: LlmProviderPayload) => Promise<void>;
  onDeleteLlm: (id: string) => Promise<void>;
  onUpdateWorkspace: (path: string) => Promise<void>;
}) {
  if (!detail) return <Empty text="Belum ada project." />;
  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-card/20">
        <SettingsPanel section={section} onSelect={onSection} />
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <SettingsView
          detail={detail}
          section={section}
          activity={activity}
          addingProvider={addingProvider}
          onAddProvider={onAddProvider}
          onSaveIntegration={onSaveIntegration}
          onTestIntegration={onTestIntegration}
          onTestLlm={onTestLlm}
          onSaveLlm={onSaveLlm}
          onDeleteLlm={onDeleteLlm}
          onUpdateWorkspace={onUpdateWorkspace}
        />
      </div>
    </div>
  );
}

function TicketTab({
  hasProject,
  loading,
  error,
  tickets,
  visibleTickets,
  assignees,
  hasUnassigned,
  assigneeFilter,
  onFilter,
  onRefresh,
  onCreate,
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
  assignees: string[];
  hasUnassigned: boolean;
  assigneeFilter: string;
  onFilter: (value: string) => void;
  onRefresh: () => void;
  onCreate: () => void;
  boardKey: string;
  onMove: (key: string, from: string, to: string) => Promise<void>;
  onOpenDetail: (ticket: TicketSummary) => void;
  onError: (message: string) => void;
}) {
  if (!hasProject) return <Empty text="Pilih project dulu di menu Workspace." />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" onClick={onCreate} data-icon="inline-start">
          <Plus />
          Tiket baru
        </Button>
        <div className="flex items-center gap-2">
        <Select value={assigneeFilter} onValueChange={onFilter}>
          <SelectTrigger size="sm" className="w-56" aria-label="Filter assignee">
            <SelectValue placeholder="Semua user" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">Semua user</SelectItem>
              {hasUnassigned ? <SelectItem value="none">Tanpa assignee</SelectItem> : null}
              {assignees.map((assignee) => (
                <SelectItem key={assignee} value={assignee}>
                  {assignee}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          onClick={onRefresh}
          disabled={loading}
          data-icon="inline-start"
        >
          {loading ? <Spinner /> : <RefreshCw />}
          Refresh
        </Button>
        </div>
      </div>

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
