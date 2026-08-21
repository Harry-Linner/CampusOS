import { BrowserWindow, ipcMain, shell } from "electron";
import type { BriefProfile } from "@campusos/shared";
import type { BriefService } from "./briefService";
import { assertTrustedRenderer } from "./ipcSecurity";

const broadcastState = (service: BriefService): void => {
  void service.getState().then((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("campusos:brief:changed", state);
    }
  });
};

export const registerBriefHandlers = (service: BriefService): void => {
  ipcMain.handle("campusos:brief:get", async (event) => {
    assertTrustedRenderer(event);
    return service.getState();
  });

  ipcMain.handle("campusos:brief:refresh", async (event) => {
    assertTrustedRenderer(event);
    const state = await service.refresh();
    broadcastState(service);
    return state;
  });

  ipcMain.handle("campusos:brief:open-external", async (event, fingerprint: string) => {
    assertTrustedRenderer(event);
    const url = await service.openExternal(fingerprint);
    await shell.openExternal(url);
  });

  ipcMain.handle("campusos:brief:settings:load", async (event) => {
    assertTrustedRenderer(event);
    return service.loadSettings();
  });

  ipcMain.handle("campusos:brief:settings:save", async (event, input: BriefProfile) => {
    assertTrustedRenderer(event);
    const saved = await service.saveSettings(input);
    broadcastState(service);
    return saved;
  });
};
