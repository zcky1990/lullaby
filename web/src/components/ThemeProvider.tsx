import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export type EditorTheme = "auto" | "vs" | "vs-dark" | "hc-black" | "hc-light";
export type ThemePreset = "vscode" | "shadcn" | "claude" | "supabase";
export type AppFont = "system" | "inter" | "manrope" | "jetbrains";
export type EditorFont = "jetbrains" | "fira" | "menlo" | "consolas" | "monospace";
export type IconSize = "sm" | "md" | "lg";
export type IconWeight = "light" | "regular" | "bold";

const STORAGE_KEY = "rnd.theme:v1";
const EDITOR_KEY = "rnd.editorTheme:v1";
const COLOR_THEME_KEY = "rnd.colorTheme:v1";
const APP_FONT_KEY = "rnd.appFont:v1";
const EDITOR_FONT_KEY = "rnd.editorFont:v1";
const EDITOR_FONT_SIZE_KEY = "rnd.editorFontSize:v1";
const ICON_SIZE_KEY = "rnd.iconSize:v1";
const ICON_WEIGHT_KEY = "rnd.iconWeight:v1";

export const APP_FONT_STACKS: Record<AppFont, string> = {
  system:
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  inter: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  manrope: 'Manrope, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  jetbrains: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
};

export const EDITOR_FONT_STACKS: Record<EditorFont, string> = {
  jetbrains: '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fira: '"Fira Code", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
  menlo: 'Menlo, Monaco, Consolas, "Courier New", monospace',
  consolas: 'Consolas, "Courier New", Menlo, Monaco, monospace',
  monospace: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
};

interface ThemeContextValue {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  editorTheme: EditorTheme;
  resolvedEditorTheme: string;
  setEditorTheme: (theme: EditorTheme) => void;
  appFont: AppFont;
  setAppFont: (font: AppFont) => void;
  editorFont: EditorFont;
  setEditorFont: (font: EditorFont) => void;
  editorFontSize: number;
  setEditorFontSize: (size: number) => void;
  colorTheme: ThemePreset;
  setColorTheme: (theme: ThemePreset) => void;
  iconSize: IconSize;
  setIconSize: (size: IconSize) => void;
  iconWeight: IconWeight;
  setIconWeight: (weight: IconWeight) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  resolved: "dark",
  setTheme: () => {},
  editorTheme: "auto",
  resolvedEditorTheme: "vs-dark",
  setEditorTheme: () => {},
  appFont: "system",
  setAppFont: () => {},
  editorFont: "jetbrains",
  setEditorFont: () => {},
  editorFontSize: 13,
  setEditorFontSize: () => {},
  colorTheme: "shadcn",
  setColorTheme: () => {},
  iconSize: "md",
  setIconSize: () => {},
  iconWeight: "regular",
  setIconWeight: () => {},
});

function readTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // ignore
  }
  return "system";
}

function readEditorTheme(): EditorTheme {
  try {
    const value = localStorage.getItem(EDITOR_KEY);
    if (
      value === "auto" ||
      value === "vs" ||
      value === "vs-dark" ||
      value === "hc-black" ||
      value === "hc-light"
    ) {
      return value;
    }
  } catch {
    // ignore
  }
  return "auto";
}

function readString<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    if (value && (allowed as readonly string[]).includes(value)) return value as T;
  } catch {
    // ignore
  }
  return fallback;
}

function readNumber(key: string, allowed: readonly number[], fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key));
    if (allowed.includes(value)) return value;
  } catch {
    // ignore
  }
  return fallback;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [editorTheme, setEditorThemeState] = useState<EditorTheme>(readEditorTheme);
  const [colorTheme, setColorThemeState] = useState<ThemePreset>(() =>
    readString(
      COLOR_THEME_KEY,
      ["vscode", "shadcn", "claude", "supabase"] as const,
      "vscode",
    )
  );
  const [appFont, setAppFontState] = useState<AppFont>(() =>
    readString(APP_FONT_KEY, ["system", "inter", "manrope", "jetbrains"] as const, "system")
  );
  const [editorFont, setEditorFontState] = useState<EditorFont>(() =>
    readString(
      EDITOR_FONT_KEY,
      ["jetbrains", "fira", "menlo", "consolas", "monospace"] as const,
      "jetbrains",
    )
  );
  const [editorFontSize, setEditorFontSizeState] = useState<number>(() =>
    readNumber(EDITOR_FONT_SIZE_KEY, [12, 13, 14, 15, 16] as const, 13)
  );
  const [iconSize, setIconSizeState] = useState<IconSize>(() =>
    readString(ICON_SIZE_KEY, ["sm", "md", "lg"] as const, "md")
  );
  const [iconWeight, setIconWeightState] = useState<IconWeight>(() =>
    readString(ICON_WEIGHT_KEY, ["light", "regular", "bold"] as const, "regular")
  );
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : true
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);

  const resolved: ResolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  useEffect(() => {
    document.documentElement.dataset.theme = colorTheme;
  }, [colorTheme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--app-font", APP_FONT_STACKS[appFont]);
  }, [appFont]);

  useEffect(() => {
    document.documentElement.dataset.iconSize = iconSize;
  }, [iconSize]);

  useEffect(() => {
    document.documentElement.dataset.iconWeight = iconWeight;
  }, [iconWeight]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  const setEditorTheme = (next: EditorTheme) => {
    setEditorThemeState(next);
    try {
      localStorage.setItem(EDITOR_KEY, next);
    } catch {
      // ignore
    }
  };

  const setColorTheme = (next: ThemePreset) => {
    setColorThemeState(next);
    try {
      localStorage.setItem(COLOR_THEME_KEY, next);
    } catch {
      // ignore
    }
  };

  const setAppFont = (next: AppFont) => {
    setAppFontState(next);
    try {
      localStorage.setItem(APP_FONT_KEY, next);
    } catch {
      // ignore
    }
  };

  const setEditorFont = (next: EditorFont) => {
    setEditorFontState(next);
    try {
      localStorage.setItem(EDITOR_FONT_KEY, next);
    } catch {
      // ignore
    }
  };

  const setEditorFontSize = (next: number) => {
    setEditorFontSizeState(next);
    try {
      localStorage.setItem(EDITOR_FONT_SIZE_KEY, String(next));
    } catch {
      // ignore
    }
  };

  const setIconSize = (next: IconSize) => {
    setIconSizeState(next);
    try {
      localStorage.setItem(ICON_SIZE_KEY, next);
    } catch {
      // ignore
    }
  };

  const setIconWeight = (next: IconWeight) => {
    setIconWeightState(next);
    try {
      localStorage.setItem(ICON_WEIGHT_KEY, next);
    } catch {
      // ignore
    }
  };

  const resolvedEditorTheme =
    editorTheme === "auto" ? (resolved === "dark" ? "vs-dark" : "vs") : editorTheme;

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolved,
        setTheme,
        editorTheme,
        resolvedEditorTheme,
        setEditorTheme,
        appFont,
        setAppFont,
        editorFont,
        setEditorFont,
        editorFontSize,
        setEditorFontSize,
        colorTheme,
        setColorTheme,
        iconSize,
        setIconSize,
        iconWeight,
        setIconWeight,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
