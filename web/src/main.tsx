import * as React from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import { ThemeProvider } from "@/components/ThemeProvider";
import { EventsProvider } from "@/lib/events-provider";
import { I18nProvider } from "@/lib/i18n";
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
      <I18nProvider>
        <EventsProvider>
          <App />
        </EventsProvider>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
