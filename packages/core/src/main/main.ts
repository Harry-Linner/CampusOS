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
import {
  CAMPUSMOD_RENDERER_SCHEME
} from "./campusmodRendererProtocolPolicy";
import {
  registerCampusmodRendererProtocol,
  registerCampusmodRendererScheme
} from "./campusmodRendererProtocol";
import { initSentryMain } from "./sentryInit";
import { checkForUpdates, registerUpdateHandlers } from "./autoUpdater";
import { registerPluginHotReloadHandlers } from "./pluginHotReload";
import { registerDownloadHandlers } from "./downloadIpc";
import { createWorkspaceRefreshScheduler } from "./workspaceRefreshScheduler";
import { registerScheduleHandlers } from "./scheduleIpc";
import { registerAcademicGpaHandlers } from "./academicGpaIpc";

const currentDir = dirname(fileURLToPath(import.meta.url));
registerCampusmodRendererScheme();
const workspaceRefreshScheduler = createWorkspaceRefreshScheduler({
  refresh: async () => {
    const result = await syncCampusWorkspace({ notifyGradeChanges: true });
    notifyCampusWorkspaceChanged();
    return result;
  }
});

const createMainWindow = async (): Promise<void> => {
  const window = new BrowserWindow({
    width: 1340,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#f3efe6",
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
};

app.whenReady().then(async () => {
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
  registerAcademicGpaHandlers();
  registerCampusWorkspaceHandlers();
  registerPluginRuntimeHandlers();
  registerDiagnosticHandlers();
  registerPluginHotReloadHandlers();
  registerUpdateHandlers();
  await createMainWindow();
  // The updater is intentionally started after the first window exists so
  // packaged startup status is visible through the normal renderer event.
  void checkForUpdates();
  workspaceRefreshScheduler.start();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  workspaceRefreshScheduler.stop();
});
