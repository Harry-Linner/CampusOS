import { app, BrowserWindow, dialog, shell, type OpenDialogOptions } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import type {
  CampusDownloadPreferenceInput,
  CampusDownloadPreferences,
  CampusDownloadRequest,
  CampusDownloadTask,
  CampusDownloadVerification
} from "@campusos/shared";
import { registerTrustedIpcHandler } from "./trustedIpc";
import { DownloadEngine } from "./downloadEngine";
import { getOfficialDownloadQueuePersistence } from "./sqliteDownloadQueuePersistence";
import { requestZjuLearningDownload } from "./academicCredentialStore";
import { classifyCampusDownloadRequest } from "./downloadRequestPolicy";
import { showTransientNotification } from "./notificationCenter";
import { getAppLifecycleSettings } from "./appLifecycle";

let downloadEngine: DownloadEngine | null = null;
let initialization: Promise<DownloadEngine> | null = null;
let downloadPreferences: CampusDownloadPreferences | null = null;

const preferencesPath = (): string => join(app.getPath("userData"), "settings", "download-preferences.json");
const defaultDownloadDirectory = (): string => join(app.getPath("userData"), "downloads");

const normalizeDownloadDirectory = (value: unknown): string => {
  if (typeof value !== "string" || value.trim().length === 0 || !isAbsolute(value.trim())) {
    return defaultDownloadDirectory();
  }
  return normalize(value.trim());
};

const loadDownloadPreferences = async (): Promise<CampusDownloadPreferences> => {
  if (downloadPreferences) return { ...downloadPreferences };
  try {
    const input = JSON.parse(await readFile(preferencesPath(), "utf8")) as Partial<CampusDownloadPreferences>;
    downloadPreferences = {
      completionSound: input.completionSound !== false,
      downloadDirectory: normalizeDownloadDirectory(input.downloadDirectory)
    };
  } catch {
    downloadPreferences = {
      completionSound: true,
      downloadDirectory: defaultDownloadDirectory()
    };
  }
  return { ...downloadPreferences };
};

const saveDownloadPreferences = async (input: CampusDownloadPreferences): Promise<CampusDownloadPreferences> => {
  downloadPreferences = {
    completionSound: input.completionSound === true,
    downloadDirectory: normalizeDownloadDirectory(input.downloadDirectory)
  };
  const target = preferencesPath();
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(downloadPreferences, null, 2), "utf8");
  await rename(temporary, target);
  return { ...downloadPreferences };
};

interface DownloadHandlerEngine {
  getSummary: () => CampusDownloadTask[];
  enqueue: (input: CampusDownloadRequest) => Promise<{ id: string }>;
  pause: (id: string) => Promise<boolean>;
  resume: (id: string) => Promise<boolean>;
  cancel: (id: string) => Promise<boolean>;
  clearAll: () => Promise<number>;
  verify: (id: string) => Promise<CampusDownloadVerification>;
  clearHistory: () => Promise<number>;
  setDownloadRoot: (path: string) => void;
}

interface DownloadHandlerDependencies {
  loadEngine?: () => Promise<DownloadHandlerEngine>;
  openPath?: (path: string) => Promise<string>;
  showItemInFolder?: (path: string) => void;
  loadPreferences?: () => Promise<CampusDownloadPreferences>;
  savePreferences?: (input: CampusDownloadPreferences) => Promise<CampusDownloadPreferences>;
  selectDownloadDirectory?: (currentPath: string) => Promise<string | null>;
  ensureDirectory?: (path: string) => Promise<void>;
}

export const DOWNLOAD_COMPLETION_SOUND_CHANNEL =
  "campusos:downloads:completion-sound";

interface DownloadCompletionTrackerDependencies {
  notify?: (input: { title: string; body: string }) => Promise<void>;
  isSoundEnabled?: () => Promise<boolean>;
  broadcastSound?: () => void;
}

export const createDownloadCompletionTracker = ({
  notify = showTransientNotification,
  isSoundEnabled = async () =>
    (await getAppLifecycleSettings()).notificationEnabled &&
    (await loadDownloadPreferences()).completionSound,
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
      title,
      body
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
  initialization = (async () => {
    const preferences = await loadDownloadPreferences();
    const engine = downloadEngine ?? new DownloadEngine({
      downloadRoot: preferences.downloadDirectory,
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
    await engine.loadPersisted();
    return engine;
  })();
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
  showItemInFolder = shell.showItemInFolder,
  loadPreferences = loadDownloadPreferences,
  savePreferences = saveDownloadPreferences,
  selectDownloadDirectory = async (currentPath) => {
    const options: OpenDialogOptions = {
      title: "选择课件下载文件夹",
      defaultPath: currentPath,
      properties: ["openDirectory", "createDirectory"]
    };
    const parent = BrowserWindow.getFocusedWindow();
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  },
  ensureDirectory = async (path) => {
    await mkdir(path, { recursive: true });
  }
}: DownloadHandlerDependencies = {}): void => {
  registerTrustedIpcHandler("campusos:downloads:list", async () => {
    return (await loadEngine()).getSummary();
  });
  registerTrustedIpcHandler(
    "campusos:downloads:enqueue",
    async (input: CampusDownloadRequest) => {
      classifyCampusDownloadRequest(input);
      const engine = await loadEngine();
      const task = await engine.enqueue(input);
      return toTask(engine, task.id);
    }
  );
  for (const action of ["pause", "resume", "cancel"] as const) {
    registerTrustedIpcHandler(`campusos:downloads:${action}`, async (id: string) => {
      const engine = await loadEngine();
      const updated = await engine[action](id);
      return updated;
    });
  }
  registerTrustedIpcHandler("campusos:downloads:clear-all", async () => {
    const engine = await loadEngine();
    return completionTracker.suppressDuring(() => engine.clearAll());
  });
  registerTrustedIpcHandler("campusos:downloads:open", async (id: unknown) => {
    const task = toReadyTask(await loadEngine(), id);
    const issue = await openPath(task.targetPath);
    if (issue) throw new Error("系统无法打开该文件。");
  });
  registerTrustedIpcHandler("campusos:downloads:reveal", async (id: unknown) => {
    const task = toReadyTask(await loadEngine(), id);
    showItemInFolder(task.targetPath);
  });
  registerTrustedIpcHandler("campusos:downloads:verify", async (id: unknown) => {
    if (typeof id !== "string" || id.length === 0) throw new Error("下载任务标识无效。");
    return (await loadEngine()).verify(id);
  });
  registerTrustedIpcHandler("campusos:downloads:clear-history", async () => {
    return (await loadEngine()).clearHistory();
  });
  registerTrustedIpcHandler("campusos:downloads:get-preferences", async () => {
    return loadPreferences();
  });
  registerTrustedIpcHandler("campusos:downloads:save-preferences", async (input: unknown) => {
    if (typeof input !== "object" || input === null ||
      typeof (input as { completionSound?: unknown }).completionSound !== "boolean") {
      throw new Error("下载提醒设置无效。");
    }
    const current = await loadPreferences();
    return savePreferences({
      ...current,
      completionSound: (input as CampusDownloadPreferenceInput).completionSound
    });
  });
  registerTrustedIpcHandler("campusos:downloads:choose-directory", async () => {
    const current = await loadPreferences();
    const selected = await selectDownloadDirectory(current.downloadDirectory);
    if (selected === null) return null;
    const downloadDirectory = normalizeDownloadDirectory(selected);
    await ensureDirectory(downloadDirectory);
    const preferences = await savePreferences({
      ...current,
      downloadDirectory
    });
    (await loadEngine()).setDownloadRoot(preferences.downloadDirectory);
    return preferences;
  });
};
