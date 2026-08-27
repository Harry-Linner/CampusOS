import React from "react";
import ReactDOM from "react-dom/client";
import type { DeskCalendarSettings, DeskCalendarSnapshotMessage, DeskCalendarView, DeskCalendarWeather, LocalTaskInput } from "@campusos/shared";
import { DeskCalendarApp, type DeskCalendarWindowApi } from "./DeskCalendarApp";

declare global {
  interface Window {
    deskCalendar: {
      loadSettings: () => Promise<DeskCalendarSettings>;
      setView: (view: DeskCalendarView) => Promise<unknown>;
      setShowClock: (showClock: boolean) => Promise<unknown>;
      saveSettings: (patch: Partial<DeskCalendarSettings>) => Promise<unknown>;
      refreshWeather: () => Promise<DeskCalendarWeather>;
      close: () => Promise<unknown>;
      openMain: (entityId: string) => Promise<unknown>;
      completeTask: (taskId: string, options?: { status?: "running" | "completed" }) => Promise<unknown>;
      saveTask: (input: LocalTaskInput) => Promise<unknown>;
      loadSnapshot: () => Promise<DeskCalendarSnapshotMessage>;
      subscribe: (listener: (message: DeskCalendarSnapshotMessage) => void) => () => void;
    };
  }
}

const api: DeskCalendarWindowApi = window.deskCalendar;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DeskCalendarApp api={api} />
  </React.StrictMode>
);
