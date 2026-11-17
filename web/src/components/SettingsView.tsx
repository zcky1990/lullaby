import type { ReactNode } from "react";
import { Suspense, lazy, useState } from "react";
import { ChevronRight, FolderOpen, GitBranchPlus, Plus } from "lucide-react";
import { ActivityFeed, type ActivityEvent } from "@/components/ActivityFeed";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { canPickDirectory, chooseWorkspaceDirectory } from "@/lib/bindings";
import { useI18n } from "@/lib/i18n";
import { SINGLETONS } from "@/lib/integrations";
import { cn } from "@/lib/utils";
import type { IntegrationPayload, Project, ProjectDetail, TestResult } from "@/lib/api";

// PERF-7: form integrasi + backup hanya dimuat saat section-nya dibuka.
const BackupSettings = lazy(() =>
  import("@/components/BackupSettings").then((module) => ({ default: module.BackupSettings }))
);
const IntegrationForm = lazy(() =>
  import("@/components/IntegrationForm").then((module) => ({ default: module.IntegrationForm }))
);

interface Props {
  detail: ProjectDetail;
  section: SettingsSection;
  activity: ActivityEvent[];
  onSaveIntegration: (payload: IntegrationPayload) => Promise<void>;
  onTestIntegration: (payload: IntegrationPayload) => Promise<TestResult>;
  onUpdateWorkspace: (path: string, documentPath?: string) => Promise<void>;
  onCloneRepository: (input: {
    url: string;
    protocol: "https" | "ssh";
  }) => Promise<Project>;
}

interface ProviderOption {
  label: string;
  kind: string | null;
}

interface IntegrationSectionDef {
  id: string;
  titleKey: string;
  kinds: string[];
  options: ProviderOption[];
}

const INTEGRATION_SECTIONS: IntegrationSectionDef[] = [
  {
    id: "document",
    titleKey: "settings.project.sectionDocument",
    kinds: ["docmost", "notion", "confluence"],
    options: [
      { label: "Docmost", kind: "docmost" },
      { label: "Notion", kind: "notion" },
      { label: "Confluence", kind: "confluence" },
    ],
  },
  {
    id: "ticket",
    titleKey: "settings.project.sectionTicket",
    kinds: ["jira", "clickup"],
    options: [
      { label: "Jira", kind: "jira" },
      { label: "ClickUp", kind: "clickup" },
      { label: "Linear", kind: null },
    ],
  },
  {
    id: "code",
    titleKey: "settings.project.sectionCode",
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
              className="flex items-center gap-2 text-xs font-medium tracking-wider text-muted-foreground uppercase"
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
  onCloneRepository,
}: Props) {
  const { project, integrations } = detail;
  const [draftKinds, setDraftKinds] = useState<string[]>([]);
  const { t } = useI18n();

  const addDraft = (kind: string) =>
    setDraftKinds((current) => (current.includes(kind) ? current : [...current, kind]));
  const removeDraft = (kind: string) =>
    setDraftKinds((current) => current.filter((item) => item !== kind));

  return (
    <Suspense
      fallback={<p className="text-xs text-muted-foreground">{t("settings.project.loading")}</p>}
    >
      <div className="flex w-full flex-col gap-8">
        <div>
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <p className="text-xs text-muted-foreground">
            {t("settings.project.workspaceInfo", { path: project.workspace_path ?? "—" })}
          </p>
        </div>

        {section === "workspace" && (
          <>
            <CollapsibleSection
              key={project.id + (project.workspace_path ?? "none")}
              title={t("settings.project.workspace")}
            >
              <WorkspaceSection
                path={project.workspace_path}
                documentPath={project.document_path}
                onSave={onUpdateWorkspace}
              />
            </CollapsibleSection>
            <CollapsibleSection
              title={t("settings.project.cloneRepository")}
              defaultOpen={!!project.workspace_path}
            >
              <CloneSection
                workspacePath={project.workspace_path}
                onClone={onCloneRepository}
              />
            </CollapsibleSection>
          </>
        )}

        {section === "integrations" && (
          <div className="flex flex-col gap-6">
            {INTEGRATION_SECTIONS.map((def) => {
              const title = t(def.titleKey);
              const visibleKinds = def.kinds.filter(
                (kind) =>
                  integrations.some((item) => item.kind === kind) || draftKinds.includes(kind),
              );
              const showForms = visibleKinds.length > 0;

              return (
                <CollapsibleSection
                  key={def.id}
                  title={title}
                  defaultOpen={showForms}
                  action={
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("settings.project.addSection", { section: title })}
                        >
                          <Plus />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>{t("settings.project.chooseType")}</DropdownMenuLabel>
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
                                <span className="text-muted-foreground ml-auto text-xs">
                                  {t("settings.project.comingSoon")}
                                </span>
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
                              <p className="text-xs font-medium">{definition.label}</p>
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
                    <p className="text-xs text-muted-foreground">
                      {t("settings.project.emptySection", { section: title.toLowerCase() })}{" "}
                      <Plus className="inline size-3" />{" "}
                      {t("settings.project.emptySectionOutro")}
                    </p>
                  )}
                </CollapsibleSection>
              );
            })}
          </div>
        )}

        {section === "activity" && <ActivityFeed events={activity} />}

        {section === "backup" && <BackupSettings scope="project" projectId={project.id} />}
      </div>
    </Suspense>
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
  const { t } = useI18n();

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
      <p className="text-xs text-muted-foreground">
        {t("settings.project.workspaceFormDescription")}{" "}
        <span className="font-medium">{t("settings.project.explorer")}</span>{" "}
        {t("settings.project.workspaceFormDescriptionMid")}{" "}
        <span className="font-medium">{t("settings.project.documentWorkspace")}</span>{" "}
        {t("settings.project.workspaceFormDescriptionOutro")}
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor="workspace-path">{t("settings.project.workspacePath")}</Label>
        <div className="flex gap-2">
          <Input
            id="workspace-path"
            value={value}
            placeholder={pickable
              ? t("settings.project.workspacePlaceholder")
              : "/path/ke/workspace"}
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
            title={pickable
              ? t("settings.project.pickFolder")
              : t("settings.project.pickFolderDesktopOnly")}
            aria-label={t("settings.project.pickWorkspaceFolderAria")}
          >
            <FolderOpen />
          </Button>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="document-path">{t("settings.project.documentWorkspace")}</Label>
        <div className="flex gap-2">
          <Input
            id="document-path"
            value={docValue}
            placeholder={pickable
              ? t("settings.project.documentPlaceholder")
              : "/path/ke/dokumen"}
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
            title={pickable
              ? t("settings.project.pickFolder")
              : t("settings.project.pickFolderDesktopOnly")}
            aria-label={t("settings.project.pickDocumentFolderAria")}
          >
            <FolderOpen />
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          {t("common.save")}
        </Button>
        {saved ? <Badge variant="success">{t("common.saved")}</Badge> : null}
        {error ? <Badge variant="destructive">{error}</Badge> : null}
      </div>
    </div>
  );
}

function CloneSection({
  workspacePath,
  onClone,
}: {
  workspacePath: string | null;
  onClone: (input: {
    url: string;
    protocol: "https" | "ssh";
  }) => Promise<Project>;
}) {
  const [url, setUrl] = useState("");
  const [protocol, setProtocol] = useState<"https" | "ssh">("https");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const ready = Boolean(workspacePath?.trim());
  const { t } = useI18n();

  const clone = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || !ready || busy) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await onClone({ url: trimmedUrl, protocol });
      setMessage(t("settings.project.cloneDone", { path: workspacePath ?? "" }));
      setUrl("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {t("settings.project.cloneDescription")}
      </p>
      {!ready ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.project.cloneNeedPathBefore")}{" "}
          <span className="font-medium">{t("settings.project.workspacePath")}</span>{" "}
          {t("settings.project.cloneNeedPathAfter")}
        </p>
      ) : (
        <p className="text-xs">
          {t("settings.project.cloneTarget")}{" "}
          <span className="font-mono text-xs">{workspacePath}</span>
        </p>
      )}
      <div className="grid gap-1.5">
        <Label>{t("settings.project.protocol")}</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={protocol}
          onValueChange={(value) => {
            if (value === "https" || value === "ssh") {
              setProtocol(value);
              setMessage(undefined);
            }
          }}
          disabled={!ready || busy}
        >
          <ToggleGroupItem value="https" aria-label={t("settings.project.cloneViaHttps")}>
            HTTPS
          </ToggleGroupItem>
          <ToggleGroupItem value="ssh" aria-label={t("settings.project.cloneViaSsh")}>
            SSH
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="clone-url">{t("settings.project.repository")}</Label>
        <Input
          id="clone-url"
          value={url}
          placeholder={
            protocol === "ssh"
              ? "git@github.com:org/repo.git atau org/repo"
              : "https://github.com/org/repo.git atau org/repo"
          }
          disabled={!ready || busy}
          onChange={(e) => {
            setUrl(e.target.value);
            setMessage(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") clone();
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={clone}
          disabled={busy || !ready || !url.trim()}
          data-icon="inline-start"
        >
          <GitBranchPlus />
          {busy ? t("settings.project.cloning") : t("settings.project.clone")}
        </Button>
        {message ? <Badge variant="success">{message}</Badge> : null}
        {error ? <Badge variant="destructive">{error}</Badge> : null}
      </div>
    </div>
  );
}
