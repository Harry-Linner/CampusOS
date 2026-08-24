import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("campusos", {
  shell: {
    platform: process.platform,
    phase: "workspace-persisted",
    storageMode: "sqlite"
  },
  navigation: {
    subscribe: (listener: (request: unknown) => void) => {
      const channel = "campusos:navigation:request";
      const handler = (_event: Electron.IpcRendererEvent, request: unknown) => listener(request);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
  },
  feedback: {
    openIssue: () => ipcRenderer.invoke("campusos:feedback:open")
  },
  analytics: {
    load: () => ipcRenderer.invoke("campusos:analytics:load"),
    setConsent: (consent: boolean) => ipcRenderer.invoke("campusos:analytics:set-consent", consent),
    track: (event: string) => ipcRenderer.invoke("campusos:analytics:track", event)
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
    saveSettings: (input: {
      enabled: boolean;
      leadMinutes: number[];
      gradeChangesEnabled?: boolean;
    }) =>
      ipcRenderer.invoke("campusos:reminders:settings:save", input),
    loadScheduleState: () =>
      ipcRenderer.invoke("campusos:reminders:schedule-state:load")
  },
  academic: {},
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
    open: (id: string) => ipcRenderer.invoke("campusos:downloads:open", id),
    reveal: (id: string) => ipcRenderer.invoke("campusos:downloads:reveal", id),
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
      repeatType: "norepeat" | "days" | "weeks" | "weekdays" | "month" | "year";
      repeatPeriod: number;
      repeatEndsOn: string;
      repeatWeekdays?: number[];
      blocksPlanning: boolean;
      courseName?: string | null;
      source?: { kind: "ai-assistant"; fingerprint: string; provider: string; model: string; importedAt: string } | null;
    }) => ipcRenderer.invoke("campusos:schedule:task:save", input),
    mutateTask: (input: {
      id: string;
      status?: "running" | "suspended" | "completed" | "deleted";
      action?: "restore" | "purge";
      scope?: "single" | "future" | "series";
      includeCompleted?: boolean;
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
  deskCalendar: {
    loadSettings: () => ipcRenderer.invoke("campusos:desk-calendar:settings:load"),
    setEnabled: (enabled: boolean) =>
      ipcRenderer.invoke("campusos:desk-calendar:settings:save", { enabled }),
    setView: (view: "month" | "week" | "day") =>
      ipcRenderer.invoke("campusos:desk-calendar:settings:save", { view }),
    subscribe: (listener: () => void) => {
      const channel = "campusos:desk-calendar:changed";
      const handler = () => listener();
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
  },
  assistant: {
    loadSettings: () => ipcRenderer.invoke("campusos:assistant:settings:load"),
    saveSettings: (input: { apiKey: string; provider: string; protocol: string; baseUrl: string; model: string }) =>
      ipcRenderer.invoke("campusos:assistant:settings:save", input),
    clearSettings: () => ipcRenderer.invoke("campusos:assistant:settings:clear"),
    testConnection: (input: { apiKey: string; provider: string; protocol: string; baseUrl: string; model: string }) =>
      ipcRenderer.invoke("campusos:assistant:test-connection", input),
    parseMessage: (input: { text: string; courseNames: string[]; now: string; source?: { app: string; conversationId?: string | null; messageId?: string | null; sender?: string | null; sentAt?: string | null } }) =>
      ipcRenderer.invoke("campusos:assistant:parse", input),
    discoverModels: (input: { apiKey: string; provider: string; protocol: string; baseUrl: string }) =>
      ipcRenderer.invoke("campusos:assistant:models:discover", input)
  },
  brief: {
    getState: () => ipcRenderer.invoke("campusos:brief:get"),
    refresh: () => ipcRenderer.invoke("campusos:brief:refresh"),
    openExternal: (fingerprint: string) =>
      ipcRenderer.invoke("campusos:brief:open-external", fingerprint),
    loadSettings: () => ipcRenderer.invoke("campusos:brief:settings:load"),
    saveSettings: (input: {
      interests: { name: string; weight: number; note?: string | null }[];
      sourceEnabled: Record<string, boolean>;
    }) => ipcRenderer.invoke("campusos:brief:settings:save", input),
    subscribe: (listener: (state: unknown) => void) => {
      const channel = "campusos:brief:changed";
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) =>
        listener(state);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
  },
  campusFeed: {
    getSnapshot: () => ipcRenderer.invoke("campusos:campus-feed:get"),
    refreshSource: (sourceId: string) => ipcRenderer.invoke("campusos:campus-feed:refresh-source", sourceId),
    refreshAll: () => ipcRenderer.invoke("campusos:campus-feed:refresh-all"),
    updateSource: (id: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke("campusos:campus-feed:update-source", { id, patch }),
    removeSource: (id: string) => ipcRenderer.invoke("campusos:campus-feed:remove-source", id),
    markRead: (ids: string[]) => ipcRenderer.invoke("campusos:campus-feed:mark-read", ids),
    openExternal: (url: string) => ipcRenderer.invoke("campusos:campus-feed:open-external", url),
    loadAiSettings: () => ipcRenderer.invoke("campusos:campus-feed:ai-settings-load"),
    saveAiSettings: (input: Record<string, unknown> | null) =>
      ipcRenderer.invoke("campusos:campus-feed:ai-settings-save", input),
    testAiConnection: (input: Record<string, unknown>) =>
      ipcRenderer.invoke("campusos:campus-feed:ai-test", input),
    extractScheduleCandidates: (itemIds: string[]) =>
      ipcRenderer.invoke("campusos:campus-feed:ai-extract", itemIds),
    createScheduleTasks: (candidates: Record<string, unknown>[]) =>
      ipcRenderer.invoke("campusos:campus-feed:ai-create-tasks", candidates),
    subscribe: (listener: (snapshot: unknown) => void) => {
      const channel = "campusos:campus-feed:changed";
      const handler = (_event: Electron.IpcRendererEvent, snapshot: unknown) => listener(snapshot);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
  },
  plugins: {
    load: () => ipcRenderer.invoke("campusos:plugins:load"),
    subscribe: (listener: (snapshot: unknown) => void) => {
      const channel = "campusos:plugins:changed";
      const handler = (_event: Electron.IpcRendererEvent, snapshot: unknown) => listener(snapshot);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
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
    checkUpdates: () => ipcRenderer.invoke("campusos:plugins:update:check"),
    updatePackage: (candidate: unknown) => ipcRenderer.invoke("campusos:plugins:update:apply", candidate),
    readCapability: (input: { pluginId: string; capability: string }) =>
      ipcRenderer.invoke("campusos:plugins:capability:read", input)
  },
  diagnostics: {
    load: () => ipcRenderer.invoke("campusos:diagnostics:load"),
    clear: () => ipcRenderer.invoke("campusos:diagnostics:clear"),
    exportTxt: () => ipcRenderer.invoke("campusos:diagnostics:export"),
    health: () => ipcRenderer.invoke("campusos:diagnostics:health"),
    probe: (sourceId: string) =>
      ipcRenderer.invoke("campusos:diagnostics:probe", sourceId)
  },
  backup: {
    export: () => ipcRenderer.invoke("campusos:backup:export"),
    preview: () => ipcRenderer.invoke("campusos:backup:preview"),
    restore: (mode: "merge" | "replace") => ipcRenderer.invoke("campusos:backup:restore", mode)
  },
  notifications: {
    load: () => ipcRenderer.invoke("campusos:notifications:load"),
    markRead: (id: string) => ipcRenderer.invoke("campusos:notifications:read", id),
    markHandled: (id: string) => ipcRenderer.invoke("campusos:notifications:handled", id),
    clearExpired: () => ipcRenderer.invoke("campusos:notifications:clear-expired"),
    subscribe: (listener: () => void) => {
      const channel = "campusos:notifications:changed";
      const handler = () => listener();
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
  },
  lifecycle: {
    load: () => ipcRenderer.invoke("campusos:lifecycle:load"),
    save: (patch: { launchAtLogin?: boolean; closeBehavior?: "ask" | "hide-to-tray" | "quit"; notificationEnabled?: boolean; notificationPrompted?: boolean }) =>
      ipcRenderer.invoke("campusos:lifecycle:save", patch)
  },
  updates: {
    getAppInfo: () => ipcRenderer.invoke("campusos:app:info"),
    getStatus: () => ipcRenderer.invoke("campusos:updater:status"),
    check: () => ipcRenderer.invoke("campusos:updater:check"),
    download: () => ipcRenderer.invoke("campusos:updater:download"),
    cancelDownload: () => ipcRenderer.invoke("campusos:updater:cancel"),
    dismiss: (version: string) => ipcRenderer.invoke("campusos:updater:dismiss", version),
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
