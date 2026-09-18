import { app, BrowserWindow, net } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { autoUpdater as AutoUpdaterType } from "electron-updater";
import type {
  CampusAppInfo,
  UpdateSource,
  UpdateStatus
} from "../shared/updateBridge";
import { registerTrustedIpcHandler } from "./trustedIpc";

let currentStatus: UpdateStatus = app.isPackaged
  ? { state: "idle" }
  : { state: "unavailable" };
let updater: typeof AutoUpdaterType | null = null;
let updaterEventsBound = false;
let dismissedVersion: string | null | undefined;
let activeUpdateSource: UpdateSource = "github";

const GITHUB_OWNER = "Harry-Linner";
const GITHUB_REPO = "CampusOS";
const GITHUB_FAST_ORIGIN = "https://githubfast.com";

type ElectronUpdaterModule = {
  autoUpdater?: typeof AutoUpdaterType;
  default?: {
    autoUpdater?: typeof AutoUpdaterType;
  };
};

const dismissalPath = (): string => join(app.getPath("userData"), "settings", "update-preferences.json");

const loadDismissedVersion = async (): Promise<string | null> => {
  if (dismissedVersion !== undefined) return dismissedVersion;
  try {
    const parsed = JSON.parse(await readFile(dismissalPath(), "utf8")) as { dismissedVersion?: unknown };
    dismissedVersion = typeof parsed.dismissedVersion === "string" ? parsed.dismissedVersion : null;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      dismissedVersion = null;
    } else {
      dismissedVersion = null;
    }
  }
  return dismissedVersion;
};

const persistDismissedVersion = async (version: string): Promise<void> => {
  const target = dismissalPath();
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify({ dismissedVersion: version }, null, 2), "utf8");
  dismissedVersion = version;
};

const normalizeReleaseNotes = (value: unknown): string[] => {
  if (typeof value === "string") return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.map((entry) => typeof entry === "string" ? entry : typeof entry === "object" && entry !== null && "note" in entry && typeof entry.note === "string" ? entry.note : "").filter(Boolean);
};

const sanitizeUpdateError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (/network|internet|ENOTFOUND|ECONN|timed?\s*out/i.test(message)) {
    return "无法连接更新服务，请检查网络后重试。";
  }
  return "更新操作失败，请稍后重试。";
};

export const shouldTryGitHubFastFallback = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /github\.com/i.test(message) &&
    /(network|internet|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ECONN|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|ERR_PROXY_CONNECTION_FAILED|timed?\s*out|403|407|429|5\d\d)/i.test(message);
};

export const extractLatestReleaseTag = (atom: string): string => {
  const match = atom.match(
    /href="https:\/\/(?:github\.com|githubfast\.com)\/Harry-Linner\/CampusOS\/releases\/tag\/(v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)"/
  );
  if (!match) throw new Error("GitHubFast 返回的版本列表无效。");
  return match[1];
};

const configureGitHubProvider = (instance: typeof AutoUpdaterType): void => {
  activeUpdateSource = "github";
  instance.setFeedURL({ provider: "github", owner: GITHUB_OWNER, repo: GITHUB_REPO });
};

const configureGitHubFastProvider = async (instance: typeof AutoUpdaterType): Promise<void> => {
  activeUpdateSource = "githubfast";
  const atomUrl = `${GITHUB_FAST_ORIGIN}/${GITHUB_OWNER}/${GITHUB_REPO}/releases.atom`;
  const response = await net.fetch(atomUrl, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) {
    throw new Error(`GitHubFast 版本列表请求失败（HTTP ${response.status}）。`);
  }
  const tag = extractLatestReleaseTag(await response.text());
  instance.setFeedURL({
    provider: "generic",
    channel: "latest",
    url: `${GITHUB_FAST_ORIGIN}/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${encodeURIComponent(tag)}/`
  });
};

const emit = (status: UpdateStatus): void => {
  currentStatus = status;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("campusos:updater:changed", { ...status });
    }
  }
};

const bindUpdaterEvents = (instance: typeof AutoUpdaterType): void => {
  if (updaterEventsBound) return;
  updaterEventsBound = true;
  instance.autoDownload = false;
  instance.autoInstallOnAppQuit = false;
  instance.on("checking-for-update", () => emit({ state: "checking", source: activeUpdateSource }));
  instance.on("update-available", (info) => {
    const releaseNotes = normalizeReleaseNotes(info.releaseNotes);
    emit({ state: "available", version: info.version, prompt: dismissedVersion !== info.version, source: activeUpdateSource, ...(releaseNotes.length ? { releaseNotes } : {}) });
  });
  instance.on("update-not-available", (info) =>
    emit({ state: "up-to-date", version: info.version, source: activeUpdateSource })
  );
  instance.on("download-progress", (progress) =>
    emit({
      state: "downloading",
      version: currentStatus.version,
      source: activeUpdateSource,
      progress: Math.max(0, Math.min(100, progress.percent))
    })
  );
  instance.on("update-downloaded", (info) =>
    emit({ state: "ready", version: info.version, progress: 100, prompt: true, source: activeUpdateSource })
  );
  instance.on("error", (error) =>
    emit({ state: "error", error: sanitizeUpdateError(error), source: activeUpdateSource })
  );
};

export const resolveAutoUpdater = (module: ElectronUpdaterModule): typeof AutoUpdaterType => {
  const instance = module.autoUpdater ?? module.default?.autoUpdater;
  if (!instance) {
    throw new Error("更新组件加载失败。");
  }
  return instance;
};

const getAutoUpdater = async (): Promise<typeof AutoUpdaterType> => {
  if (!updater) {
    const module = await import("electron-updater") as ElectronUpdaterModule;
    updater = resolveAutoUpdater(module);
    bindUpdaterEvents(updater);
  }
  return updater;
};

export const getUpdateStatus = (): Readonly<UpdateStatus> => ({ ...currentStatus });

export const checkForUpdates = async (): Promise<UpdateStatus> => {
  if (!app.isPackaged) {
    emit({ state: "unavailable" });
    return getUpdateStatus();
  }
  if (currentStatus.state === "downloading" || currentStatus.state === "ready") {
    return getUpdateStatus();
  }

  let fallbackAttempted = false;
  try {
    await loadDismissedVersion();
    const instance = await getAutoUpdater();
    configureGitHubProvider(instance);
    emit({ state: "checking", source: "github" });
    try {
      await instance.checkForUpdates();
    } catch (error) {
      if (!shouldTryGitHubFastFallback(error)) throw error;
      fallbackAttempted = true;
      await configureGitHubFastProvider(instance);
      emit({ state: "checking", source: "githubfast" });
      await instance.checkForUpdates();
    }
  } catch (error) {
    emit({
      state: "error",
      error: fallbackAttempted
        ? "GitHub 与 GitHubFast 镜像均无法连接，请稍后重试。"
        : sanitizeUpdateError(error),
      source: activeUpdateSource
    });
  }
  return getUpdateStatus();
};

export const downloadUpdate = async (): Promise<UpdateStatus> => {
  if (currentStatus.state !== "available") {
    return getUpdateStatus();
  }

  try {
    emit({
      state: "downloading",
      version: currentStatus.version,
      source: activeUpdateSource,
      progress: 0
    });
    await (await getAutoUpdater()).downloadUpdate();
  } catch (error) {
    emit({ state: "error", error: sanitizeUpdateError(error), source: activeUpdateSource });
  }
  return getUpdateStatus();
};

export const cancelDownload = async (): Promise<UpdateStatus> => {
  if (currentStatus.state !== "downloading") return getUpdateStatus();
  try {
    const instance = await getAutoUpdater();
    const cancellable = instance as typeof instance & { cancelDownload?: () => void };
    if (typeof cancellable.cancelDownload === "function") cancellable.cancelDownload();
    emit({ state: "available", version: currentStatus.version, source: activeUpdateSource });
  } catch (error) {
    emit({ state: "error", error: sanitizeUpdateError(error), source: activeUpdateSource });
  }
  return getUpdateStatus();
};

export const dismissUpdate = async (version: string): Promise<UpdateStatus> => {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("更新版本号无效。");
  }
  await persistDismissedVersion(version);
  if (currentStatus.version === version &&
    (currentStatus.state === "available" || currentStatus.state === "ready")) {
    emit({ ...currentStatus, prompt: false });
  }
  return getUpdateStatus();
};

export const quitAndInstall = async (): Promise<void> => {
  if (currentStatus.state !== "ready") return;
  (await getAutoUpdater()).quitAndInstall();
};

const getAppInfo = (): CampusAppInfo => ({
  name: app.getName(),
  version: app.getVersion(),
  packaged: app.isPackaged,
  licenseName: "MIT",
  copyright: "Copyright (c) 2026 Harry-Linner"
});

export const registerUpdateHandlers = (): void => {
  registerTrustedIpcHandler("campusos:app:info", () => {
    return getAppInfo();
  });
  registerTrustedIpcHandler("campusos:updater:check", async () => {
    return checkForUpdates();
  });
  registerTrustedIpcHandler("campusos:updater:download", async () => {
    return downloadUpdate();
  });
  registerTrustedIpcHandler("campusos:updater:cancel", async () => {
    return cancelDownload();
  });
  registerTrustedIpcHandler("campusos:updater:dismiss", async (version: unknown) => {
    if (typeof version !== "string") throw new Error("更新版本号无效。");
    return dismissUpdate(version);
  });
  registerTrustedIpcHandler("campusos:updater:install", async () => {
    await quitAndInstall();
  });
  registerTrustedIpcHandler("campusos:updater:status", () => {
    return getUpdateStatus();
  });
};
