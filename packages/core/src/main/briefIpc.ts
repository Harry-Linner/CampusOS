import { BrowserWindow, ipcMain, shell } from "electron";
import type { BriefProfile } from "@campusos/shared";
import type { BriefService } from "./briefService";
import { assertTrustedRenderer } from "./ipcSecurity";

const broadcastState = (state: Awaited<ReturnType<BriefService["getState"]>>): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("campusos:brief:changed", state);
  }
};

export const registerBriefHandlers = (service: BriefService): void => {
  service.subscribe((state) => broadcastState(state));
  ipcMain.handle("campusos:brief:get", async (event) => {
    assertTrustedRenderer(event);
    return service.getState();
  });

  ipcMain.handle("campusos:brief:refresh", async (event) => {
    assertTrustedRenderer(event);
    const state = await service.refresh();
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
    void service.getState().then(broadcastState);
    return saved;
  });
};
