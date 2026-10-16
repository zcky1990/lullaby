import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export type EditorTheme = "auto" | "vs" | "vs-dark" | "hc-black" | "hc-light";

const STORAGE_KEY = "rnd.theme:v1";
const EDITOR_KEY = "rnd.editorTheme:v1";

interface ThemeContextValue {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  editorTheme: EditorTheme;
  resolvedEditorTheme: string;
  setEditorTheme: (theme: EditorTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  resolved: "dark",
  setTheme: () => {},
  editorTheme: "auto",
  resolvedEditorTheme: "vs-dark",
  setEditorTheme: () => {},
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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [editorTheme, setEditorThemeState] = useState<EditorTheme>(readEditorTheme);
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

  const resolvedEditorTheme =
    editorTheme === "auto" ? (resolved === "dark" ? "vs-dark" : "vs") : editorTheme;

  return (
    <ThemeContext.Provider
      value={{ theme, resolved, setTheme, editorTheme, resolvedEditorTheme, setEditorTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
