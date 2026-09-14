import { app, BrowserWindow, screen } from "electron";
import { randomUUID } from "node:crypto";
import type { AiAssistantExtractedField, AiAssistantExtractionResult, DesktopPetInput } from "@campusos/shared";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerAcademicCredentialHandlers, requestZjuItcPage } from "./academicCredentialStore";
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
import { addNotification, markNotificationsHandledByEntities, registerNotificationHandlers, suppressNotifications } from "./notificationCenter";
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
import { createAiAssistantService, type AiAssistantVault } from "./aiAssistantService";
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
  writeDeskCalendarFeed,
  killDeskCalendar,
  restoreDeskCalendarOnCampusStart
} from "./deskCalendarHost";
import { closeOfficialDatabaseService } from "./officialDatabaseService";
import { resetOfficialCapabilityRepository } from "./officialCapabilityRepository";
import {
  attachMainWindowLifecycle,
  campusIconPath,
  createCampusTray,
  rebuildTrayMenu,
  markCampusAppQuitting,
  registerAppLifecycleHandlers,
  navigateCampusMainWindow,
  showCampusMainWindow,
  shouldStartHidden
} from "./appLifecycle";
import { registerDesktopPetHost, type DesktopPetHost } from "./desktopPetHost";
import { attachWindowStatePersistence, loadWindowState } from "./windowStateStore";
import { registerFeedbackHandlers } from "./feedbackIpc";
import { registerAnalyticsHandlers } from "./analyticsIpc";
import { createAccountProfileStore } from "./accountProfileStore";
import { getAccountBrowserSession } from "./accountBrowserSession";

const currentDir = dirname(fileURLToPath(import.meta.url));

// Windows 的任务栏按钮、固定图标与通知身份由 AppUserModelID 决定，跟窗口图标无关。
// 不设置时 Electron 用 `electron.app.<exe ProductName>`：开发态落到 electron.exe，任务栏
// 与通知都退回 Electron 图标。这里与 electron-builder 的 appId 对齐——NSIS 安装包创建的
// 快捷方式写同一个值；开发态（以及未安装直接跑 dist/win-unpacked）需要先运行
// `pnpm register:windows-identity` 注册同名快捷方式，因为 Windows 找不到身份注册时会直接
// 丢弃该进程的桌面通知。
const CAMPUSOS_APP_ID = "io.github.harry-linner.campusos";
// Toast 激活 CLSID 必须跨运行固定：Electron 默认每次运行随机生成一个，和开始菜单
// 快捷方式里烘焙的值不一致时，Windows 会收下通知却不显示横幅。安装包里的快捷方式
// 需要写同一个值（scripts/register-windows-identity.cjs 使用同一常量）。
const CAMPUSOS_TOAST_ACTIVATOR_CLSID = "{7C4E1F62-9A31-4B58-9E7D-2B6E3F5A81C4}";
const windowsIdentityShortcutExists = (): boolean => {
  const names = ["CampusOS.lnk"];
  const roots = [
    join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs"),
    process.env.ProgramData
      ? join(process.env.ProgramData, "Microsoft", "Windows", "Start Menu", "Programs")
      : ""
  ];
  return roots.some((root) => root !== "" && names.some((name) => existsSync(join(root, name))));
};
if (process.platform === "win32") {
  app.setAppUserModelId(CAMPUSOS_APP_ID);
  app.setToastActivatorCLSID(CAMPUSOS_TOAST_ACTIVATOR_CLSID);
  if (!windowsIdentityShortcutExists()) {
    process.stderr.write(
      "[CampusOS] Windows 通知身份未注册：先运行 pnpm register:windows-identity，否则桌面通知不会显示，任务栏也仍是 Electron 图标。\n"
    );
  }
}

registerCampusmodRendererScheme();
const workspaceRefreshScheduler = createWorkspaceRefreshScheduler({
  refresh: async () => {
    const result = await syncCampusWorkspace({ notifyGradeChanges: true, background: true });
    notifyCampusWorkspaceChanged();
    await writeDeskCalendarFeed();
    return result;
  }
});

const createMainWindow = async (): Promise<BrowserWindow> => {
  const savedState = await loadWindowState();
  const defaultWidth = 1340;
  const defaultHeight = 900;
  // Without a saved position, prefer a secondary display so the primary
  // screen stays free for the user; fall back to the primary display.
  // E2E fixture runs use a fresh user-data dir (no saved state) and must not
  // pop up on the user's working screen, so they always center on the
  // primary display (the user's designated screen 1).
  const isE2eFixture = process.env.CAMPUSOS_E2E_FIXTURE === "1";
  let position: { x?: number; y?: number } = {};
  if (!savedState) {
    const primary = screen.getPrimaryDisplay();
    const secondary = isE2eFixture
      ? undefined
      : screen.getAllDisplays().find((display) => display.id !== primary.id);
    if (secondary) {
      const { x, y, width, height } = secondary.workArea;
      position = {
        x: x + Math.max(0, Math.round((width - defaultWidth) / 2)),
        y: y + Math.max(0, Math.round((height - defaultHeight) / 2))
      };
    } else {
      const { x, y, width, height } = primary.workArea;
      position = {
        x: x + Math.max(0, Math.round((width - defaultWidth) / 2)),
        y: y + Math.max(0, Math.round((height - defaultHeight) / 2))
      };
    }
  }
  const window = new BrowserWindow({
    icon: campusIconPath(),
    width: savedState?.bounds.width ?? defaultWidth,
    height: savedState?.bounds.height ?? defaultHeight,
    ...(savedState ? { x: savedState.bounds.x, y: savedState.bounds.y } : position),
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#f3efe6",
    show: false,
    titleBarStyle: "hiddenInset",
    autoHideMenuBar: true,
    webPreferences: {
      session: getAccountBrowserSession(),
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
// Keep the installation-wide lock and Chromium Local State encryption key at
// the root. Electron initializes OSCrypt before ready using sessionData. Moving
// sessionData to the account makes credentials encrypted during login unreadable
// after a switch on Windows. Each window explicitly uses session.fromPath for
// its account; sessionData itself remains fixed throughout the process lifetime.
const accountProfileRoot = app.getPath("userData");
const accountProfiles = hasSingleInstanceLock ? createAccountProfileStore(accountProfileRoot) : null;
if (accountProfiles) {
  app.setPath("sessionData", accountProfileRoot);
  app.setPath("userData", accountProfiles.directory);
}
let desktopPetHost: DesktopPetHost | null = null;

const openNavigation = async (request: import("@campusos/shared").AppNavigationRequest): Promise<void> => {
  if (navigateCampusMainWindow(request)) return;
  await createMainWindow();
  navigateCampusMainWindow(request);
};

const frozenVault = async (): Promise<AiAssistantVault> => {
  const vault = createAiAssistantVault();
  const snapshot = await vault.read();
  return { ...vault, read: async () => snapshot };
};

const markImageExtractionForReview = (result: AiAssistantExtractionResult, ocrWarnings: string[]): AiAssistantExtractionResult => ({
  ...result,
  intents: result.intents.map((intent) => {
    const needsReview = <T,>(field: AiAssistantExtractedField<T>): AiAssistantExtractedField<T> => ({
      ...field,
      source: "inferred" as const,
      needsConfirmation: true
    });
    return {
      ...intent,
      title: needsReview(intent.title),
      description: needsReview(intent.description),
      deadlineAt: needsReview(intent.deadlineAt),
      startAt: needsReview(intent.startAt),
      endAt: needsReview(intent.endAt),
      durationMinutes: needsReview(intent.durationMinutes),
      location: needsReview(intent.location),
      courseName: needsReview(intent.courseName),
      warnings: [...new Set([...intent.warnings, ...ocrWarnings.map((warning) => `图片识别：${warning}`), "内容来自图片识别，请逐项核对后再写入。"])].slice(0, 30)
    };
  })
});

const startCampusApp = (): void => {
  app.on("second-instance", () => {
    if (!showCampusMainWindow()) {
      void createMainWindow().then(showCampusMainWindow);
    }
  });

  void app.whenReady().then(async () => {
    initSentryMain();
    registerCampusmodRendererProtocol();
    registerAcademicCredentialHandlers(accountProfiles ? {
      profiles: accountProfiles,
      onProfileChange: () => {
        suppressNotifications();
        for (const window of BrowserWindow.getAllWindows()) window.hide();
        workspaceRefreshScheduler.stop();
        // A process boundary prevents old repositories, downloads, reminders and
        // auxiliary renderers from surviving into the newly selected account.
        setImmediate(() => {
          if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
            stopCampusServices();
            app.exit(75);
          } else {
            app.relaunch({ args: process.argv.slice(1).filter(argument => argument !== "--hidden") });
            app.quit();
          }
        });
      }
    } : undefined);
    registerReminderSettingsHandlers({
      onSettingsSaved: async (settings) => {
        await rescheduleCampusWorkspaceReminders(settings);
      }
    });
    registerDownloadHandlers();
    registerScheduleHandlers({ onChanged: writeDeskCalendarFeed });
    registerExportHandlers();
    registerAcademicCalendarHandlers({ onSaved: writeDeskCalendarFeed });
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
    desktopPetHost = registerDesktopPetHost({
      onVisibilityChanged: () => { void rebuildTrayMenu(); },
      parse: async (input: DesktopPetInput, signal: AbortSignal) => {
        const vault = await frozenVault();
        const assistant = createAiAssistantService({ vault, academicData: academicQueryData });
        const now = new Date().toISOString();
        let text: string;
        let ocrWarnings: string[] = [];
        if (input.kind === "image") {
          const transcription = await assistant.transcribeImage(input, signal);
          text = transcription.text;
          ocrWarnings = transcription.warnings;
        } else {
          text = input.text;
        }
        const parsed = await assistant.parseMessage({ text, mode: "auto", courseNames: [], now, source: { app: "manual", sentAt: null } }, { signal });
        const result = input.kind === "image" && parsed.intent === "general"
          ? markImageExtractionForReview(parsed, ocrWarnings)
          : parsed;
        return { result, settings: await assistant.loadSettings() };
      },
      onReview: (id) => openNavigation({ requestId: randomUUID(), viewId: "ai-assistant", ...(id ? { entityId: `pet:${id}` } : {}) })
    });
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
      requestItcPage: requestZjuItcPage,
      notify: async (input) => {
        const sourceNames = [...new Set(input.items.map((item) => item.sourceName))];
        for (const [index, item] of input.items.entries()) {
          await addNotification({
            id: `campus-feed:${item.id}`,
            kind: "feed",
            title: item.title,
            body: item.summary ?? "暂无摘要，可前往校园资讯查看详情。",
            actionTarget: { viewId: "campus-feed", entityId: item.id },
            source: "campus-feed",
            sourceId: item.sourceId,
            sourceLabel: item.sourceName,
            groupId: input.batchId,
            entityId: item.id,
            publishedAt: item.publishedAt,
            showDesktop: index === 0,
            desktopTitle: sourceNames.length === 1 ? sourceNames[0] : "校园资讯",
            desktopBody: `新增 ${input.items.length} 条校园资讯`,
            desktopActionTarget: index === 0
              ? { viewId: "campus-feed", entityIds: input.items.map((entry) => entry.id) }
              : undefined
          });
        }
      },
      encryptSecret: (value) => briefVault.encrypt(value),
      decryptSecret: (value) => briefVault.decrypt(value),
      onItemsRead: (ids) => markNotificationsHandledByEntities("campus-feed", ids),
      recordDiagnostic: appendDiagnosticEntry,
      saveTask: async (input) => {
        const result = await saveScheduleTask(input);
        return {
          created: result.operation?.kind === "created" ? 1 : 0,
          deduplicated: result.operation?.kind === "deduplicated" ? 1 : 0
        };
      }
    }));
    registerCampusWorkspaceHandlers({ onSynced: writeDeskCalendarFeed });
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
    await desktopPetHost.restore();
    await createCampusTray({ desktopPet: { isVisible: desktopPetHost.isVisible, toggle: desktopPetHost.toggle } });
    await restoreDeskCalendarOnCampusStart();
    // The updater is intentionally started after the first window exists so
    // packaged startup status is visible through the normal renderer event.
    void checkForUpdates();
    workspaceRefreshScheduler.start();

    app.on("activate", async () => {
      if (!showCampusMainWindow()) {
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

const stopCampusServices = (): void => {
  markCampusAppQuitting();
  killDeskCalendar();
  desktopPetHost?.dispose();
  desktopPetHost = null;
  workspaceRefreshScheduler.stop();
  resetOfficialCapabilityRepository();
  closeOfficialDatabaseService();
};
app.on("before-quit", stopCampusServices);
