import { contextBridge, ipcRenderer } from "electron";
import type { DeskCalendarView } from "@campusos/shared";

contextBridge.exposeInMainWorld("deskCalendar", {
  loadSettings: () => ipcRenderer.invoke("campusos:desk-calendar:settings:load"),
  setView: (view: DeskCalendarView) =>
    ipcRenderer.invoke("campusos:desk-calendar:settings:save", { view }),
  close: () => ipcRenderer.invoke("campusos:desk-calendar:window:close"),
  openMain: () => ipcRenderer.invoke("campusos:desk-calendar:window:open-main"),
  loadSnapshot: () => ipcRenderer.invoke("campusos:desk-calendar:window:snapshot"),
  subscribe: (listener: (message: unknown) => void) => {
    const channel = "campusos:desk-calendar:snapshot";
    const handler = (_event: Electron.IpcRendererEvent, message: unknown) =>
      listener(message);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
});
