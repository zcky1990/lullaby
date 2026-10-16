import { useState } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelHeader } from "@/components/PanelHeader";
import { canPickDirectory, chooseWorkspaceDirectory } from "@/lib/bindings";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/api";

interface Props {
  projects: Project[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: (input: { name: string; workspacePath?: string }) => Promise<void>;
}

export function WorkspacePanel({ projects, currentId, onSelect, onCreate }: Props) {
  const [name, setName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [busy, setBusy] = useState(false);
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

  return (
    <>
      <PanelHeader title="Workspace" count={projects.length} />
      <div className="flex flex-col gap-2 px-3 pb-3">
        <Input
          value={name}
          placeholder="Nama project…"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
        />
        <div className="flex gap-2">
          <Input
            value={workspacePath}
            placeholder={pickable ? "Folder workspace…" : "/path/ke/workspace"}
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
            title={pickable ? "Pilih folder" : "Folder picker hanya di app desktop"}
            aria-label="Pilih folder workspace"
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
          Buat project
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {projects.length === 0 && (
          <p className="px-2 py-4 text-sm text-muted-foreground">Belum ada project.</p>
        )}
        {projects.map((project) => (
          <button
            key={project.id}
            onClick={() => onSelect(project.id)}
            className={cn(
              "mb-1 flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
              project.id === currentId && "bg-accent",
            )}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="truncate font-medium">{project.name}</span>
              {project.id === currentId ? (
                <Badge variant="secondary" className="shrink-0 px-1.5 text-[10px]">
                  Aktif
                </Badge>
              ) : null}
            </span>
            <span className="w-full truncate text-xs text-muted-foreground">
              {project.workspace_path ?? "Belum ada workspace"}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
