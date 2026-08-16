import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type {
  PluginCapability,
  PluginRuntimeConfigurationInput,
  PluginRuntimeSnapshot
} from "@campusos/shared";
import type { PluginCapabilityReadInput } from "../shared/pluginBridge";
import { readAcademicCredentialRecord } from "./academicCredentialStore";
import { assertTrustedRenderer } from "./ipcSecurity";
import { getOfficialCapabilityRepository } from "./officialCapabilityRepository";
import { getOfficialPluginRuntimeService } from "./officialPluginRuntimeService";
import { createPluginCapabilityAccess } from "./pluginCapabilityAccess";
import { setSchedulePluginEnabled } from "./appLifecycle";
import type { PluginUpdateCandidate } from "./pluginUpdateService";

const SCHEDULE_PLUGIN_ID = "org.campusos.schedule";

const isConfigurationInput = (
  input: unknown
): input is PluginRuntimeConfigurationInput =>
  typeof input === "object" &&
  input !== null &&
  "pluginId" in input &&
  typeof input.pluginId === "string" &&
  "enabled" in input &&
  typeof input.enabled === "boolean" &&
  "grantedPermissions" in input &&
  Array.isArray(input.grantedPermissions) &&
  input.grantedPermissions.every((permission) => typeof permission === "string");

const isCapabilityReadInput = (
  input: unknown
): input is PluginCapabilityReadInput =>
  typeof input === "object" &&
  input !== null &&
  "pluginId" in input &&
  typeof input.pluginId === "string" &&
  "capability" in input &&
  typeof input.capability === "string" &&
    /^[a-z][a-z0-9.-]*@[1-9][0-9]*$/.test(input.capability);

const isInspectionToken = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);

const isThirdPartyPluginId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(value) &&
  !value.startsWith("org.campusos.");

const isPluginUpdateCandidate = (value: unknown): value is PluginUpdateCandidate => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PluginUpdateCandidate>;
  return isThirdPartyPluginId(candidate.pluginId) &&
    typeof candidate.version === "string" &&
    typeof candidate.packageUrl === "string" &&
    typeof candidate.packageSha256 === "string" &&
    typeof candidate.manifest === "object" && candidate.manifest !== null &&
    (candidate.requiresReapproval === undefined || typeof candidate.requiresReapproval === "boolean");
};

export const registerPluginRuntimeHandlers = (): void => {
  const runtime = getOfficialPluginRuntimeService();
  const capabilityRepository = getOfficialCapabilityRepository();
  const capabilityAccess = createPluginCapabilityAccess({
    loadRuntime: () => runtime.loadInternal(),
    readRecords: <T>(capability: PluginCapability) =>
      capabilityRepository.read<T>(capability),
    readVerifiedAccountId: async () => {
      const credential = await readAcademicCredentialRecord();
      return credential.verificationState === "verified" &&
        credential.authenticatedProfile
        ? credential.authenticatedProfile.studentId
        : null;
    }
  });

  const notifyRuntimeChanged = (snapshot: PluginRuntimeSnapshot): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("campusos:plugins:changed", snapshot);
      }
    }
  };
  const applyDesktopCapabilityState = async (snapshot: PluginRuntimeSnapshot): Promise<void> => {
    const schedule = snapshot.plugins.find((plugin) => plugin.id === SCHEDULE_PLUGIN_ID);
    await setSchedulePluginEnabled(schedule?.enabled === true && schedule.status === "active");
  };
  let initialCacheServed = false;

  ipcMain.handle("campusos:plugins:load", async (event) => {
    assertTrustedRenderer(event);
    if (!initialCacheServed) {
      initialCacheServed = true;
      const cached = await runtime.loadCached();
      if (cached) {
        void runtime.load().then(async (snapshot) => {
          await applyDesktopCapabilityState(snapshot);
          notifyRuntimeChanged(snapshot);
        }, () => undefined);
        await applyDesktopCapabilityState(cached);
        return cached;
      }
    }
    const snapshot = await runtime.load();
    await applyDesktopCapabilityState(snapshot);
    return snapshot;
  });

  ipcMain.handle(
    "campusos:plugins:configure",
    async (event, input: unknown) => {
      assertTrustedRenderer(event);
      if (!isConfigurationInput(input)) {
        throw new Error("Invalid plugin runtime configuration request.");
      }

      const snapshot = await runtime.configure(input);
      await applyDesktopCapabilityState(snapshot);
      return snapshot;
    }
  );

  ipcMain.handle("campusos:plugins:package:select", async (event) => {
    assertTrustedRenderer(event);
    const selection = await dialog.showOpenDialog({
      title: "选择 CampusOS 插件包",
      properties: ["openFile"],
      filters: [
        { name: "CampusOS 插件包", extensions: ["campusmod"] }
      ]
    });
    if (selection.canceled || selection.filePaths.length !== 1) {
      return { canceled: true, inspection: null } as const;
    }
    return {
      canceled: false,
      inspection: await runtime.inspectPackage(selection.filePaths[0])
    } as const;
  });

  ipcMain.handle(
    "campusos:plugins:package:discard",
    async (event, token: unknown) => {
      assertTrustedRenderer(event);
      if (!isInspectionToken(token)) throw new Error("Invalid package token.");
      runtime.discardPackageInspection(token);
    }
  );

  ipcMain.handle(
    "campusos:plugins:package:install",
    async (event, token: unknown) => {
      assertTrustedRenderer(event);
      if (!isInspectionToken(token)) throw new Error("Invalid package token.");
      return runtime.installPackage(token);
    }
  );

  ipcMain.handle("campusos:plugins:package:load", async (event) => {
    assertTrustedRenderer(event);
    return runtime.loadPackages();
  });

  ipcMain.handle(
    "campusos:plugins:package:uninstall",
    async (event, pluginId: unknown) => {
      assertTrustedRenderer(event);
      if (!isThirdPartyPluginId(pluginId)) {
        throw new Error("Invalid third-party plugin ID.");
      }
      return runtime.uninstallPackage(pluginId);
    }
  );

  ipcMain.handle("campusos:plugins:update:check", async (event) => {
    assertTrustedRenderer(event);
    return runtime.checkUpdates();
  });

  ipcMain.handle("campusos:plugins:update:apply", async (event, input: unknown) => {
    assertTrustedRenderer(event);
    if (!isPluginUpdateCandidate(input)) throw new Error("插件更新候选无效。");
    return runtime.updatePackage(input);
  });

  ipcMain.handle(
    "campusos:plugins:capability:read",
    async (event, input: unknown) => {
      assertTrustedRenderer(event);
      if (!isCapabilityReadInput(input)) {
        throw new Error("Invalid plugin capability read request.");
      }

      return capabilityAccess.read(input);
    }
  );

  app.once("before-quit", () => {
    void runtime.shutdown();
  });
};
