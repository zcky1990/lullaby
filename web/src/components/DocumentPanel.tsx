import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronRight, FileText, Folder, FolderOpen, Plus, RefreshCw } from "lucide-react";
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
import { api, type DocSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string | null;
  loading: boolean;
  configured: boolean;
  error?: string;
  debug?: string;
  documents: DocSummary[];
  selectedId: string | null;
  onSelect: (id: string, title: string) => void;
  onRefresh: () => void;
  onCreate: (title: string, parentPageId?: string) => Promise<void>;
}

export function DocumentPanel({
  projectId,
  loading,
  configured,
  error,
  debug,
  documents,
  selectedId,
  onSelect,
  onRefresh,
  onCreate,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();

  const submit = async () => {
    const value = title.trim();
    if (!value || busy) return;
    setBusy(true);
    setCreateError(undefined);
    try {
      await onCreate(value, selectedId ?? undefined);
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
        <PanelHeader title="Documents" count={documents.length} />
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setCreateError(undefined);
              setCreateOpen(true);
            }}
            disabled={!projectId || !configured}
            aria-label="Tambah dokumen"
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            disabled={!projectId || loading}
            aria-label="Refresh documents"
          >
            <RefreshCw />
          </Button>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah dokumen</DialogTitle>
            <DialogDescription>
              {selectedId
                ? "Dokumen baru akan dibuat sebagai sub-halaman dari dokumen terpilih."
                : "Dokumen baru akan dibuat di space Docmost project ini."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="new-doc-title">Judul</Label>
            <Input
              id="new-doc-title"
              value={title}
              autoFocus
              placeholder="Judul dokumen…"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            {createError ? <p className="text-xs text-destructive">{createError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={busy}>
              Batal
            </Button>
            <Button onClick={submit} disabled={busy || !title.trim()} data-icon="inline-start">
              {busy ? <Spinner /> : <Plus />}
              Buat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {!projectId && <Hint>Pilih project dulu di menu Workspace.</Hint>}
        {projectId && loading && (
          <div className="flex items-center gap-2 px-2 py-4 text-sm text-muted-foreground">
            <Spinner />
            Memuat dokumen…
          </div>
        )}
        {projectId && !loading && !configured && (
          <Hint>Integrasi Docmost belum diatur (Project Settings → Integrations).</Hint>
        )}
        {projectId && !loading && configured && error && <Hint tone="error">{error}</Hint>}
        {projectId && !loading && configured && !error && documents.length === 0 && (
          <>
            <Hint>
              Belum ada dokumen. Isi <span className="font-medium">Space ID</span> (id space, bukan
              nama) di Project Settings → Integrations.
            </Hint>
            {debug && (
              <pre className="mx-2 mb-2 max-h-40 overflow-auto rounded-md border bg-muted/40 p-2 text-[10px] whitespace-pre-wrap text-muted-foreground">
                {debug}
              </pre>
            )}
          </>
        )}
        {documents.map((doc) => (
          <DocNode
            key={doc.id}
            doc={doc}
            depth={0}
            projectId={projectId}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </>
  );
}

function DocNode({
  doc,
  depth,
  projectId,
  selectedId,
  onSelect,
}: {
  doc: DocSummary;
  depth: number;
  projectId: string | null;
  selectedId: string | null;
  onSelect: (id: string, title: string) => void;
}) {
  const hasChildren = doc.hasChildren || !!doc.children?.length;
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DocSummary[] | null>(doc.children ?? null);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [childError, setChildError] = useState<string | undefined>();
  const active = doc.id === selectedId;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || children !== null) return;
    if (!projectId) return;
    setLoadingChildren(true);
    setChildError(undefined);
    try {
      const res = await api.listDocuments(projectId, doc.id);
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
          "flex items-center gap-1 rounded-md pr-2 text-sm transition-colors hover:bg-accent",
          active && "bg-accent",
        )}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {hasChildren ? (
          <button
            onClick={toggle}
            className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
            aria-label={open ? "Collapse" : "Expand"}
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
          onClick={() => onSelect(doc.id, doc.title)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
          title={doc.title}
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
          <span className="truncate">{doc.title}</span>
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
              Tidak ada sub-halaman.
            </p>
          )}
          {children?.map((child) => (
            <DocNode
              key={child.id}
              doc={child}
              depth={depth + 1}
              projectId={projectId}
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
        "px-2 py-4 text-sm",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}
