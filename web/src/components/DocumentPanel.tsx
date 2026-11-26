import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronRight, FileText, Folder, FolderOpen, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PanelHeader } from "@/components/PanelHeader";
import { Spinner } from "@/components/ui/spinner";
import { api, type DocSummary, type DocumentSource, type LocalDocSummary } from "@/lib/api";
import { requestChatOpen, setChatDragData } from "@/lib/chat-drag";
import { useI18n, type Translator } from "@/lib/i18n";
import { useLocalDocsAutoRefresh } from "@/hooks/useLocalDocsAutoRefresh";
import { cn } from "@/lib/utils";

export type PanelDocSource = "local" | DocumentSource;

interface RemoteSourceState {
  loading: boolean;
  configured: boolean;
  error?: string;
  debug?: string;
  documents: DocSummary[];
}

interface Props {
  projectId: string | null;
  source: PanelDocSource;
  onSourceChange: (source: PanelDocSource) => void;
  enabledRemotes?: DocumentSource[];
  remote: RemoteSourceState;
  selectedId: string | null;
  onSelect: (id: string, title: string, source: DocumentSource) => void;
  onRefresh: () => void;
  onCreate: (title: string, parentPageId?: string) => Promise<void>;
  localDocuments: LocalDocSummary[];
  localConfigured: boolean;
  localLoading: boolean;
  localError?: string;
  onSelectLocal: (path: string, title: string) => void;
  onRefreshLocal: () => void;
  onCreateLocal: (title: string) => Promise<void>;
}

const REMOTE_TABS: { id: DocumentSource; label: string }[] = [
  { id: "docmost", label: "Docmost" },
  { id: "notion", label: "Notion" },
  { id: "confluence", label: "Confluence" },
];

export function DocumentPanel({
  projectId,
  source,
  onSourceChange,
  enabledRemotes = [],
  remote,
  selectedId,
  onSelect,
  onRefresh,
  onCreate,
  localDocuments,
  localConfigured,
  localLoading,
  localError,
  onSelectLocal,
  onRefreshLocal,
  onCreateLocal,
}: Props) {
  const { t } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();

  // Dokumen lokal bisa ditambah dari luar UI (agent chat, editor, `git pull`).
  // Panel ini hanya ter-mount saat menu Documents aktif, jadi auto-refresh aman.
  useLocalDocsAutoRefresh({
    enabled: source === "local" && !!projectId && localConfigured,
    loading: localLoading,
    onRefresh: onRefreshLocal,
  });

  const canCreate = true;
  const { loading, configured, error, debug, documents } = remote;
  const remoteTabs = REMOTE_TABS.filter((tab) => enabledRemotes.includes(tab.id));
  const showSourceTabs = remoteTabs.length > 0;

  const submit = async () => {
    const value = title.trim();
    if (!value || busy) return;
    setBusy(true);
    setCreateError(undefined);
    try {
      if (source === "local") await onCreateLocal(value);
      else await onCreate(value, selectedId ?? undefined);
      setCreateOpen(false);
      setTitle("");
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between pr-2">
        <PanelHeader
          title={t("documents.panel.title")}
          count={source === "local" ? localDocuments.length : documents.length}
        />
        <div className="flex items-center gap-1">
          {canCreate ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setCreateError(undefined);
                setCreateOpen(true);
              }}
              disabled={!projectId || (source === "local" ? !localConfigured : !configured)}
              aria-label={t("documents.panel.add")}
              className="text-xs"
            >
              <Plus />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            onClick={source === "local" ? onRefreshLocal : onRefresh}
            disabled={!projectId || (source === "local" ? localLoading : loading)}
            aria-label={t("documents.panel.refresh")}
            className="text-xs"
          >
            <RefreshCw />
          </Button>
        </div>
      </div>

      {showSourceTabs ? (
        <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
          <Button
            size="sm"
            variant={source === "local" ? "secondary" : "ghost"}
            className="h-7"
            onClick={() => onSourceChange("local")}
          >
            {t("documents.panel.local")}
          </Button>
          {remoteTabs.map((tab) => (
            <Button
              key={tab.id}
              size="sm"
              variant={source === tab.id ? "secondary" : "ghost"}
              className="h-7"
              onClick={() => onSourceChange(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("documents.panel.add")}</DialogTitle>
            <DialogDescription>
              {source === "local"
                ? t("documents.panel.createHintLocal")
                : source === "notion"
                ? selectedId
                  ? t("documents.panel.createHintNotionChild")
                  : t("documents.panel.createHintNotionRoot")
                : source === "confluence"
                ? selectedId
                  ? t("documents.panel.createHintConfluenceChild")
                  : t("documents.panel.createHintConfluenceRoot")
                : selectedId
                ? t("documents.panel.createHintDocmostChild")
                : t("documents.panel.createHintDocmostRoot")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="new-doc-title">{t("documents.panel.titleLabel")}</Label>
            <Input
              id="new-doc-title"
              value={title}
              autoFocus
              placeholder={t("documents.panel.titlePlaceholder")}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            {createError ? <p className="text-xs text-destructive">{createError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={busy}>
              {t("documents.panel.cancel")}
            </Button>
            <Button onClick={submit} disabled={busy || !title.trim()} data-icon="inline-start">
              {busy ? <Spinner /> : <Plus />}
              {t("documents.panel.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex-1 overflow-y-auto px-2 pb-2 text-xs">
        {source === "local" ? (
          <>
            {!projectId && <Hint>{t("documents.panel.noProject")}</Hint>}
            {/* Refresh otomatis di background tidak boleh menutupi daftar yang sudah ada. */}
            {projectId && localLoading && localDocuments.length === 0 && (
              <div className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground">
                <Spinner />
                {t("documents.panel.loadingLocal")}
              </div>
            )}
            {projectId && !localLoading && !localConfigured && (
              <Hint>{t("documents.panel.localNotConfigured")}</Hint>
            )}
            {projectId && localConfigured && !localLoading && localError && (
              <Hint tone="error">{localError}</Hint>
            )}
            {projectId && localConfigured && !localLoading && !localError &&
              localDocuments.length === 0 && (
              <Hint>{t("documents.panel.localEmpty")}</Hint>
            )}
            {localDocuments.length > 0 ? (
              <p className="px-2 pb-1 text-[11px] text-muted-foreground">
                {t("documents.panel.dragHint")}
              </p>
            ) : null}
            {localDocuments.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => onSelectLocal(doc.path, doc.title)}
                draggable
                onDragStart={(event) => {
                  setChatDragData(event.dataTransfer, {
                    kind: "document",
                    source: "local",
                    path: doc.path,
                    title: doc.title,
                  });
                  requestChatOpen();
                }}
                className={cn(
                  "flex w-full cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent active:cursor-grabbing",
                  selectedId === doc.path && "bg-accent",
                )}
                title={t("documents.panel.dragTitle", { path: doc.path })}
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs">{doc.title}</span>
                <Badge
                  variant={doc.syncStatus === "synced"
                    ? "secondary"
                    : doc.syncStatus === "error"
                    ? "destructive"
                    : "outline"}
                  className="h-5 px-1.5 text-[10px]"
                >
                  {doc.syncStatus === "synced"
                    ? t("documents.panel.synced")
                    : doc.syncStatus === "error"
                    ? t("documents.panel.error")
                    : t("documents.panel.local")}
                </Badge>
              </button>
            ))}
          </>
        ) : (
          <>
            {!projectId && <Hint>{t("documents.panel.noProject")}</Hint>}
            {projectId && loading && (
              <div className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground">
                <Spinner />
                {t("documents.panel.loading")}
              </div>
            )}
            {projectId && !loading && !configured && (
              <Hint>
                {t("documents.panel.notConfigured", { source: sourceLabel(source) })}
              </Hint>
            )}
            {projectId && !loading && configured && error && <Hint tone="error">{error}</Hint>}
            {projectId && !loading && configured && !error && documents.length === 0 && (
              <>
                <Hint>{emptyHint(source, t)}</Hint>
                {debug && (
                  <pre className="mx-2 mb-2 max-h-40 overflow-auto rounded-md border bg-muted/40 p-2 text-[10px] whitespace-pre-wrap text-muted-foreground">
                    {debug}
                  </pre>
                )}
              </>
            )}
            {projectId && !loading && configured && !error && documents.length > 0 ? (
              <p className="px-2 pb-1 text-[11px] text-muted-foreground">
                {t("documents.panel.dragHint")}
              </p>
            ) : null}
            {documents.map((doc) => (
              <DocNode
                key={doc.id}
                doc={doc}
                depth={0}
                projectId={projectId}
                source={source}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))}
          </>
        )}
      </div>
    </>
  );
}

function sourceLabel(source: DocumentSource): string {
  if (source === "notion") return "Notion";
  if (source === "confluence") return "Confluence";
  return "Docmost";
}

function emptyHint(source: DocumentSource, t: Translator): ReactNode {
  if (source === "notion") {
    return (
      <>
        {t("documents.panel.emptyNotionPrefix")}
        <span className="font-medium">{t("documents.panel.emptyNotionAction")}</span>
        {t("documents.panel.emptyNotionSuffix")}
      </>
    );
  }
  if (source === "confluence") {
    return (
      <>
        {t("documents.panel.emptyConfluencePrefix")}
        <span className="font-medium">{t("documents.panel.emptyConfluenceAction")}</span>
        {t("documents.panel.emptyConfluenceSuffix")}
      </>
    );
  }
  return (
    <>
      {t("documents.panel.emptyDocmostPrefix")}
      <span className="font-medium">{t("documents.panel.emptyDocmostAction")}</span>
      {t("documents.panel.emptyDocmostSuffix")}
    </>
  );
}

function DocNode({
  doc,
  depth,
  projectId,
  source,
  selectedId,
  onSelect,
}: {
  doc: DocSummary;
  depth: number;
  projectId: string | null;
  source: DocumentSource;
  selectedId: string | null;
  onSelect: (id: string, title: string, source: DocumentSource) => void;
}) {
  const { t } = useI18n();
  const hasChildren = doc.hasChildren || !!doc.children?.length;
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DocSummary[] | null>(doc.children ?? null);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [childError, setChildError] = useState<string | undefined>();
  const active = doc.id === selectedId;
  // Node "space:" hanya placeholder (belum punya halaman), jadi tidak bisa diseret.
  const draggable = !doc.id.startsWith("space:");

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || children !== null) return;
    if (!projectId) return;
    setLoadingChildren(true);
    setChildError(undefined);
    try {
      const res = await api.listDocuments(projectId, doc.id, source);
      setChildren(res.documents);
    } catch (error) {
      setChildError((error as Error).message);
      setChildren([]);
    } finally {
      setLoadingChildren(false);
    }
  };

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 rounded-md pr-2 text-xs transition-colors hover:bg-accent",
          active && "bg-accent",
        )}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {hasChildren ? (
          <button
            onClick={toggle}
            className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
            aria-label={open
              ? t("documents.panel.collapse")
              : t("documents.panel.expand")}
          >
            {loadingChildren ? (
              <Spinner className="size-3.5" />
            ) : (
              <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            )}
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <button
          onClick={() => onSelect(doc.id, doc.title, source)}
          draggable={draggable}
          onDragStart={(event) => {
            if (!draggable) return;
            setChatDragData(event.dataTransfer, {
              kind: "document",
              source,
              id: doc.id,
              title: doc.title,
            });
            requestChatOpen();
          }}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left",
            draggable && "cursor-grab active:cursor-grabbing",
          )}
          title={draggable
            ? t("documents.panel.nodeDragTitle", { title: doc.title })
            : doc.title}
        >
          {hasChildren ? (
            open ? (
              <FolderOpen className="size-4 shrink-0 text-info" />
            ) : (
              <Folder className="size-4 shrink-0 text-info" />
            )
          ) : (
            <FileText className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-xs">{doc.title}</span>
        </button>
      </div>

      {open && hasChildren && (
        <>
          {childError && (
            <p className="py-1 text-xs text-destructive" style={{ paddingLeft: depth * 12 + 32 }}>
              {childError}
            </p>
          )}
          {!childError && children && children.length === 0 && !loadingChildren && (
            <p
              className="py-1 text-xs text-muted-foreground"
              style={{ paddingLeft: depth * 12 + 32 }}
            >
              {t("documents.panel.noChildren")}
            </p>
          )}
          {children?.map((child) => (
            <DocNode
              key={child.id}
              doc={child}
              depth={depth + 1}
              projectId={projectId}
              source={source}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </>
      )}
    </div>
  );
}

function Hint({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <p
      className={cn(
        "px-2 py-4 text-xs",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}
