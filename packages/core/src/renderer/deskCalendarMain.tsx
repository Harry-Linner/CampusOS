import React from "react";
import ReactDOM from "react-dom/client";
import type { DeskCalendarSnapshotMessage, DeskCalendarView } from "@campusos/shared";
import { DeskCalendarApp, type DeskCalendarWindowApi } from "./DeskCalendarApp";

declare global {
  interface Window {
    deskCalendar: {
      loadSettings: () => Promise<{ view: DeskCalendarView }>;
      setView: (view: DeskCalendarView) => Promise<unknown>;
      close: () => Promise<unknown>;
      openMain: () => Promise<unknown>;
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
