import { app, dialog, ipcMain } from "electron";
import type {
  PluginCapability,
  PluginRuntimeConfigurationInput
} from "@campusos/shared";
import type { PluginCapabilityReadInput } from "../shared/pluginBridge";
import { readAcademicCredentialRecord } from "./academicCredentialStore";
import { assertTrustedRenderer } from "./ipcSecurity";
import { getOfficialCapabilityRepository } from "./officialCapabilityRepository";
import { getOfficialPluginRuntimeService } from "./officialPluginRuntimeService";
import { createPluginCapabilityAccess } from "./pluginCapabilityAccess";

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

export const registerPluginRuntimeHandlers = (): void => {
  const runtime = getOfficialPluginRuntimeService();
  const capabilityRepository = getOfficialCapabilityRepository();
  const capabilityAccess = createPluginCapabilityAccess({
    loadRuntime: () => runtime.load(),
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

  ipcMain.handle("campusos:plugins:load", async (event) => {
    assertTrustedRenderer(event);
    return runtime.load();
  });

  ipcMain.handle(
    "campusos:plugins:configure",
    async (event, input: unknown) => {
      assertTrustedRenderer(event);
      if (!isConfigurationInput(input)) {
        throw new Error("Invalid plugin runtime configuration request.");
      }

      return runtime.configure(input);
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
