import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("campusos", {
  shell: {
    platform: process.platform,
    phase: "workspace-persisted",
    storageMode: "sqlite"
  },
  workspace: {
    hydrate: () => ipcRenderer.invoke("campusos:workspace:hydrate"),
    sync: () => ipcRenderer.invoke("campusos:workspace:sync")
  },
  credentials: {
    academicAffairs: {
      load: () => ipcRenderer.invoke("campusos:credentials:academic-affairs:load"),
      connect: (input: { username: string; password: string }) =>
        ipcRenderer.invoke("campusos:credentials:academic-affairs:connect", input),
      clear: () => ipcRenderer.invoke("campusos:credentials:academic-affairs:clear")
    }
  },
  reminders: {
    loadSettings: () => ipcRenderer.invoke("campusos:reminders:settings:load"),
    saveSettings: (input: { enabled: boolean; leadMinutes: number[] }) =>
      ipcRenderer.invoke("campusos:reminders:settings:save", input),
    loadScheduleState: () =>
      ipcRenderer.invoke("campusos:reminders:schedule-state:load")
  },
  downloads: {
    list: () => ipcRenderer.invoke("campusos:downloads:list"),
    enqueue: (input: {
      url: string;
      title: string;
      courseName: string;
      sourceId: string;
      semester: string;
    }) => ipcRenderer.invoke("campusos:downloads:enqueue", input),
    pause: (id: string) => ipcRenderer.invoke("campusos:downloads:pause", id),
    resume: (id: string) => ipcRenderer.invoke("campusos:downloads:resume", id),
    cancel: (id: string) => ipcRenderer.invoke("campusos:downloads:cancel", id),
    subscribe: (listener: () => void) => {
      const channel = "campusos:downloads:changed";
      const handler = () => listener();
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
  },
  plugins: {
    load: () => ipcRenderer.invoke("campusos:plugins:load"),
    configure: (input: {
      pluginId: string;
      enabled: boolean;
      grantedPermissions: string[];
    }) => ipcRenderer.invoke("campusos:plugins:configure", input),
    selectPackage: () => ipcRenderer.invoke("campusos:plugins:package:select"),
    discardPackage: (token: string) =>
      ipcRenderer.invoke("campusos:plugins:package:discard", token),
    installPackage: (token: string) =>
      ipcRenderer.invoke("campusos:plugins:package:install", token),
    loadPackages: () => ipcRenderer.invoke("campusos:plugins:package:load"),
    uninstallPackage: (pluginId: string) =>
      ipcRenderer.invoke("campusos:plugins:package:uninstall", pluginId),
    readCapability: (input: { pluginId: string; capability: string }) =>
      ipcRenderer.invoke("campusos:plugins:capability:read", input)
  },
  diagnostics: {
    load: () => ipcRenderer.invoke("campusos:diagnostics:load"),
    clear: () => ipcRenderer.invoke("campusos:diagnostics:clear"),
    exportTxt: () => ipcRenderer.invoke("campusos:diagnostics:export")
  }
});
