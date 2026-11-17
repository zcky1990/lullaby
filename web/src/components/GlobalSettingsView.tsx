import type { ReactNode } from "react";
import { Suspense, lazy, useEffect, useState, useSyncExternalStore } from "react";
import { Contrast, Monitor, Moon, Sun, Wand2 } from "lucide-react";
import type { GlobalSection } from "@/components/GlobalSettingsPanel";
import { LanguageSettings } from "@/components/LanguageSettings";
import {
  useTheme,
  type AppFont,
  type EditorFont,
  type EditorTheme,
  type IconSize,
  type IconWeight,
  type Theme,
  type ThemePreset,
} from "@/components/ThemeProvider";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/lib/i18n";
import {
  isMonacoTypeScriptServiceEnabled,
  setMonacoTypeScriptServiceEnabled,
  subscribeMonacoSettings,
} from "@/lib/monaco-settings";
import {
  api,
  type LlmProvider,
  type LlmProviderPayload,
  type Role,
  type TestResult,
} from "@/lib/api";

// PERF-7: tiap section Global Settings (±130 KB total) dimuat saat section-nya
// dibuka, bukan ikut di chunk utama.
const AutomationSettings = lazy(() =>
  import("@/components/AutomationSettings").then((module) => ({
    default: module.AutomationSettings,
  }))
);
const BackupSettings = lazy(() =>
  import("@/components/BackupSettings").then((module) => ({ default: module.BackupSettings }))
);
const ChatToolsSettings = lazy(() =>
  import("@/components/ChatToolsSettings").then((module) => ({
    default: module.ChatToolsSettings,
  }))
);
const LayoutSettings = lazy(() =>
  import("@/components/LayoutSettings").then((module) => ({ default: module.LayoutSettings }))
);
const LlmProvidersSettings = lazy(() =>
  import("@/components/LlmProvidersSettings").then((module) => ({
    default: module.LlmProvidersSettings,
  }))
);
const LspSettingsPanel = lazy(() =>
  import("@/components/LspSettings").then((module) => ({ default: module.LspSettingsPanel }))
);
const McpSettings = lazy(() =>
  import("@/components/McpSettings").then((module) => ({ default: module.McpSettings }))
);
const NotificationSettings = lazy(() =>
  import("@/components/NotificationSettings").then((module) => ({
    default: module.NotificationSettings,
  }))
);
const PromptsSettings = lazy(() =>
  import("@/components/PromptsSettings").then((module) => ({ default: module.PromptsSettings }))
);
const RolesSettings = lazy(() =>
  import("@/components/RolesSettings").then((module) => ({ default: module.RolesSettings }))
);
const SkillsSettings = lazy(() =>
  import("@/components/SkillsSettings").then((module) => ({ default: module.SkillsSettings }))
);
const TerminalSettings = lazy(() =>
  import("@/components/TerminalSettings").then((module) => ({ default: module.TerminalSettings }))
);

const THEME_OPTIONS: { id: Theme; labelKey: string; icon: typeof Sun }[] = [
  { id: "light", labelKey: "settings.global.theme.light", icon: Sun },
  { id: "dark", labelKey: "settings.global.theme.dark", icon: Moon },
  { id: "system", labelKey: "settings.global.theme.system", icon: Monitor },
];

const COLOR_THEME_OPTIONS: { id: ThemePreset; labelKey: string; descriptionKey: string }[] = [
  {
    id: "lullaby",
    labelKey: "settings.global.colorTheme.lullaby",
    descriptionKey: "settings.global.colorTheme.lullabyDescription",
  },
  {
    id: "vscode",
    labelKey: "settings.global.colorTheme.vscode",
    descriptionKey: "settings.global.colorTheme.vscodeDescription",
  },
  {
    id: "shadcn",
    labelKey: "settings.global.colorTheme.shadcn",
    descriptionKey: "settings.global.colorTheme.shadcnDescription",
  },
  {
    id: "claude",
    labelKey: "settings.global.colorTheme.claude",
    descriptionKey: "settings.global.colorTheme.claudeDescription",
  },
  {
    id: "supabase",
    labelKey: "settings.global.colorTheme.supabase",
    descriptionKey: "settings.global.colorTheme.supabaseDescription",
  },
];

const APP_FONT_OPTIONS: { id: AppFont; labelKey: string }[] = [
  { id: "system", labelKey: "settings.global.font.system" },
  { id: "inter", labelKey: "settings.global.font.inter" },
  { id: "manrope", labelKey: "settings.global.font.manrope" },
  { id: "jetbrains", labelKey: "settings.global.font.jetbrains" },
];

const EDITOR_FONT_OPTIONS: { id: EditorFont; labelKey: string }[] = [
  { id: "jetbrains", labelKey: "settings.global.font.jetbrains" },
  { id: "fira", labelKey: "settings.global.font.fira" },
  { id: "menlo", labelKey: "settings.global.font.menlo" },
  { id: "consolas", labelKey: "settings.global.font.consolas" },
  { id: "monospace", labelKey: "settings.global.font.monospace" },
];

const EDITOR_SIZE_OPTIONS = [12, 13, 14, 15, 16];
const CHAT_SIZE_OPTIONS = [12, 13, 14, 15, 16, 18, 20];

const ICON_SIZE_OPTIONS: { id: IconSize; labelKey: string }[] = [
  { id: "sm", labelKey: "settings.global.iconSize.sm" },
  { id: "md", labelKey: "settings.global.iconSize.md" },
  { id: "lg", labelKey: "settings.global.iconSize.lg" },
];

const ICON_WEIGHT_OPTIONS: { id: IconWeight; labelKey: string }[] = [
  { id: "light", labelKey: "settings.global.iconWeight.light" },
  { id: "regular", labelKey: "settings.global.iconWeight.regular" },
  { id: "bold", labelKey: "settings.global.iconWeight.bold" },
];

const EDITOR_THEME_OPTIONS: { id: EditorTheme; labelKey: string; icon: typeof Sun }[] = [
  { id: "auto", labelKey: "settings.global.editorTheme.auto", icon: Wand2 },
  { id: "vs", labelKey: "settings.global.editorTheme.light", icon: Sun },
  { id: "vs-dark", labelKey: "settings.global.editorTheme.dark", icon: Moon },
  { id: "hc-black", labelKey: "settings.global.editorTheme.hcDark", icon: Contrast },
  { id: "hc-light", labelKey: "settings.global.editorTheme.hcLight", icon: Contrast },
];

interface Props {
  section: GlobalSection;
  projectId: string | null;
  llmProviders: LlmProvider[];
  addingProvider: boolean;
  onAddProvider: (value: boolean) => void;
  onTestLlm: (payload: LlmProviderPayload, providerId?: string) => Promise<TestResult>;
  onSaveLlm: (id: string | null, payload: LlmProviderPayload) => Promise<void>;
  onDeleteLlm: (id: string) => Promise<void>;
  roles: Role[];
  addingRole: boolean;
  onAddRole: (value: boolean) => void;
  onSaveRole: (id: string | null, payload: {
    name: string;
    description?: string;
    persona: string;
    providerId?: string;
  }) => Promise<void>;
  onDeleteRole: (id: string) => Promise<void>;
}

export function GlobalSettingsView(props: Props) {
  const { t } = useI18n();
  return (
    <Suspense fallback={<p className="text-xs text-muted-foreground">{t("common.loading")}</p>}>
      <GlobalSettingsSections {...props} />
    </Suspense>
  );
}

function GlobalSettingsSections({
  section,
  projectId,
  llmProviders,
  addingProvider,
  onAddProvider,
  onTestLlm,
  onSaveLlm,
  onDeleteLlm,
  roles,
  addingRole,
  onAddRole,
  onSaveRole,
  onDeleteRole,
}: Props) {
  if (section === "appearance") {
    return (
      <div className="flex flex-col gap-8">
        <LanguageSettings />
        <Appearance />
        <LayoutSettings />
        <EditorSettings />
        <ChatSettings />
        <IconSettings />
      </div>
    );
  }
  if (section === "llm") {
    return (
      <LlmProvidersSettings
        providers={llmProviders}
        addingProvider={addingProvider}
        onAddProvider={onAddProvider}
        onTestLlm={onTestLlm}
        onSaveLlm={onSaveLlm}
        onDeleteLlm={onDeleteLlm}
      />
    );
  }
  if (section === "roles") {
    return (
      <RolesSettings
        roles={roles}
        providers={llmProviders}
        addingRole={addingRole}
        onAddRole={onAddRole}
        onSaveRole={onSaveRole}
        onDeleteRole={onDeleteRole}
      />
    );
  }
  if (section === "prompts") return <PromptsSettings />;
  if (section === "mcp") return <McpSettings />;
  if (section === "skills") return <SkillsSettings projectId={projectId} />;
  if (section === "tools") return <ChatToolsSettings />;
  if (section === "lsp") return <LspSettingsPanel />;
  if (section === "automation") return <AutomationSettings />;
  if (section === "notifications") return <NotificationSettings />;
  if (section === "terminal") return <TerminalSettings />;
  if (section === "backup") {
    return <BackupSettings scope="global" projectId={projectId} />;
  }
  return <About />;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {title}
        </h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        <Separator />
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Appearance() {
  const { t } = useI18n();
  const { theme, setTheme, appFont, setAppFont, colorTheme, setColorTheme } = useTheme();
  return (
    <Section
      title={t("settings.global.appearance.title")}
      description={t("settings.global.appearance.description")}
    >
      <div className="flex flex-col gap-4">
        <Field label={t("settings.global.appearance.colorTheme")}>
          <ToggleGroup
            type="single"
            variant="outline"
            value={colorTheme}
            onValueChange={(value) => value && setColorTheme(value as ThemePreset)}
            className="w-fit"
          >
            {COLOR_THEME_OPTIONS.map((option) => (
              <ToggleGroupItem
                key={option.id}
                value={option.id}
                aria-label={t(option.labelKey)}
                title={t(option.descriptionKey)}
              >
                {t(option.labelKey)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field label={t("settings.global.appearance.mode")}>
          <ToggleGroup
            type="single"
            variant="outline"
            value={theme}
            onValueChange={(value) => value && setTheme(value as Theme)}
            className="w-fit"
          >
            {THEME_OPTIONS.map((option) => (
              <ToggleGroupItem
                key={option.id}
                value={option.id}
                aria-label={t(option.labelKey)}
              >
                <option.icon />
                {t(option.labelKey)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field label={t("settings.global.appearance.appFont")}>
          <Select value={appFont} onValueChange={(value) => setAppFont(value as AppFont)}>
            <SelectTrigger
              size="sm"
              className="w-56"
              aria-label={t("settings.global.appearance.appFont")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {APP_FONT_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </div>
    </Section>
  );
}

function EditorSettings() {
  const { t } = useI18n();
  const {
    editorTheme,
    setEditorTheme,
    editorFont,
    setEditorFont,
    editorFontSize,
    setEditorFontSize,
  } = useTheme();
  // PERF-3: preferensi ini dibaca `lib/monaco` sebelum editor dibuat, jadi
  // sumbernya `lib/monaco-settings` (localStorage), bukan ui_preferences.
  const typeScriptService = useSyncExternalStore(
    subscribeMonacoSettings,
    isMonacoTypeScriptServiceEnabled,
    isMonacoTypeScriptServiceEnabled,
  );
  return (
    <Section
      title={t("settings.global.editor.title")}
      description={t("settings.global.editor.description")}
    >
      <div className="flex flex-col gap-4">
        <Field label={t("settings.global.editor.theme")}>
          <ToggleGroup
            type="single"
            variant="outline"
            value={editorTheme}
            onValueChange={(value) => value && setEditorTheme(value as EditorTheme)}
            className="w-fit"
          >
            {EDITOR_THEME_OPTIONS.map((option) => (
              <ToggleGroupItem
                key={option.id}
                value={option.id}
                aria-label={t(option.labelKey)}
              >
                <option.icon />
                {t(option.labelKey)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <div className="flex flex-wrap gap-4">
          <Field label={t("settings.global.editor.font")}>
            <Select value={editorFont} onValueChange={(value) => setEditorFont(value as EditorFont)}>
              <SelectTrigger
                size="sm"
                className="w-56"
                aria-label={t("settings.global.editor.font")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {EDITOR_FONT_OPTIONS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {t(option.labelKey)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("settings.global.editor.fontSize")}>
            <Select
              value={String(editorFontSize)}
              onValueChange={(value) => setEditorFontSize(Number(value))}
            >
              <SelectTrigger
                size="sm"
                className="w-24"
                aria-label={t("settings.global.editor.fontSizeAria")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {EDITOR_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}px
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label={t("settings.global.editor.typeScriptService")}>
          <div className="flex items-start gap-2">
            <Switch
              id="monaco-typescript-service"
              checked={typeScriptService}
              onCheckedChange={(checked) => setMonacoTypeScriptServiceEnabled(checked)}
              aria-label={t("settings.global.editor.typeScriptService")}
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor="monaco-typescript-service">
                {t("settings.global.editor.typeScriptLabel")}
              </Label>
              <p className="max-w-md text-xs text-muted-foreground">
                {t("settings.global.editor.typeScriptHint")}
              </p>
            </div>
          </div>
        </Field>
      </div>
    </Section>
  );
}

function ChatSettings() {
  const { t } = useI18n();
  const { chatFont, setChatFont, chatFontSize, setChatFontSize } = useTheme();
  return (
    <Section
      title={t("settings.global.chat.title")}
      description={t("settings.global.chat.description")}
    >
      <div className="flex flex-wrap gap-4">
        <Field label={t("settings.global.chat.font")}>
          <Select value={chatFont} onValueChange={(value) => setChatFont(value as AppFont)}>
            <SelectTrigger size="sm" className="w-56" aria-label={t("settings.global.chat.font")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {APP_FONT_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("settings.global.chat.size")}>
          <Select
            value={String(chatFontSize)}
            onValueChange={(value) => setChatFontSize(Number(value))}
          >
            <SelectTrigger size="sm" className="w-24" aria-label={t("settings.global.chat.size")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {CHAT_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}px
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="chat-surface max-w-md rounded-md border bg-muted/30 p-3">
        <p className="font-medium">{t("settings.global.chat.previewTitle")}</p>
        <p className="text-muted-foreground">{t("settings.global.chat.previewBody")}</p>
      </div>
    </Section>
  );
}

function IconSettings() {
  const { t } = useI18n();
  const { iconSize, setIconSize, iconWeight, setIconWeight } = useTheme();
  return (
    <Section
      title={t("settings.global.icons.title")}
      description={t("settings.global.icons.description")}
    >
      <div className="flex flex-wrap gap-4">
        <Field label={t("settings.global.icons.size")}>
          <Select value={iconSize} onValueChange={(value) => setIconSize(value as IconSize)}>
            <SelectTrigger size="sm" className="w-40" aria-label={t("settings.global.icons.size")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {ICON_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("settings.global.icons.weight")}>
          <Select value={iconWeight} onValueChange={(value) => setIconWeight(value as IconWeight)}>
            <SelectTrigger size="sm" className="w-40" aria-label={t("settings.global.icons.weight")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {ICON_WEIGHT_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </div>
    </Section>
  );
}

interface Health {
  name: string;
  version: string;
  dataDir: string;
}

function About() {
  const { t } = useI18n();
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    api
      .health()
      .then((data) => setHealth(data))
      .catch(() => setHealth(null));
  }, []);

  return (
    <Section title={t("settings.global.about.title")}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <img
            src="/lullaby.webp"
            alt="Lullaby"
            className="size-20 shrink-0 rounded-xl object-cover shadow-sm"
          />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm font-semibold tracking-tight">Lullaby</p>
            <p className="text-xs text-muted-foreground italic">
              Let Developers Dream, We'll Handle the Work.
            </p>
            <p className="text-xs text-muted-foreground">
              {t("settings.global.about.description")}
            </p>
          </div>
        </div>
        <div className="grid gap-2 text-xs">
          <Row label={t("settings.global.about.name")} value={health?.name ?? "Lullaby"} />
          <Row label={t("settings.global.about.version")} value={health?.version ?? "—"} />
          <Row label={t("settings.global.about.dataDir")} value={health?.dataDir ?? "—"} />
        </div>
      </div>
    </Section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="break-all">{value}</span>
    </div>
  );
}
