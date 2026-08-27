import { contextBridge, ipcRenderer } from "electron";
import type { DeskCalendarView, LocalTaskInput } from "@campusos/shared";

contextBridge.exposeInMainWorld("deskCalendar", {
  loadSettings: () => ipcRenderer.invoke("campusos:desk-calendar:settings:load"),
  setView: (view: DeskCalendarView) =>
    ipcRenderer.invoke("campusos:desk-calendar:settings:save", { view }),
  setShowClock: (showClock: boolean) =>
    ipcRenderer.invoke("campusos:desk-calendar:settings:save", { showClock }),
  saveSettings: (patch: unknown) =>
    ipcRenderer.invoke("campusos:desk-calendar:settings:save", patch),
  refreshWeather: () => ipcRenderer.invoke("campusos:desk-calendar:weather:refresh"),
  close: () => ipcRenderer.invoke("campusos:desk-calendar:window:close"),
  openMain: (entityId: string) =>
    ipcRenderer.invoke("campusos:desk-calendar:window:open-main", { entityId }),
  completeTask: (taskId: string, options?: { status?: "running" | "completed" }) =>
    ipcRenderer.invoke("campusos:desk-calendar:task:complete", { taskId, ...(options?.status ? { status: options.status } : {}) }),
  saveTask: (input: LocalTaskInput) =>
    ipcRenderer.invoke("campusos:desk-calendar:task:save", input),
  loadSnapshot: () => ipcRenderer.invoke("campusos:desk-calendar:window:snapshot"),
  subscribe: (listener: (message: unknown) => void) => {
    const channel = "campusos:desk-calendar:snapshot";
    const handler = (_event: Electron.IpcRendererEvent, message: unknown) =>
      listener(message);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
});
