import { BrowserWindow, shell } from "electron";
import type { BriefProfile } from "@campusos/shared";
import type { BriefService } from "./briefService";
import { registerTrustedIpcHandler } from "./trustedIpc";

const broadcastState = (state: Awaited<ReturnType<BriefService["getState"]>>): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("campusos:brief:changed", state);
  }
};

export const registerBriefHandlers = (service: BriefService): void => {
  service.subscribe((state) => broadcastState(state));
  registerTrustedIpcHandler("campusos:brief:get", async () => {
    return service.getState();
  });

  registerTrustedIpcHandler("campusos:brief:refresh", async () => {
    const state = await service.refresh();
    return state;
  });

  registerTrustedIpcHandler("campusos:brief:open-external", async (fingerprint: string) => {
    const url = await service.openExternal(fingerprint);
    await shell.openExternal(url);
  });

  registerTrustedIpcHandler("campusos:brief:settings:load", async () => {
    return service.loadSettings();
  });

  registerTrustedIpcHandler("campusos:brief:settings:save", async (input: BriefProfile) => {
    const saved = await service.saveSettings(input);
    void service.getState().then(broadcastState);
    return saved;
  });
};
