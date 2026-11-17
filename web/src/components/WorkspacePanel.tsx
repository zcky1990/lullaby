import { useState } from "react";
import { Check, FolderOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelHeader } from "@/components/PanelHeader";
import { canPickDirectory, chooseWorkspaceDirectory } from "@/lib/bindings";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/api";

interface Props {
  projects: Project[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: (input: { name: string; workspacePath?: string }) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function WorkspacePanel({
  projects,
  currentId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const pickable = canPickDirectory();

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onCreate({ name: trimmed, workspacePath: workspacePath.trim() || undefined });
      setName("");
      setWorkspacePath("");
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    const chosen = await chooseWorkspaceDirectory();
    if (chosen) setWorkspacePath(chosen);
  };

  const startEdit = (project: Project) => {
    setEditingId(project.id);
    setDraftName(project.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftName("");
  };

  const commitEdit = async (project: Project) => {
    const trimmed = draftName.trim();
    if (!trimmed || savingId) return;
    if (trimmed === project.name) {
      cancelEdit();
      return;
    }
    setSavingId(project.id);
    try {
      await onRename(project.id, trimmed);
      cancelEdit();
    } finally {
      setSavingId(null);
    }
  };

  const remove = async (project: Project) => {
    if (deletingId) return;
    const ok = confirm(t("explorer.workspace.deleteConfirm", { name: project.name }));
    if (!ok) return;
    setDeletingId(project.id);
    try {
      await onDelete(project.id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <PanelHeader title={t("explorer.workspace.title")} count={projects.length} />
      <p className="px-3 pb-2 text-[11px] leading-snug text-muted-foreground">
        {t("explorer.workspace.hintPrefix")}
        <span className="font-medium">{t("explorer.workspace.hintAction")}</span>
        {t("explorer.workspace.hintSuffix")}
      </p>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <Input
          value={name}
          placeholder={t("explorer.workspace.namePlaceholder")}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
        />
        <div className="flex gap-2">
          <Input
            value={workspacePath}
            placeholder={pickable
              ? t("explorer.workspace.pathPlaceholder")
              : t("explorer.workspace.pathPlaceholderManual")}
            onChange={(e) => setWorkspacePath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
          />
          <Button
            size="icon"
            variant="outline"
            onClick={pick}
            disabled={!pickable}
            title={pickable
              ? t("explorer.workspace.pickFolder")
              : t("explorer.workspace.pickFolderUnsupported")}
            aria-label={t("explorer.workspace.pickWorkspaceAria")}
          >
            <FolderOpen />
          </Button>
        </div>
        <Button
          size="sm"
          onClick={create}
          disabled={busy}
          className="w-full"
          data-icon="inline-start"
        >
          <Plus />
          {t("explorer.workspace.createProject")}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {projects.length === 0 && (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            {t("explorer.workspace.empty")}
          </p>
        )}
        {projects.map((project) => (
          <div
            key={project.id}
            className={cn(
              "group mb-1 flex w-full items-start gap-1 rounded-md transition-colors hover:bg-accent",
              project.id === currentId && "bg-accent",
            )}
          >
            {editingId === project.id
              ? (
                <div className="flex w-full items-center gap-1 px-2 py-2">
                  <Input
                    autoFocus
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitEdit(project);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelEdit();
                      }
                    }}
                    className="h-7 min-w-0 flex-1 text-xs"
                    aria-label={t("explorer.workspace.renameInputAria", { name: project.name })}
                    disabled={savingId === project.id}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    disabled={savingId === project.id || !draftName.trim()}
                    onClick={() => void commitEdit(project)}
                    aria-label={t("explorer.workspace.saveNameAria")}
                    title={t("common.save")}
                  >
                    <Check />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    disabled={savingId === project.id}
                    onClick={cancelEdit}
                    aria-label={t("explorer.workspace.cancelRenameAria")}
                    title={t("common.cancel")}
                  >
                    <X />
                  </Button>
                </div>
              )
              : (
                <>
                  <button
                    type="button"
                    onClick={() => onSelect(project.id)}
                    onDoubleClick={() => startEdit(project)}
                    title={t("explorer.workspace.itemTitle")}
                    className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-3 py-2 text-left text-xs"
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="truncate font-medium">{project.name}</span>
                      {project.id === currentId ? (
                        <Badge variant="secondary" className="shrink-0 px-1.5 text-[10px]">
                          {t("explorer.workspace.activeBadge")}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {project.workspace_path ?? t("explorer.workspace.noWorkspace")}
                    </span>
                  </button>
                  <div className="mt-1.5 mr-1 flex shrink-0 gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-muted-foreground hover:text-foreground"
                      onClick={(event) => {
                        event.stopPropagation();
                        startEdit(project);
                      }}
                      aria-label={t("explorer.workspace.renameAria", { name: project.name })}
                      title={t("explorer.workspace.renameTitle")}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      disabled={deletingId === project.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void remove(project);
                      }}
                      aria-label={t("explorer.workspace.deleteAria", { name: project.name })}
                      title={t("explorer.workspace.deleteTitle")}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </>
              )}
          </div>
        ))}
      </div>
    </>
  );
}
