import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { resolveThemeMode, type ThemeMode } from "./hooks/useTheme";
import "./globals.css";

// Apply persisted theme before first paint
(function initTheme() {
  const stored = globalThis.localStorage?.getItem("campusos.theme");
  const mode: ThemeMode =
    stored === "system" || stored === "light" || stored === "dark" || stored === "high-contrast"
      ? stored
      : "system";
  document.documentElement.setAttribute("data-theme", resolveThemeMode(mode));
  // Keep the stored preference in sync with what initTheme actually applied.
  try {
    globalThis.localStorage?.setItem("campusos.theme", mode);
  } catch {
    // Ignore
  }
})();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
