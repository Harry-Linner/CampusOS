import { app, ipcMain } from "electron";
import { join } from "node:path";
import type {
  AcademicCalendarConfigData,
  CalendarEventsData,
  PluginRuntimeSnapshot
} from "@campusos/shared";
import { manifest as zjuCalendarConfigManifest } from "@campusos/plugin-zju-calendar-config/manifest";
import { manifest as zjuGraduateManifest } from "@campusos/plugin-zju-graduate/manifest";
import { manifest as zjuUndergraduateManifest } from "@campusos/plugin-zju-undergraduate/manifest";
import type { CampusWorkspaceRecord } from "../shared/campusBridge";
import {
  createDefaultCampusAdapterContext,
  loadCampusWorkspace
} from "../shared/campusWorkspace";
import { readAcademicCredentialRecord } from "./academicCredentialStore";
import { readReminderSettingsRecord } from "./reminderSettingsStore";
import { scheduleWorkspaceReminders } from "./reminderScheduler";
import {
  pluginRefreshCoordinator,
  type RefreshSourceResult
} from "./refreshCoordinator";
import {
  createLiveWorkspaceSnapshot,
  findAcademicCalendarRecord,
  findCalendarEventRecords,
  mergeAcademicCalendarIntoWorkspace,
  mergeCalendarEventsIntoWorkspace
} from "./campusWorkspaceCapabilities";
import { getOfficialCapabilityRepository } from "./officialCapabilityRepository";
import { getOfficialPluginRuntimeService } from "./officialPluginRuntimeService";
import { getWorkspaceDownloads } from "./downloadIpc";
import { getOfficialDatabaseService } from "./officialDatabaseService";
import { createWorkspaceSnapshotStore } from "./workspaceSnapshotStore";
import { appendDiagnosticEntry } from "./diagnosticLogStore";

const WORKSPACE_STORE_FILE = "campus-workspace.json";

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
  hydratedFrom: "generated" | "synced"
): Promise<CampusWorkspaceRecord> => {
  const pluginRuntime = await getOfficialPluginRuntimeService().load();
  const refreshResults = await pluginRefreshCoordinator.runAll();
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
  const now = new Date();
  const baseSnapshot = verifiedAcademicAccountId
    ? createLiveWorkspaceSnapshot({
        generatedAt: now.toISOString(),
        accountId: verifiedAcademicAccountId
      })
    : await loadCampusWorkspace(
        createDefaultCampusAdapterContext(now, {
          "academic-affairs": {
            configured: academicCredential.configured,
            username: academicCredential.username,
            savedAt: academicCredential.savedAt
          }
        }, reminderSettings.leadMinutes)
      );
  const eventRecords =
    await getOfficialCapabilityRepository().read<CalendarEventsData>(
      "calendar.events@1"
    );
  const calendarRecords =
    await getOfficialCapabilityRepository().read<AcademicCalendarConfigData>(
      "academic.calendar-config@1"
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
  const mergedSnapshot = mergeCalendarEventsIntoWorkspace(
    calendarSnapshot,
    findCalendarEventRecords(
      eventRecords,
      activeEventProviderIds,
      verifiedAcademicAccountId
    ),
    reminderSettings.leadMinutes
  );
  const downloads = await getWorkspaceDownloads();
  const snapshot = {
    ...mergedSnapshot,
    downloads,
    summary: {
      ...mergedSnapshot.summary,
      downloadsInFlight: downloads.filter((item) => item.status !== "ready")
        .length
    }
  };
  const stored = await getWorkspaceSnapshotStore().save(snapshot);
  scheduleWorkspaceReminders(stored.snapshot, reminderSettings);

  return {
    snapshot: stored.snapshot,
    savedAt: stored.savedAt,
    storagePath: stored.storagePath,
    hydratedFrom
  };
};

export const hydrateCampusWorkspace =
  async (): Promise<CampusWorkspaceRecord> => {
    const stored = await getWorkspaceSnapshotStore().load();

    if (stored) {
      const reminderSettings = await readReminderSettingsRecord();
      scheduleWorkspaceReminders(stored.snapshot, reminderSettings);

      return {
        snapshot: stored.snapshot,
        savedAt: stored.savedAt,
        storagePath: stored.storagePath,
        hydratedFrom: "disk"
      };
    }

    return buildGeneratedRecord("generated");
  };

export const syncCampusWorkspace =
  async (): Promise<CampusWorkspaceRecord> => buildGeneratedRecord("synced");

export const registerCampusWorkspaceHandlers = (): void => {
  ipcMain.handle("campusos:workspace:hydrate", async () =>
    hydrateCampusWorkspace()
  );
  ipcMain.handle("campusos:workspace:sync", async () => syncCampusWorkspace());
};
