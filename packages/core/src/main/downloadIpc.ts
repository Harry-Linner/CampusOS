import { BrowserWindow, ipcMain, shell } from "electron";
import type { CampusDownloadRequest, CampusDownloadTask } from "@campusos/shared";
import { assertTrustedRenderer } from "./ipcSecurity";
import { DownloadEngine } from "./downloadEngine";
import { getOfficialDownloadQueuePersistence } from "./sqliteDownloadQueuePersistence";
import { requestZjuLearningDownload } from "./academicCredentialStore";
import { classifyCampusDownloadRequest } from "./downloadRequestPolicy";
import { addNotification } from "./notificationCenter";
import { getAppLifecycleSettings } from "./appLifecycle";

let downloadEngine: DownloadEngine | null = null;
let initialization: Promise<DownloadEngine> | null = null;

interface DownloadHandlerEngine {
  getSummary: () => CampusDownloadTask[];
  enqueue: (input: CampusDownloadRequest) => Promise<{ id: string }>;
  pause: (id: string) => Promise<boolean>;
  resume: (id: string) => Promise<boolean>;
  cancel: (id: string) => Promise<boolean>;
  clearAll: () => Promise<number>;
}

interface DownloadHandlerDependencies {
  loadEngine?: () => Promise<DownloadHandlerEngine>;
  openPath?: (path: string) => Promise<string>;
  showItemInFolder?: (path: string) => void;
}

export const DOWNLOAD_COMPLETION_SOUND_CHANNEL =
  "campusos:downloads:completion-sound";

interface DownloadCompletionTrackerDependencies {
  notify?: typeof addNotification;
  isSoundEnabled?: () => Promise<boolean>;
  broadcastSound?: () => void;
}

export const createDownloadCompletionTracker = ({
  notify = addNotification,
  isSoundEnabled = async () => (await getAppLifecycleSettings()).notificationEnabled,
  broadcastSound = () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(DOWNLOAD_COMPLETION_SOUND_CHANNEL);
      }
    }
  }
}: DownloadCompletionTrackerDependencies = {}) => {
  let previousInProgressCount = 0;
  let suppressionDepth = 0;

  const observe = (tasks: readonly CampusDownloadTask[]): void => {
    const inProgressCount = tasks.filter(
      (item) => item.status === "queued" || item.status === "syncing"
    ).length;
    const batchEnded = previousInProgressCount > 0 && inProgressCount === 0;
    previousInProgressCount = inProgressCount;
    if (!batchEnded || suppressionDepth > 0) return;

    const failedCount = tasks.filter((item) => item.status === "failed").length;
    const pausedCount = tasks.filter((item) => item.status === "paused").length;
    const title = failedCount > 0 || pausedCount > 0
      ? "资料下载已结束"
      : "资料下载全部完成";
    const body = failedCount > 0
      ? `下载队列已结束，其中 ${failedCount} 项失败。`
      : pausedCount > 0
        ? `当前批次已结束，另有 ${pausedCount} 项处于暂停状态。`
        : "下载队列中的资料已全部下载完毕。";

    void notify({
      kind: "system",
      title,
      body,
      showDesktop: true
    }).catch(() => undefined);
    void isSoundEnabled()
      .then((enabled) => {
        if (enabled) broadcastSound();
      })
      .catch(() => undefined);
  };

  const suppressDuring = async <T>(operation: () => Promise<T>): Promise<T> => {
    suppressionDepth += 1;
    try {
      return await operation();
    } finally {
      suppressionDepth -= 1;
    }
  };

  return { observe, suppressDuring };
};

const completionTracker = createDownloadCompletionTracker();

const notifyDownloadChange = (): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("campusos:downloads:changed");
  }
  if (downloadEngine) completionTracker.observe(downloadEngine.getSummary());
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
  ipcMain.handle("campusos:downloads:clear-all", async (event) => {
    assertTrustedRenderer(event);
    const engine = await loadEngine();
    return completionTracker.suppressDuring(() => engine.clearAll());
  });
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
