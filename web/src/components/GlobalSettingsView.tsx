import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Contrast, Monitor, Moon, Sun, Wand2 } from "lucide-react";
import type { GlobalSection } from "@/components/GlobalSettingsPanel";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AutomationSettings } from "@/components/AutomationSettings";
import { LlmProvidersSettings } from "@/components/LlmProvidersSettings";
import { LspSettingsPanel } from "@/components/LspSettings";
import { McpSettings } from "@/components/McpSettings";
import { PromptsSettings } from "@/components/PromptsSettings";
import { RolesSettings } from "@/components/RolesSettings";
import { SkillsSettings } from "@/components/SkillsSettings";
import { TerminalSettings } from "@/components/TerminalSettings";
import {
  api,
  type LlmProvider,
  type LlmProviderPayload,
  type Role,
  type TestResult,
} from "@/lib/api";

const THEME_OPTIONS: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

const COLOR_THEME_OPTIONS: { id: ThemePreset; label: string; description: string }[] = [
  { id: "vscode", label: "VS Code", description: "Tampilan VS Code (biru, abu-abu gelap)" },
  { id: "shadcn", label: "shadcn", description: "Neutral hitam-putih" },
  { id: "claude", label: "Claude", description: "Krem hangat dengan aksen terracotta" },
  { id: "supabase", label: "Supabase", description: "Hijau emerald dengan nuansa gelap" },
];

const APP_FONT_OPTIONS: { id: AppFont; label: string }[] = [
  { id: "system", label: "System" },
  { id: "inter", label: "Inter" },
  { id: "manrope", label: "Manrope" },
  { id: "jetbrains", label: "JetBrains Mono" },
];

const EDITOR_FONT_OPTIONS: { id: EditorFont; label: string }[] = [
  { id: "jetbrains", label: "JetBrains Mono" },
  { id: "fira", label: "Fira Code" },
  { id: "menlo", label: "Menlo" },
  { id: "consolas", label: "Consolas" },
  { id: "monospace", label: "Monospace" },
];

const EDITOR_SIZE_OPTIONS = [12, 13, 14, 15, 16];

const ICON_SIZE_OPTIONS: { id: IconSize; label: string }[] = [
  { id: "sm", label: "Compact" },
  { id: "md", label: "Normal" },
  { id: "lg", label: "Large" },
];

const ICON_WEIGHT_OPTIONS: { id: IconWeight; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "regular", label: "Regular" },
  { id: "bold", label: "Bold" },
];

const EDITOR_THEME_OPTIONS: { id: EditorTheme; label: string; icon: typeof Sun }[] = [
  { id: "auto", label: "Auto", icon: Wand2 },
  { id: "vs", label: "Light", icon: Sun },
  { id: "vs-dark", label: "Dark", icon: Moon },
  { id: "hc-black", label: "HC Dark", icon: Contrast },
  { id: "hc-light", label: "HC Light", icon: Contrast },
];

export function GlobalSettingsView({
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
}: {
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
}) {
  if (section === "appearance") {
    return (
      <div className="flex flex-col gap-8">
        <Appearance />
        <EditorSettings />
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
  if (section === "lsp") return <LspSettingsPanel />;
  if (section === "automation") return <AutomationSettings />;
  if (section === "terminal") return <TerminalSettings />;
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
        <h2 className="text-sm font-medium tracking-wider text-muted-foreground uppercase">
          {title}
        </h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
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
  const { theme, setTheme, appFont, setAppFont, colorTheme, setColorTheme } = useTheme();
  return (
    <Section title="Appearance" description="Tema warna dan font aplikasi.">
      <div className="flex flex-col gap-4">
        <Field label="Color theme">
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
                aria-label={option.label}
                title={option.description}
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field label="Mode">
          <ToggleGroup
            type="single"
            variant="outline"
            value={theme}
            onValueChange={(value) => value && setTheme(value as Theme)}
            className="w-fit"
          >
            {THEME_OPTIONS.map((option) => (
              <ToggleGroupItem key={option.id} value={option.id} aria-label={option.label}>
                <option.icon />
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field label="Font aplikasi">
          <Select value={appFont} onValueChange={(value) => setAppFont(value as AppFont)}>
            <SelectTrigger size="sm" className="w-56" aria-label="Font aplikasi">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {APP_FONT_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
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
  const {
    editorTheme,
    setEditorTheme,
    editorFont,
    setEditorFont,
    editorFontSize,
    setEditorFontSize,
  } = useTheme();
  return (
    <Section title="Editor" description="Tema, font, dan ukuran text editor (Monaco).">
      <div className="flex flex-col gap-4">
        <Field label="Tema editor">
          <ToggleGroup
            type="single"
            variant="outline"
            value={editorTheme}
            onValueChange={(value) => value && setEditorTheme(value as EditorTheme)}
            className="w-fit"
          >
            {EDITOR_THEME_OPTIONS.map((option) => (
              <ToggleGroupItem key={option.id} value={option.id} aria-label={option.label}>
                <option.icon />
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <div className="flex flex-wrap gap-4">
          <Field label="Font editor">
            <Select value={editorFont} onValueChange={(value) => setEditorFont(value as EditorFont)}>
              <SelectTrigger size="sm" className="w-56" aria-label="Font editor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {EDITOR_FONT_OPTIONS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Ukuran font">
            <Select
              value={String(editorFontSize)}
              onValueChange={(value) => setEditorFontSize(Number(value))}
            >
              <SelectTrigger size="sm" className="w-24" aria-label="Ukuran font editor">
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
      </div>
    </Section>
  );
}

function IconSettings() {
  const { iconSize, setIconSize, iconWeight, setIconWeight } = useTheme();
  return (
    <Section title="Icons" description="Ukuran dan ketebalan ikon antarmuka.">
      <div className="flex flex-wrap gap-4">
        <Field label="Ukuran ikon">
          <Select value={iconSize} onValueChange={(value) => setIconSize(value as IconSize)}>
            <SelectTrigger size="sm" className="w-40" aria-label="Ukuran ikon">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {ICON_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Ketebalan ikon">
          <Select value={iconWeight} onValueChange={(value) => setIconWeight(value as IconWeight)}>
            <SelectTrigger size="sm" className="w-40" aria-label="Ketebalan ikon">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {ICON_WEIGHT_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
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
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    api
      .health()
      .then((data) => setHealth(data))
      .catch(() => setHealth(null));
  }, []);

  return (
    <Section title="About">
      <div className="grid gap-2 text-sm">
        <Row label="Name" value={health?.name ?? "Lullaby IDE"} />
        <Row label="Version" value={health?.version ?? "—"} />
        <Row label="Data dir" value={health?.dataDir ?? "—"} />
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
