import { app, BrowserWindow } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerAcademicCredentialHandlers } from "./academicCredentialStore";
import {
  notifyCampusWorkspaceChanged,
  registerCampusWorkspaceHandlers,
  rescheduleCampusWorkspaceReminders,
  syncCampusWorkspace
} from "./campusWorkspaceStore";
import { registerReminderSettingsHandlers } from "./reminderSettingsStore";
import { registerPluginRuntimeHandlers } from "./pluginRuntimeIpc";
import { registerDiagnosticHandlers } from "./diagnosticLogStore";
import { registerNotificationHandlers } from "./notificationCenter";
import { registerBackupHandlers } from "./backupStore";
import {
  CAMPUSMOD_RENDERER_SCHEME
} from "./campusmodRendererProtocolPolicy";
import {
  registerCampusmodRendererProtocol,
  registerCampusmodRendererScheme
} from "./campusmodRendererProtocol";
import { initSentryMain } from "./sentryInit";
import { checkForUpdates, registerUpdateHandlers } from "./autoUpdater";
import { registerDownloadHandlers } from "./downloadIpc";
import { createWorkspaceRefreshScheduler } from "./workspaceRefreshScheduler";
import { registerScheduleHandlers } from "./scheduleIpc";
import { registerAiAssistantHandlers, createAiAssistantVault } from "./aiAssistantIpc";
import { registerBriefHandlers } from "./briefIpc";
import { createBriefService } from "./briefService";
import { createBriefStore } from "./briefStore";
import { createAiRuntime } from "./aiRuntime";
import { createBriefFetcher } from "./briefInfoSources";
import { getOfficialDatabaseService } from "./officialDatabaseService";
import {
  markDeskCalendarAppQuitting,
  notifyDeskCalendarWorkspaceChanged,
  registerDeskCalendarHandlers,
  restoreDeskCalendarWindow
} from "./deskCalendarWindow";
import {
  attachMainWindowLifecycle,
  createCampusTray,
  markCampusAppQuitting,
  registerAppLifecycleHandlers,
  showCampusMainWindow,
  shouldStartHidden
} from "./appLifecycle";
import { attachWindowStatePersistence, loadWindowState } from "./windowStateStore";
import { registerFeedbackHandlers } from "./feedbackIpc";
import { registerAnalyticsHandlers } from "./analyticsIpc";

const currentDir = dirname(fileURLToPath(import.meta.url));
registerCampusmodRendererScheme();
const workspaceRefreshScheduler = createWorkspaceRefreshScheduler({
  refresh: async () => {
    const result = await syncCampusWorkspace({ notifyGradeChanges: true });
    notifyCampusWorkspaceChanged();
    notifyDeskCalendarWorkspaceChanged();
    return result;
  }
});

const createMainWindow = async (): Promise<BrowserWindow> => {
  const savedState = await loadWindowState();
  const window = new BrowserWindow({
    width: savedState?.bounds.width ?? 1340,
    height: savedState?.bounds.height ?? 900,
    ...(savedState ? { x: savedState.bounds.x, y: savedState.bounds.y } : {}),
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#f3efe6",
    show: false,
    titleBarStyle: "hiddenInset",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(currentDir, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    }
  });
  if (savedState?.maximized) window.maximize();
  attachWindowStatePersistence(window);

  await attachMainWindowLifecycle(window);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-frame-navigate", (details) => {
    const initiatorUrl = details.initiator?.url;
    if (!initiatorUrl?.startsWith(`${CAMPUSMOD_RENDERER_SCHEME}:`)) return;
    try {
      if (new URL(details.url).origin !== new URL(initiatorUrl).origin) {
        details.preventDefault();
      }
    } catch {
      details.preventDefault();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await window.loadFile(join(currentDir, "../renderer/index.html"));
  }
  if (!shouldStartHidden()) window.show();
  return window;
};

const hasSingleInstanceLock = app.requestSingleInstanceLock();

const startCampusApp = (): void => {
  app.on("second-instance", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow().then(showCampusMainWindow);
      return;
    }
    showCampusMainWindow();
  });

  void app.whenReady().then(async () => {
    initSentryMain();
    registerCampusmodRendererProtocol();
    registerAcademicCredentialHandlers();
    registerReminderSettingsHandlers({
      onSettingsSaved: async (settings) => {
        await rescheduleCampusWorkspaceReminders(settings);
      }
    });
    registerDownloadHandlers();
    registerScheduleHandlers();
    registerAiAssistantHandlers();
    registerBriefHandlers(createBriefService({
      store: createBriefStore({ database: getOfficialDatabaseService() }),
      runtime: createAiRuntime(createAiAssistantVault()),
      fetchSources: createBriefFetcher()
    }));
    registerCampusWorkspaceHandlers();
    registerPluginRuntimeHandlers();
    registerDiagnosticHandlers();
    registerDeskCalendarHandlers();
    registerUpdateHandlers();
    registerAppLifecycleHandlers();
    registerNotificationHandlers();
    registerBackupHandlers();
    registerFeedbackHandlers();
    registerAnalyticsHandlers();
    await createMainWindow();
    await createCampusTray();
    await restoreDeskCalendarWindow();
    // The updater is intentionally started after the first window exists so
    // packaged startup status is visible through the normal renderer event.
    void checkForUpdates();
    workspaceRefreshScheduler.start();

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
      }
    });
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "未知启动错误";
    process.stderr.write(`[CampusOS] startup failed: ${message}\n`);
    app.quit();
  });
};

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  startCampusApp();
}

app.on("window-all-closed", () => undefined);

app.on("before-quit", () => {
  markCampusAppQuitting();
  markDeskCalendarAppQuitting();
  workspaceRefreshScheduler.stop();
});
