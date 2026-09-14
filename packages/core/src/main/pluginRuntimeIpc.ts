import { app, BrowserWindow, dialog } from "electron";
import type {
  PluginCapability,
  PluginRuntimeSnapshot
} from "@campusos/shared";
import { readAcademicCredentialRecord } from "./academicCredentialStore";
import { registerTrustedIpcHandler } from "./trustedIpc";
import { getOfficialCapabilityRepository } from "./officialCapabilityRepository";
import { getOfficialPluginRuntimeService } from "./officialPluginRuntimeService";
import { createPluginCapabilityAccess } from "./pluginCapabilityAccess";
import type { PluginUpdateCandidate } from "./pluginUpdateService";
import {
  parseCapabilityReadInput,
  parsePluginConfigurationInput
} from "./ipcSchemas";

const SCHEDULE_PLUGIN_ID = "org.campusos.schedule";

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
    void schedule;
  };
  let initialCacheServed = false;

  registerTrustedIpcHandler("campusos:plugins:load", async () => {
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

  registerTrustedIpcHandler(
    "campusos:plugins:configure",
    async (input: unknown) => {
      const parsed = parsePluginConfigurationInput(input);
      if (!parsed) {
        throw new Error("Invalid plugin runtime configuration request.");
      }

      const snapshot = await runtime.configure(parsed);
      await applyDesktopCapabilityState(snapshot);
      return snapshot;
    }
  );

  registerTrustedIpcHandler("campusos:plugins:package:select", async () => {
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

  registerTrustedIpcHandler(
    "campusos:plugins:package:discard",
    async (token: unknown) => {
      if (!isInspectionToken(token)) throw new Error("Invalid package token.");
      runtime.discardPackageInspection(token);
    }
  );

  registerTrustedIpcHandler(
    "campusos:plugins:package:install",
    async (token: unknown) => {
      if (!isInspectionToken(token)) throw new Error("Invalid package token.");
      return runtime.installPackage(token);
    }
  );

  registerTrustedIpcHandler("campusos:plugins:package:load", async () => {
    return runtime.loadPackages();
  });

  registerTrustedIpcHandler(
    "campusos:plugins:package:uninstall",
    async (pluginId: unknown) => {
      if (!isThirdPartyPluginId(pluginId)) {
        throw new Error("Invalid third-party plugin ID.");
      }
      return runtime.uninstallPackage(pluginId);
    }
  );

  registerTrustedIpcHandler("campusos:plugins:update:check", async () => {
    return runtime.checkUpdates();
  });

  registerTrustedIpcHandler("campusos:plugins:update:apply", async (input: unknown) => {
    if (!isPluginUpdateCandidate(input)) throw new Error("插件更新候选无效。");
    return runtime.updatePackage(input);
  });

  registerTrustedIpcHandler(
    "campusos:plugins:capability:read",
    async (input: unknown) => {
      const parsed = parseCapabilityReadInput(input);
      if (!parsed) {
        throw new Error("Invalid plugin capability read request.");
      }

      return capabilityAccess.read(parsed);
    }
  );

  app.once("before-quit", () => {
    void runtime.shutdown();
  });
};
