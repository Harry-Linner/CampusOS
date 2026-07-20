import { BrowserWindow, ipcMain } from "electron";
import type { CampusDownloadRequest, CampusDownloadTask } from "@campusos/shared";
import { assertTrustedRenderer } from "./ipcSecurity";
import { DownloadEngine } from "./downloadEngine";
import { getOfficialDownloadQueuePersistence } from "./sqliteDownloadQueuePersistence";

let downloadEngine: DownloadEngine | null = null;
let initialization: Promise<DownloadEngine> | null = null;

const notifyDownloadChange = (): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("campusos:downloads:changed");
  }
};

const getInitializedDownloadEngine = async (): Promise<DownloadEngine> => {
  if (initialization) return initialization;
  const engine = downloadEngine ?? new DownloadEngine({
    onChanged: notifyDownloadChange,
    queuePersistence: getOfficialDownloadQueuePersistence()
  });
  downloadEngine = engine;
  initialization = engine.loadPersisted().then(() => engine);
  return initialization;
};

export const getWorkspaceDownloads = async (): Promise<CampusDownloadTask[]> =>
  (await getInitializedDownloadEngine()).getSummary();

const toTask = (engine: DownloadEngine, id: string): CampusDownloadTask => {
  const task = engine.getSummary().find((item) => item.id === id);
  if (!task) throw new Error("下载任务未找到。");
  return task;
};

export const registerDownloadHandlers = (): void => {
  ipcMain.handle("campusos:downloads:list", async (event) => {
    assertTrustedRenderer(event);
    return getWorkspaceDownloads();
  });
  ipcMain.handle(
    "campusos:downloads:enqueue",
    async (event, input: CampusDownloadRequest) => {
      assertTrustedRenderer(event);
      const engine = await getInitializedDownloadEngine();
      const task = await engine.enqueue(input);
      return toTask(engine, task.id);
    }
  );
  for (const action of ["pause", "resume", "cancel"] as const) {
    ipcMain.handle(`campusos:downloads:${action}`, async (event, id: string) => {
      assertTrustedRenderer(event);
      const engine = await getInitializedDownloadEngine();
      const updated = await engine[action](id);
      return updated;
    });
  }
};
