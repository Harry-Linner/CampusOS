import type { CampusDownloadRequest } from "@campusos/shared";
import type { CampusosBridge } from "../../shared/campusBridge";

const requireCampusosBridge = (): CampusosBridge => {
  if (typeof window === "undefined" || !window.campusos) {
    throw new Error("CampusOS 主进程连接不可用，无法管理下载任务。");
  }
  return window.campusos;
};

export const enqueueDownload = async (input: CampusDownloadRequest): Promise<void> => {
  await requireCampusosBridge().downloads.enqueue(input);
};

export const pauseDownload = async (id: string): Promise<void> => {
  await requireCampusosBridge().downloads.pause(id);
};

export const resumeDownload = async (id: string): Promise<void> => {
  await requireCampusosBridge().downloads.resume(id);
};

export const cancelDownload = async (id: string): Promise<void> => {
  await requireCampusosBridge().downloads.cancel(id);
};

export const subscribeToDownloadChanges = (listener: () => void): (() => void) =>
  requireCampusosBridge().downloads.subscribe(listener);
