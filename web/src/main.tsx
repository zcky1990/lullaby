import * as React from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import { ThemeProvider } from "@/components/ThemeProvider";
import { installZoomShortcuts } from "@/lib/zoom";
import "@/index.css";

installZoomShortcuts();

const container = document.getElementById("root");
if (!container) throw new Error("root element not found");

createRoot(container).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
