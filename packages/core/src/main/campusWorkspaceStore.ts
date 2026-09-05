import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import type {
  AcademicCalendarConfigData,
  AcademicGradesData,
  CalendarEventsData,
  LearningMaterialsData,
  LocalTaskRecord,
  PluginRuntimeSnapshot
} from "@campusos/shared";
import { manifest as zjuCalendarConfigManifest } from "@campusos/plugin-zju-calendar-config/manifest";
import { manifest as zjuGraduateManifest } from "@campusos/plugin-zju-graduate/manifest";
import { manifest as zjuUndergraduateManifest } from "@campusos/plugin-zju-undergraduate/manifest";
import { manifest as zjuLearningManifest } from "@campusos/plugin-zju-learning/manifest";
import type { CampusWorkspaceRecord } from "../shared/campusBridge";
import type {
  ReminderSchedulerState,
  ReminderSettingsRecord
} from "../shared/reminderBridge";
import { readAcademicCredentialRecord } from "./academicCredentialStore";
import { readReminderSettingsRecord } from "./reminderSettingsStore";
import { scheduleWorkspaceReminders } from "./reminderScheduler";
import {
  pluginRefreshCoordinator,
  type RefreshSourceResult
} from "./refreshCoordinator";
import {
  createLiveWorkspaceSnapshot,
  createEmptyWorkspaceSnapshot,
  findAcademicCalendarRecord,
  findCalendarEventRecords,
  findLearningMaterialsRecord,
  mergeAcademicCalendarIntoWorkspace,
  mergeCalendarEventsIntoWorkspace,
  mergeLearningMaterialsIntoWorkspace,
  pruneWorkspaceDeadlinesBeforeToday
} from "./campusWorkspaceCapabilities";
import { getOfficialCapabilityRepository } from "./officialCapabilityRepository";
import { getOfficialPluginRuntimeService } from "./officialPluginRuntimeService";
import { getWorkspaceDownloads } from "./downloadIpc";
import { getOfficialDatabaseService } from "./officialDatabaseService";
import { processGradeChangeNotification } from "./gradeChangeNotification";
import { createWorkspaceSnapshotStore } from "./workspaceSnapshotStore";
import { appendDiagnosticEntry } from "./diagnosticLogStore";
import { publishE2eFixtureCapabilities } from "./e2eFixtureSources";
import { useE2eFixtureSources } from "./officialAcademicCalendarRequest";

const readLocalReminderTasks = (): LocalTaskRecord[] => {
  const stored = getOfficialDatabaseService().loadLocalTasks();
  return stored && Array.isArray(stored.tasks) ? stored.tasks as LocalTaskRecord[] : [];
};

const WORKSPACE_STORE_FILE = "campus-workspace.json";
export const CAMPUS_WORKSPACE_CHANGED_CHANNEL = "campusos:workspace:changed";

export const notifyCampusWorkspaceChanged = (): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(CAMPUS_WORKSPACE_CHANGED_CHANNEL);
  }
};

const getLegacyWorkspaceStorePath = (): string =>
  join(app.getPath("userData"), "workspace", WORKSPACE_STORE_FILE);

const getWorkspaceSnapshotStore = () =>
  createWorkspaceSnapshotStore({
    database: getOfficialDatabaseService(),
    legacyStoragePath: getLegacyWorkspaceStorePath()
  });

const getAcademicConnectorSourceId = (
  program: "undergraduate" | "graduate"
): string =>
  program === "undergraduate" ? zjuUndergraduateManifest.id : zjuGraduateManifest.id;

const assertAcademicRefreshAvailable = async (
  refreshResults: readonly RefreshSourceResult[],
  program: "undergraduate" | "graduate",
  pluginRuntime: PluginRuntimeSnapshot
): Promise<void> => {
  const sourceId = getAcademicConnectorSourceId(program);
  const result = refreshResults.find((candidate) => candidate.sourceId === sourceId);

  if (result && result.status !== "unavailable") return;

  const connector = pluginRuntime.plugins.find((plugin) => plugin.id === sourceId);
  const registeredSources = refreshResults.map((candidate) => candidate.sourceId);
  await appendDiagnosticEntry({
    module: sourceId,
    operation: "academic-sync-availability",
    state: "unavailable",
    durationMs: 0,
    message: [
      `培养层次: ${program}`,
      `连接器状态: ${connector?.status ?? "未加载"}`,
      `刷新源: ${registeredSources.length > 0 ? registeredSources.join("、") : "无"}`
    ].join("；")
  }).catch(() => {});

  throw new Error(
    `教务数据同步失败：${result?.message ?? "真实教务连接器未启动。"}`
  );
};

const buildGeneratedRecord = async (
  hydratedFrom: "generated" | "synced",
  notifyGradeChanges = false
): Promise<CampusWorkspaceRecord> => {
  const now = new Date();
  const pluginRuntime = await getOfficialPluginRuntimeService().loadInternal();
  const refreshResults = await pluginRefreshCoordinator.runAll();
  if (useE2eFixtureSources()) {
    await publishE2eFixtureCapabilities(getOfficialCapabilityRepository(), now);
  }
  const academicCredential = await readAcademicCredentialRecord();
  const verifiedAcademicAccountId =
    academicCredential.verificationState === "verified" &&
    academicCredential.authenticatedProfile
      ? academicCredential.authenticatedProfile.studentId
      : null;
  if (verifiedAcademicAccountId && academicCredential.program) {
    await assertAcademicRefreshAvailable(
      refreshResults,
      academicCredential.program,
      pluginRuntime
    );
  }
  const reminderSettings = await readReminderSettingsRecord();
  if (notifyGradeChanges && verifiedAcademicAccountId && academicCredential.program) {
    const connectorSourceId = getAcademicConnectorSourceId(academicCredential.program);
    const gradeRecords = await getOfficialCapabilityRepository().read<AcademicGradesData>(
      "academic.grades@1"
    );
    const gradeRecord = gradeRecords.find(
      (record) =>
        record.providerId === connectorSourceId &&
        record.accountId === verifiedAcademicAccountId
    ) ?? null;
    const connectorStatus = refreshResults.find(
      (result) => result.sourceId === connectorSourceId
    )?.status ?? "unavailable";
    await processGradeChangeNotification({
      accountId: verifiedAcademicAccountId,
      connectorStatus,
      gradeRecord,
      enabled: reminderSettings.gradeChangesEnabled !== false,
      database: getOfficialDatabaseService()
    });
  }
  const baseSnapshot = verifiedAcademicAccountId
    ? createLiveWorkspaceSnapshot({
        generatedAt: now.toISOString(),
        accountId: verifiedAcademicAccountId
      })
    : createEmptyWorkspaceSnapshot({
        generatedAt: now.toISOString()
      });
  const eventRecords =
    await getOfficialCapabilityRepository().read<CalendarEventsData>(
      "calendar.events@1"
    );
  const calendarRecords =
    await getOfficialCapabilityRepository().read<AcademicCalendarConfigData>(
      "academic.calendar-config@1"
    );
  const learningMaterialRecords =
    await getOfficialCapabilityRepository().read<LearningMaterialsData>(
      "learning.materials@1"
    );
  const calendarPluginActive = pluginRuntime.plugins.some(
    (plugin) =>
      plugin.id === zjuCalendarConfigManifest.id && plugin.status === "active"
  );
  const activeEventProviderIds = pluginRuntime.plugins
    .filter(
      (plugin) =>
        plugin.status === "active" &&
        plugin.manifest.provides.includes("calendar.events@1")
    )
    .map((plugin) => plugin.id);
  const calendarSnapshot = mergeAcademicCalendarIntoWorkspace(
    baseSnapshot,
    calendarPluginActive
      ? findAcademicCalendarRecord(
          calendarRecords,
          zjuCalendarConfigManifest.id
        )
      : null
  );
  const eventSnapshot = mergeCalendarEventsIntoWorkspace(
    calendarSnapshot,
    findCalendarEventRecords(
      eventRecords,
      activeEventProviderIds,
      verifiedAcademicAccountId
    ),
    reminderSettings.leadMinutes
  );
  const mergedSnapshot = mergeLearningMaterialsIntoWorkspace(
    eventSnapshot,
    findLearningMaterialsRecord(
      learningMaterialRecords,
      zjuLearningManifest.id,
      verifiedAcademicAccountId
    )
  );
  const downloads = await getWorkspaceDownloads();
  const snapshot = {
    ...mergedSnapshot,
    downloads,
    summary: {
      ...mergedSnapshot.summary,
      downloadsInFlight: downloads.filter((item) => item.status === "queued" || item.status === "syncing")
        .length
    }
  };
  const stored = await getWorkspaceSnapshotStore().save(snapshot);
  scheduleWorkspaceReminders(stored.snapshot, reminderSettings, new Date(), readLocalReminderTasks());

  return {
    snapshot: stored.snapshot,
    savedAt: stored.savedAt,
    storagePath: stored.storagePath,
    hydratedFrom
  };
};

export const hydrateCampusWorkspace =
  async (): Promise<CampusWorkspaceRecord> => {
    const snapshotStore = getWorkspaceSnapshotStore();
    const stored = await snapshotStore.load();

    if (stored) {
      const reminderSettings = await readReminderSettingsRecord();
      const snapshot = pruneWorkspaceDeadlinesBeforeToday(
        stored.snapshot,
        new Date().toISOString(),
        reminderSettings.leadMinutes
      );
      const hydrated = snapshot === stored.snapshot
        ? stored
        : await snapshotStore.save(snapshot);
      scheduleWorkspaceReminders(hydrated.snapshot, reminderSettings, new Date(), readLocalReminderTasks());

      return {
        snapshot: hydrated.snapshot,
        savedAt: hydrated.savedAt,
        storagePath: hydrated.storagePath,
        hydratedFrom: "disk"
      };
    }

    return buildGeneratedRecord("generated");
  };

export const syncCampusWorkspace =
  async (options: { notifyGradeChanges?: boolean } = {}): Promise<CampusWorkspaceRecord> =>
    buildGeneratedRecord("synced", options.notifyGradeChanges === true);

export const rescheduleCampusWorkspaceReminders = async (
  settings: ReminderSettingsRecord,
  now = new Date()
): Promise<ReminderSchedulerState> => {
  const snapshotStore = getWorkspaceSnapshotStore();
  const stored = await snapshotStore.load();
  if (!stored) return scheduleWorkspaceReminders(null, settings, now, readLocalReminderTasks());

  const snapshot = pruneWorkspaceDeadlinesBeforeToday(
    stored.snapshot,
    now.toISOString(),
    settings.leadMinutes
  );
  if (snapshot !== stored.snapshot) {
    await snapshotStore.save(snapshot);
    notifyCampusWorkspaceChanged();
  }

  return scheduleWorkspaceReminders(snapshot, settings, now, readLocalReminderTasks());
};

export const registerCampusWorkspaceHandlers = (): void => {
  ipcMain.handle("campusos:workspace:hydrate", async () =>
    hydrateCampusWorkspace()
  );
  ipcMain.handle("campusos:workspace:sync", async () => syncCampusWorkspace());
};
