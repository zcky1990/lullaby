import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronRight, FolderOpen, Plus } from "lucide-react";
import { ActivityFeed, type ActivityEvent } from "@/components/ActivityFeed";
import { IntegrationForm } from "@/components/IntegrationForm";
import { LlmProviderForm } from "@/components/LlmProviderForm";
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
import type {
  IntegrationPayload,
  LlmProviderPayload,
  ProjectDetail,
  TestResult,
} from "@/lib/api";

interface Props {
  detail: ProjectDetail;
  section: SettingsSection;
  activity: ActivityEvent[];
  addingProvider: boolean;
  onAddProvider: (value: boolean) => void;
  onSaveIntegration: (payload: IntegrationPayload) => Promise<void>;
  onTestIntegration: (payload: IntegrationPayload) => Promise<TestResult>;
  onTestLlm: (payload: LlmProviderPayload) => Promise<TestResult>;
  onSaveLlm: (id: string | null, payload: LlmProviderPayload) => Promise<void>;
  onDeleteLlm: (id: string) => Promise<void>;
  onUpdateWorkspace: (path: string) => Promise<void>;
}

interface ProviderOption {
  label: string;
  kind: string | null;
}

interface IntegrationSectionDef {
  id: string;
  title: string;
  kind: string;
  options: ProviderOption[];
}

const INTEGRATION_SECTIONS: IntegrationSectionDef[] = [
  {
    id: "document",
    title: "Document",
    kind: "docmost",
    options: [
      { label: "Docmost", kind: "docmost" },
      { label: "Confluence", kind: null },
      { label: "Notion", kind: null },
    ],
  },
  {
    id: "ticket",
    title: "Ticket",
    kind: "jira",
    options: [
      { label: "Jira", kind: "jira" },
      { label: "ClickUp", kind: null },
      { label: "Linear", kind: null },
    ],
  },
  {
    id: "code",
    title: "Code",
    kind: "github",
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
  addingProvider,
  onAddProvider,
  onSaveIntegration,
  onTestIntegration,
  onTestLlm,
  onSaveLlm,
  onDeleteLlm,
  onUpdateWorkspace,
}: Props) {
  const { project, integrations, llmProviders } = detail;
  const [drafts, setDrafts] = useState<Record<string, string | null>>({});

  const setDraft = (id: string, kind: string | null) =>
    setDrafts((current) => ({ ...current, [id]: kind }));

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
          <WorkspaceSection path={project.workspace_path} onSave={onUpdateWorkspace} />
        </CollapsibleSection>
      )}

      {section === "integrations" && (
        <div className="flex flex-col gap-6">
          {INTEGRATION_SECTIONS.map((def) => {
            const definition = SINGLETONS.find((item) => item.kind === def.kind);
            const value = integrations.find((item) => item.kind === def.kind);
            const draft = drafts[def.id] === def.kind;
            const showForm = Boolean(value) || draft;

            return (
              <CollapsibleSection
                key={def.id}
                title={def.title}
                defaultOpen={showForm}
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
                              onSelect={() => setDraft(def.id, option.kind)}
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
                {showForm && definition ? (
                  <IntegrationForm
                    kind={def.kind}
                    fields={definition.fields}
                    value={value}
                    onSave={onSaveIntegration}
                    onTest={onTestIntegration}
                    onCancel={value ? undefined : () => setDraft(def.id, null)}
                  />
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

      {section === "llm" && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium tracking-wider text-muted-foreground uppercase">
                LLM Providers
              </h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onAddProvider(true)}
                data-icon="inline-start"
              >
                <Plus />
                Provider
              </Button>
            </div>
            <Separator />
          </div>

          {llmProviders.length === 0 && !addingProvider && (
            <p className="text-sm text-muted-foreground">
              Belum ada provider LLM. Tambahkan minimal satu untuk Planner/Coder/Verifier.
            </p>
          )}

          {llmProviders.map((provider) => (
            <CollapsibleSection
              key={provider.id + provider.updatedAt}
              title={`${provider.name}${provider.model ? ` · ${provider.model}` : ""}`}
              defaultOpen={false}
            >
              <LlmProviderForm
                provider={provider}
                onSave={(payload) => onSaveLlm(provider.id, payload)}
                onTest={onTestLlm}
                onDelete={() => onDeleteLlm(provider.id)}
              />
            </CollapsibleSection>
          ))}

          {addingProvider && (
            <CollapsibleSection title="Provider baru">
              <LlmProviderForm
                onSave={(payload) => onSaveLlm(null, payload)}
                onTest={onTestLlm}
                onDelete={async () => onAddProvider(false)}
                onCancel={() => onAddProvider(false)}
              />
            </CollapsibleSection>
          )}
        </div>
      )}

      {section === "activity" && <ActivityFeed events={activity} />}
    </div>
  );
}

function WorkspaceSection({
  path,
  onSave,
}: {
  path: string | null;
  onSave: (path: string) => Promise<void>;
}) {
  const [value, setValue] = useState(path ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const pickable = canPickDirectory();

  const pick = async () => {
    const chosen = await chooseWorkspaceDirectory();
    if (chosen) setValue(chosen);
  };

  const save = async () => {
    setBusy(true);
    setSaved(false);
    setError(undefined);
    try {
      await onSave(value.trim());
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
        setelah workspace diset.
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor="workspace-path">Path</Label>
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
            onClick={pick}
            disabled={!pickable}
            title={pickable ? "Pilih folder" : "Folder picker hanya di app desktop"}
            aria-label="Pilih folder workspace"
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
