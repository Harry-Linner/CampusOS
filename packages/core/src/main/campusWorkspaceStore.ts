import { app, ipcMain } from "electron";
import { join } from "node:path";
import type {
  AcademicCalendarConfigData,
  CalendarEventsData
} from "@campusos/shared";
import { manifest as zjuCalendarConfigManifest } from "@campusos/plugin-zju-calendar-config/manifest";
import type { CampusWorkspaceRecord } from "../shared/campusBridge";
import {
  createDefaultCampusAdapterContext,
  loadCampusWorkspace
} from "../shared/campusWorkspace";
import { readAcademicCredentialRecord } from "./academicCredentialStore";
import { readReminderSettingsRecord } from "./reminderSettingsStore";
import { scheduleWorkspaceReminders } from "./reminderScheduler";
import { pluginRefreshCoordinator } from "./refreshCoordinator";
import {
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

const WORKSPACE_STORE_FILE = "campus-workspace.json";

const getLegacyWorkspaceStorePath = (): string =>
  join(app.getPath("userData"), "workspace", WORKSPACE_STORE_FILE);

const getWorkspaceSnapshotStore = () =>
  createWorkspaceSnapshotStore({
    database: getOfficialDatabaseService(),
    legacyStoragePath: getLegacyWorkspaceStorePath()
  });

const buildGeneratedRecord = async (
  hydratedFrom: "generated" | "synced"
): Promise<CampusWorkspaceRecord> => {
  const pluginRuntime = await getOfficialPluginRuntimeService().load();
  await pluginRefreshCoordinator.runAll();
  const academicCredential = await readAcademicCredentialRecord();
  const verifiedAcademicAccountId =
    academicCredential.verificationState === "verified" &&
    academicCredential.authenticatedProfile
      ? academicCredential.authenticatedProfile.studentId
      : null;
  const reminderSettings = await readReminderSettingsRecord();
  const baseSnapshot = await loadCampusWorkspace(
    createDefaultCampusAdapterContext(new Date(), {
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
