import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./theme.css";

// Apply persisted theme before first paint
(function initTheme() {
  const stored = globalThis.localStorage?.getItem("campusos.theme");
  const theme = stored === "dark" || stored === "high-contrast" ? stored : "light";
  document.documentElement.setAttribute("data-theme", theme);
})();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
