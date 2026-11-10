import * as React from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import { ThemeProvider } from "@/components/ThemeProvider";
import { applyLayoutMode, installLayoutShortcut, readLayoutMode } from "@/lib/layout-mode";
import { installZoomShortcuts } from "@/lib/zoom";
import "@/index.css";
import "@/focus-layout.css";

installZoomShortcuts();
installLayoutShortcut();
applyLayoutMode(readLayoutMode());

const container = document.getElementById("root");
if (!container) throw new Error("root element not found");

createRoot(container).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
