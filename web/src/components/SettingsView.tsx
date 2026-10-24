import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronRight, FolderOpen, Plus } from "lucide-react";
import { ActivityFeed, type ActivityEvent } from "@/components/ActivityFeed";
import { IntegrationForm } from "@/components/IntegrationForm";
import type { SettingsSection } from "@/components/SettingsPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { canPickDirectory, chooseWorkspaceDirectory } from "@/lib/bindings";
import { SINGLETONS } from "@/lib/integrations";
import { cn } from "@/lib/utils";
import type { IntegrationPayload, ProjectDetail, TestResult } from "@/lib/api";

interface Props {
  detail: ProjectDetail;
  section: SettingsSection;
  activity: ActivityEvent[];
  onSaveIntegration: (payload: IntegrationPayload) => Promise<void>;
  onTestIntegration: (payload: IntegrationPayload) => Promise<TestResult>;
  onUpdateWorkspace: (path: string, documentPath?: string) => Promise<void>;
}

interface ProviderOption {
  label: string;
  kind: string | null;
}

interface IntegrationSectionDef {
  id: string;
  title: string;
  kinds: string[];
  options: ProviderOption[];
}

const INTEGRATION_SECTIONS: IntegrationSectionDef[] = [
  {
    id: "document",
    title: "Document",
    kinds: ["docmost", "notion", "confluence"],
    options: [
      { label: "Docmost", kind: "docmost" },
      { label: "Notion", kind: "notion" },
      { label: "Confluence", kind: "confluence" },
    ],
  },
  {
    id: "ticket",
    title: "Ticket",
    kinds: ["jira"],
    options: [
      { label: "Jira", kind: "jira" },
      { label: "ClickUp", kind: null },
      { label: "Linear", kind: null },
    ],
  },
  {
    id: "code",
    title: "Code",
    kinds: ["github"],
    options: [
      { label: "GitHub", kind: "github" },
      { label: "GitLab", kind: null },
    ],
  },
];

function CollapsibleSection({
  title,
  defaultOpen = true,
  action,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 text-sm font-medium tracking-wider text-muted-foreground uppercase"
            >
              <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
              {title}
            </button>
          </CollapsibleTrigger>
          {action}
        </div>
        <Separator />
      </div>
      <CollapsibleContent className="flex flex-col gap-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function SettingsView({
  detail,
  section,
  activity,
  onSaveIntegration,
  onTestIntegration,
  onUpdateWorkspace,
}: Props) {
  const { project, integrations } = detail;
  const [draftKinds, setDraftKinds] = useState<string[]>([]);

  const addDraft = (kind: string) =>
    setDraftKinds((current) => (current.includes(kind) ? current : [...current, kind]));
  const removeDraft = (kind: string) =>
    setDraftKinds((current) => current.filter((item) => item !== kind));

  return (
    <div className="max-w-3xl flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">{project.name}</h1>
        <p className="text-sm text-muted-foreground">
          Workspace: {project.workspace_path ?? "—"}
        </p>
      </div>

      {section === "workspace" && (
        <CollapsibleSection
          key={project.id + (project.workspace_path ?? "none")}
          title="Workspace"
        >
          <WorkspaceSection
            path={project.workspace_path}
            documentPath={project.document_path}
            onSave={onUpdateWorkspace}
          />
        </CollapsibleSection>
      )}

      {section === "integrations" && (
        <div className="flex flex-col gap-6">
          {INTEGRATION_SECTIONS.map((def) => {
            const visibleKinds = def.kinds.filter(
              (kind) =>
                integrations.some((item) => item.kind === kind) || draftKinds.includes(kind),
            );
            const showForms = visibleKinds.length > 0;

            return (
              <CollapsibleSection
                key={def.id}
                title={def.title}
                defaultOpen={showForms}
                action={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" aria-label={`Tambah ${def.title}`}>
                        <Plus />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Pilih tipe</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        {def.options.map((option) =>
                          option.kind ? (
                            <DropdownMenuItem
                              key={option.label}
                              disabled={integrations.some((item) => item.kind === option.kind) ||
                                draftKinds.includes(option.kind)}
                              onSelect={() => addDraft(option.kind!)}
                            >
                              {option.label}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem key={option.label} disabled>
                              {option.label}
                              <span className="text-muted-foreground ml-auto text-xs">segera</span>
                            </DropdownMenuItem>
                          ),
                        )}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              >
                {showForms ? (
                  <div className="flex flex-col gap-6">
                    {visibleKinds.map((kind) => {
                      const definition = SINGLETONS.find((item) => item.kind === kind);
                      if (!definition) return null;
                      const value = integrations.find((item) => item.kind === kind);
                      return (
                        <div key={kind} className="flex flex-col gap-2">
                          {def.kinds.length > 1 ? (
                            <p className="text-sm font-medium">{definition.label}</p>
                          ) : null}
                          <IntegrationForm
                            kind={kind}
                            fields={definition.fields}
                            value={value}
                            onSave={onSaveIntegration}
                            onTest={onTestIntegration}
                            onCancel={value ? undefined : () => removeDraft(kind)}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Belum ada {def.title.toLowerCase()}. Klik tombol <Plus className="inline size-3" />{" "}
                    untuk menambahkan.
                  </p>
                )}
              </CollapsibleSection>
            );
          })}
        </div>
      )}

      {section === "activity" && <ActivityFeed events={activity} />}
    </div>
  );
}

function WorkspaceSection({
  path,
  documentPath,
  onSave,
}: {
  path: string | null;
  documentPath: string | null;
  onSave: (path: string, documentPath?: string) => Promise<void>;
}) {
  const [value, setValue] = useState(path ?? "");
  const [docValue, setDocValue] = useState(documentPath ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const pickable = canPickDirectory();

  const pick = async (apply: (path: string) => void) => {
    const chosen = await chooseWorkspaceDirectory();
    if (chosen) apply(chosen);
  };

  const save = async () => {
    setBusy(true);
    setSaved(false);
    setError(undefined);
    try {
      await onSave(value.trim(), docValue.trim());
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Folder repo/proyek di komputer ini. Menu <span className="font-medium">Explorer</span> muncul
        setelah workspace diset. <span className="font-medium">Document workspace</span> adalah
        folder markdown untuk dokumen lokal (bisa disync ke Docmost nanti).
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor="workspace-path">Path workspace</Label>
        <div className="flex gap-2">
          <Input
            id="workspace-path"
            value={value}
            placeholder={pickable ? "Folder workspace…" : "/path/ke/workspace"}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => pick(setValue)}
            disabled={!pickable}
            title={pickable ? "Pilih folder" : "Folder picker hanya di app desktop"}
            aria-label="Pilih folder workspace"
          >
            <FolderOpen />
          </Button>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="document-path">Document workspace</Label>
        <div className="flex gap-2">
          <Input
            id="document-path"
            value={docValue}
            placeholder={pickable ? "Folder dokumen lokal…" : "/path/ke/dokumen"}
            onChange={(e) => {
              setDocValue(e.target.value);
              setSaved(false);
            }}
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => pick(setDocValue)}
            disabled={!pickable}
            title={pickable ? "Pilih folder" : "Folder picker hanya di app desktop"}
            aria-label="Pilih folder document workspace"
          >
            <FolderOpen />
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          Simpan
        </Button>
        {saved ? <Badge variant="success">Tersimpan</Badge> : null}
        {error ? <Badge variant="destructive">{error}</Badge> : null}
      </div>
    </div>
  );
}
