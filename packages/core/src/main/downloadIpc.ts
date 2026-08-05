import { BrowserWindow, ipcMain, shell } from "electron";
import type { CampusDownloadRequest, CampusDownloadTask } from "@campusos/shared";
import { assertTrustedRenderer } from "./ipcSecurity";
import { DownloadEngine } from "./downloadEngine";
import { getOfficialDownloadQueuePersistence } from "./sqliteDownloadQueuePersistence";
import { requestZjuLearningDownload } from "./academicCredentialStore";
import { classifyCampusDownloadRequest } from "./downloadRequestPolicy";

let downloadEngine: DownloadEngine | null = null;
let initialization: Promise<DownloadEngine> | null = null;

interface DownloadHandlerEngine {
  getSummary: () => CampusDownloadTask[];
  enqueue: (input: CampusDownloadRequest) => Promise<{ id: string }>;
  pause: (id: string) => Promise<boolean>;
  resume: (id: string) => Promise<boolean>;
  cancel: (id: string) => Promise<boolean>;
}

interface DownloadHandlerDependencies {
  loadEngine?: () => Promise<DownloadHandlerEngine>;
  openPath?: (path: string) => Promise<string>;
  showItemInFolder?: (path: string) => void;
}

const notifyDownloadChange = (): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("campusos:downloads:changed");
  }
};

const getInitializedDownloadEngine = async (): Promise<DownloadEngine> => {
  if (initialization) return initialization;
  const engine = downloadEngine ?? new DownloadEngine({
    onChanged: notifyDownloadChange,
    queuePersistence: getOfficialDownloadQueuePersistence(),
    resolveResponse: async ({ item, headers, signal }) => {
      const classification = classifyCampusDownloadRequest(item);
      if (classification.kind === "public") {
        return fetch(item.url, { headers, signal });
      }
      return requestZjuLearningDownload({
        uploadId: classification.uploadId,
        referenceId: classification.referenceId,
        range: headers.Range,
        signal
      });
    }
  });
  downloadEngine = engine;
  initialization = engine.loadPersisted().then(() => engine);
  return initialization;
};

export const getWorkspaceDownloads = async (): Promise<CampusDownloadTask[]> =>
  (await getInitializedDownloadEngine()).getSummary();

const toTask = (engine: DownloadHandlerEngine, id: string): CampusDownloadTask => {
  const task = engine.getSummary().find((item) => item.id === id);
  if (!task) throw new Error("下载任务未找到。");
  return task;
};

const toReadyTask = (
  engine: DownloadHandlerEngine,
  input: unknown
): CampusDownloadTask => {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("下载任务标识无效。");
  }
  const task = toTask(engine, input);
  if (task.status !== "ready") {
    throw new Error("下载完成后才能打开文件。");
  }
  return task;
};

export const registerDownloadHandlers = ({
  loadEngine = getInitializedDownloadEngine,
  openPath = shell.openPath,
  showItemInFolder = shell.showItemInFolder
}: DownloadHandlerDependencies = {}): void => {
  ipcMain.handle("campusos:downloads:list", async (event) => {
    assertTrustedRenderer(event);
    return (await loadEngine()).getSummary();
  });
  ipcMain.handle(
    "campusos:downloads:enqueue",
    async (event, input: CampusDownloadRequest) => {
      assertTrustedRenderer(event);
      classifyCampusDownloadRequest(input);
      const engine = await loadEngine();
      const task = await engine.enqueue(input);
      return toTask(engine, task.id);
    }
  );
  for (const action of ["pause", "resume", "cancel"] as const) {
    ipcMain.handle(`campusos:downloads:${action}`, async (event, id: string) => {
      assertTrustedRenderer(event);
      const engine = await loadEngine();
      const updated = await engine[action](id);
      return updated;
    });
  }
  ipcMain.handle("campusos:downloads:open", async (event, id: unknown) => {
    assertTrustedRenderer(event);
    const task = toReadyTask(await loadEngine(), id);
    const issue = await openPath(task.targetPath);
    if (issue) throw new Error("系统无法打开该文件。");
  });
  ipcMain.handle("campusos:downloads:reveal", async (event, id: unknown) => {
    assertTrustedRenderer(event);
    const task = toReadyTask(await loadEngine(), id);
    showItemInFolder(task.targetPath);
  });
};
