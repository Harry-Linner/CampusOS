import React from "react";
import ReactDOM from "react-dom/client";
import type {
  DeskCalendarWidgetData,
  DeskCalendarWeather
} from "@campusos/shared";
import { DeskCalendarWidgetApp } from "./DeskCalendarWidgetApp";

declare global {
  interface Window {
    deskCalendarWidget: {
      loadData: () => Promise<DeskCalendarWidgetData>;
      refreshWeather: () => Promise<DeskCalendarWeather>;
      saveSettings: (patch: unknown) => Promise<unknown>;
      close: () => Promise<void>;
      subscribe: (listener: () => void) => () => void;
    };
  }
}

// 组件窗与主窗口同源时共享 localStorage 的 `campusos.theme`，跟随主应用主题
// （与 main.tsx 的 applyTheme 一致）。不同源时退化为默认浅色。
const stored = globalThis.localStorage?.getItem("campusos.theme");
const dataTheme =
  stored === "system" || stored === "light" || stored === "dark" || stored === "high-contrast"
    ? stored === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
      : stored
    : "light";
document.documentElement.setAttribute("data-theme", dataTheme);

const api = window.deskCalendarWidget;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DeskCalendarWidgetApp api={api} />
  </React.StrictMode>
);
