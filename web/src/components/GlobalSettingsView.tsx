import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Contrast, Monitor, Moon, Sun, Wand2 } from "lucide-react";
import type { GlobalSection } from "@/components/GlobalSettingsPanel";
import { useTheme, type EditorTheme, type Theme } from "@/components/ThemeProvider";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";

const THEME_OPTIONS: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

const EDITOR_THEME_OPTIONS: { id: EditorTheme; label: string; icon: typeof Sun }[] = [
  { id: "auto", label: "Auto", icon: Wand2 },
  { id: "vs", label: "Light", icon: Sun },
  { id: "vs-dark", label: "Dark", icon: Moon },
  { id: "hc-black", label: "HC Dark", icon: Contrast },
  { id: "hc-light", label: "HC Light", icon: Contrast },
];

export function GlobalSettingsView({ section }: { section: GlobalSection }) {
  if (section === "appearance") return <Appearance />;
  if (section === "editor") return <EditorSettings />;
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

function Appearance() {
  const { theme, setTheme } = useTheme();
  return (
    <Section title="Appearance" description="Pilih tema aplikasi.">
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
    </Section>
  );
}

function EditorSettings() {
  const { editorTheme, setEditorTheme } = useTheme();
  return (
    <Section title="Editor" description="Tema untuk text editor (Monaco).">
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
        <Row label="Name" value={health?.name ?? "RND Workflow"} />
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
