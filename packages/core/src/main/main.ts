import { app, BrowserWindow, screen } from "electron";
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
import {
  appendDiagnosticEntry,
  registerDiagnosticHandlers
} from "./diagnosticLogStore";
import { pluginRefreshCoordinator } from "./refreshCoordinator";
import { registerExportHandlers } from "./exportIpc";
import {
  invariantFailures,
  registerCoreInvariants,
  registerInvariantHandlers,
  runInvariants
} from "./invariants";
import { addNotification, markNotificationsReadByTarget, registerNotificationHandlers } from "./notificationCenter";
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
import type { AcademicQueryDataReader } from "./academicQuery";
import { readAcademicCredentialRecord } from "./academicCredentialStore";
import { getOfficialCapabilityRepository } from "./officialCapabilityRepository";
import { registerBriefHandlers } from "./briefIpc";
import { createBriefService } from "./briefService";
import { createBriefStore } from "./briefStore";
import { createCampusFeedService } from "./campusFeedService";
import { registerCampusFeedHandlers } from "./campusFeedIpc";
import { saveScheduleTask } from "./scheduleIpc";
import { createBriefFetcher } from "./briefInfoSources";
import { getOfficialDatabaseService } from "./officialDatabaseService";
import { registerAcademicCalendarHandlers } from "./academicCalendarStore";
import {
  registerDeskCalendarHostHandlers,
  killDeskCalendar
} from "./deskCalendarHost";
import {
  attachMainWindowLifecycle,
  createCampusTray,
  markCampusAppQuitting,
  registerAppLifecycleHandlers,
  showCampusMainWindow,
  shouldStartHidden
} from "./appLifecycle";
import { attachWindowStatePersistence, loadWindowState, resolveWindowPlacement } from "./windowStateStore";
import { registerFeedbackHandlers } from "./feedbackIpc";
import { registerAnalyticsHandlers } from "./analyticsIpc";

const currentDir = dirname(fileURLToPath(import.meta.url));
registerCampusmodRendererScheme();
const workspaceRefreshScheduler = createWorkspaceRefreshScheduler({
  refresh: async () => {
    const result = await syncCampusWorkspace({ notifyGradeChanges: true });
    notifyCampusWorkspaceChanged();
    return result;
  }
});

const createMainWindow = async (): Promise<BrowserWindow> => {
  const savedState = await loadWindowState();
  const defaultWidth = 1340;
  const defaultHeight = 900;
  // 一律落在主屏（当前主显示器），跨屏/偏到其它屏时钳制到主屏内，避免横在 2 号屏。
  const primary = screen.getPrimaryDisplay();
  const mainArea = primary.workArea;
  let bounds: { x: number; y: number; width: number; height: number };
  if (savedState) {
    // 恢复记忆位置；仅当横跨多个显示器时才归位到主屏，避免横在 1 号屏和 2 号屏之间。
    bounds = resolveWindowPlacement(
      { x: savedState.bounds.x, y: savedState.bounds.y, width: savedState.bounds.width, height: savedState.bounds.height },
      screen.getAllDisplays(),
      mainArea
    );
  } else {
    bounds = {
      x: mainArea.x + Math.max(0, Math.round((mainArea.width - defaultWidth) / 2)),
      y: mainArea.y + Math.max(0, Math.round((mainArea.height - defaultHeight) / 2)),
      width: defaultWidth,
      height: defaultHeight
    };
  }
  const window = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
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

// Dev-only CDP endpoint so external visual tooling can enumerate and capture
// every WebContents (main window + desk calendar overlay) independently.
// Opt-in via env var; never active in packaged builds or normal dev runs.
if (!app.isPackaged && process.env.CAMPUSOS_DEV_CDP_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.CAMPUSOS_DEV_CDP_PORT);
}

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
    registerExportHandlers();
    registerAcademicCalendarHandlers();
    registerDeskCalendarHostHandlers();
    const academicQueryData: AcademicQueryDataReader = {
      loadVerifiedStudentId: async () => {
        const record = await readAcademicCredentialRecord();
        return record.verificationState === "verified" && record.authenticatedProfile
          ? record.authenticatedProfile.studentId
          : null;
      },
      readCapability: <T,>(capability: import("@campusos/shared").PluginCapability) =>
        getOfficialCapabilityRepository().read<T>(capability)
    };
    registerAiAssistantHandlers({ academicData: academicQueryData });
    const briefVault = createAiAssistantVault();
    registerBriefHandlers(createBriefService({
      store: createBriefStore({ database: getOfficialDatabaseService() }),
      fetchSources: createBriefFetcher(),
      encryptSecret: (value) => briefVault.encrypt(value),
      decryptSecret: (value) => briefVault.decrypt(value),
      recordDiagnostic: appendDiagnosticEntry
    }));
    registerCampusFeedHandlers(createCampusFeedService({
      database: getOfficialDatabaseService(),
      notify: (input) => addNotification({ kind: "system", ...input, showDesktop: false }),
      encryptSecret: (value) => briefVault.encrypt(value),
      decryptSecret: (value) => briefVault.decrypt(value),
      onItemsRead: () => markNotificationsReadByTarget("campus-feed"),
      recordDiagnostic: appendDiagnosticEntry,
      saveTask: async (input) => {
        const result = await saveScheduleTask(input);
        return {
          created: result.operation?.kind === "created" ? 1 : 0,
          deduplicated: result.operation?.kind === "deduplicated" ? 1 : 0
        };
      }
    }));
    registerCampusWorkspaceHandlers();
    registerPluginRuntimeHandlers();
    registerDiagnosticHandlers({
      probeSource: async (sourceId) => pluginRefreshCoordinator.runOne(sourceId)
    });
    registerCoreInvariants();
    registerInvariantHandlers();
    void runInvariants().then((results) => {
      for (const failure of invariantFailures(results)) {
        process.stderr.write(
          `[CampusOS] invariant failed (${failure.severity}): ${failure.name} — ${failure.message}\n`
        );
      }
    });
    registerUpdateHandlers();
    registerAppLifecycleHandlers();
    registerNotificationHandlers();
    registerBackupHandlers();
    registerFeedbackHandlers();
    registerAnalyticsHandlers();
    await createMainWindow();
    await createCampusTray();
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
  killDeskCalendar();
  workspaceRefreshScheduler.stop();
});
