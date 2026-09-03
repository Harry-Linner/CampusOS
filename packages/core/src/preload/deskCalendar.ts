import { contextBridge, ipcRenderer } from "electron";

// 桌面日历窗口的受控桥：只暴露渲染需要的只读数据 + 窗口/贴底控制。
contextBridge.exposeInMainWorld("deskCalendar", {
  platform: process.platform,
  getCalendarData: () => ipcRenderer.invoke("campusos:desk-calendar:data"),
  subscribe: (listener: (data: unknown) => void) => {
    const channel = "campusos:desk-calendar:changed";
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => listener(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  setTransparency: (value: number) => ipcRenderer.send("campusos:desk-calendar:transparency", value),
  getSettings: () => ipcRenderer.invoke("campusos:desk-calendar:settings:load"),
  saveSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke("campusos:desk-calendar:settings:save", patch),
  subscribeSettings: (listener: (settings: unknown) => void) => {
    const channel = "campusos:desk-calendar:settings-changed";
    const handler = (_event: Electron.IpcRendererEvent, settings: unknown) => listener(settings);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  onOpenSettings: (listener: () => void) => {
    const channel = "campusos:desk-calendar:open-settings";
    const handler = () => listener();
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  completeTask: (id: string, completed: boolean) =>
    ipcRenderer.invoke("campusos:desk-calendar:complete-task", id, completed),
  createEvent: (input: Record<string, unknown>) =>
    ipcRenderer.invoke("campusos:desk-calendar:create-event", input),
  moveWindow: (dx: number, dy: number) => ipcRenderer.send("campusos:desk-calendar:drag-move", { dx, dy }),
  dragEnd: () => ipcRenderer.send("campusos:desk-calendar:drag-end"),
  closeWindow: () => ipcRenderer.send("campusos:desk-calendar:close")
});
