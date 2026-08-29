import { contextBridge, ipcRenderer } from "electron";
import type { DeskCalendarWidgetData } from "@campusos/shared";

contextBridge.exposeInMainWorld("deskCalendarWidget", {
  loadData: () => ipcRenderer.invoke("campusos:desk-calendar-widget:data:load") as Promise<DeskCalendarWidgetData>,
  refreshWeather: () => ipcRenderer.invoke("campusos:desk-calendar-widget:weather:refresh"),
  saveSettings: (patch: unknown) => ipcRenderer.invoke("campusos:desk-calendar-widget:settings:update", patch),
  close: () => ipcRenderer.invoke("campusos:desk-calendar-widget:close"),
  subscribe: (listener: () => void) => {
    const channel = "campusos:desk-calendar:changed";
    const handler = () => listener();
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
});
