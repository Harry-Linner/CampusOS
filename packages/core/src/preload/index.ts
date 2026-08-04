import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("campusos", {
  shell: {
    platform: process.platform,
    phase: "workspace-persisted",
    storageMode: "sqlite"
  },
  workspace: {
    hydrate: () => ipcRenderer.invoke("campusos:workspace:hydrate"),
    sync: () => ipcRenderer.invoke("campusos:workspace:sync"),
    subscribe: (listener: () => void) => {
      const channel = "campusos:workspace:changed";
      const handler = () => listener();
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
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
  academic: {
    loadGpaWeights: () => ipcRenderer.invoke("campusos:academic:gpa-weights:load"),
    saveGpaWeights: (weights: Record<string, number>) =>
      ipcRenderer.invoke("campusos:academic:gpa-weights:save", weights)
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
  schedule: {
    loadTasks: () => ipcRenderer.invoke("campusos:schedule:tasks:load"),
    loadPeriods: (input: { startAt: string; endAt: string }) =>
      ipcRenderer.invoke("campusos:schedule:periods:load", input),
    saveTask: (input: {
      id?: string;
      description: string;
      timeSpentMinutes: number;
      timeNeededMinutes: number;
      startAt: string;
      endAt: string;
      location: string;
      title: string;
      breakable: boolean;
      type: "deadline" | "fixed";
      repeatType: "norepeat" | "days" | "month" | "year";
      repeatPeriod: number;
      repeatEndsOn: string;
      blocksPlanning: boolean;
    }) => ipcRenderer.invoke("campusos:schedule:task:save", input),
    mutateTask: (input: {
      id: string;
      status?: "running" | "suspended" | "completed" | "deleted";
      timeSpentMinutes?: number;
    }) => ipcRenderer.invoke("campusos:schedule:task:mutate", input),
    generatePlan: (settings: {
      workMinutes: number;
      restMinutes: number;
      availableStartHour: number;
      availableEndHour: number;
      horizonDays: number;
    }) => ipcRenderer.invoke("campusos:schedule:plan:generate", settings),
    loadPlan: () => ipcRenderer.invoke("campusos:schedule:plan:load"),
    exportIcal: (input: {
      academicYearStart: number;
      termLabel: string;
      includeExams?: boolean;
      includeTasks?: boolean;
    }) => ipcRenderer.invoke("campusos:schedule:ical:export", input),
    subscribe: (listener: () => void) => {
      const channel = "campusos:schedule:changed";
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
  },
  updates: {
    getAppInfo: () => ipcRenderer.invoke("campusos:app:info"),
    getStatus: () => ipcRenderer.invoke("campusos:updater:status"),
    check: () => ipcRenderer.invoke("campusos:updater:check"),
    download: () => ipcRenderer.invoke("campusos:updater:download"),
    install: () => ipcRenderer.invoke("campusos:updater:install"),
    subscribe: (listener: (status: unknown) => void) => {
      const channel = "campusos:updater:changed";
      const handler = (_event: Electron.IpcRendererEvent, status: unknown) =>
        listener(status);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
  }
});
