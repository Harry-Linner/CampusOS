import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { app } from "electron";
import type {
  CampusDownloadStatus,
  CampusDownloadTask,
  CampusSourceId
} from "@campusos/shared";

export interface DownloadQueueItem {
  id: string;
  url: string;
  title: string;
  courseName: string;
  sourceId: CampusSourceId;
  semester: string;
  targetPath: string;
  temporaryPath: string;
  totalBytes: number;
  downloadedBytes: number;
  status: CampusDownloadStatus;
  createdAt: string;
  updatedAt: string;
  failureMessage?: string;
}

export interface DownloadQueuePersistence {
  load: () => Promise<DownloadQueueItem[]>;
  save: (queue: readonly DownloadQueueItem[]) => Promise<void>;
}

export interface DownloadEngineOptions {
  maxConcurrent?: number;
  downloadRoot?: string;
  persistencePath?: string;
  requestTimeoutMs?: number;
  onChanged?: () => void;
  queuePersistence?: DownloadQueuePersistence;
}

interface ActiveDownload {
  item: DownloadQueueItem;
  controller: AbortController;
}

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const safePathSegment = (value: string, label: string): string => {
  const safeValue = value
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!safeValue || safeValue === "." || safeValue === "..") {
    throw new Error(`${label} 不能为空或包含无效路径。`);
  }
  return safeValue;
};

const getHttpUrl = (value: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("下载地址不是有效 URL。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("下载地址只支持 HTTP 或 HTTPS。");
  }
  return url;
};

export class DownloadEngine {
  private queue: DownloadQueueItem[] = [];
  private active = new Map<string, ActiveDownload>();
  private runningOperations = 0;
  private maxConcurrent: number;
  private downloadRoot: string;
  private requestTimeoutMs: number;
  private persistencePath: string;
  private onChanged: (() => void) | null;
  private queuePersistence: DownloadQueuePersistence | null;

  constructor(options: DownloadEngineOptions = {}) {
    if (!Number.isInteger(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT) ||
      (options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT) < 1) {
      throw new Error("下载并发数必须是正整数。");
    }
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    const userDataPath =
      options.downloadRoot && options.persistencePath
        ? null
        : app.getPath("userData");
    this.downloadRoot = options.downloadRoot ?? join(userDataPath!, "downloads");
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.persistencePath = options.persistencePath ?? join(
      userDataPath!,
      "downloads",
      "queue-state.json"
    );
    this.onChanged = options.onChanged ?? null;
    this.queuePersistence = options.queuePersistence ?? null;
  }

  get pendingCount(): number {
    return this.queue.filter((item) => item.status === "queued").length;
  }

  get activeCount(): number {
    return this.active.size;
  }

  get allTasks(): readonly DownloadQueueItem[] {
    return [...this.queue];
  }

  async enqueue(task: {
    url: string;
    title: string;
    courseName: string;
    sourceId: CampusSourceId;
    semester: string;
  }): Promise<DownloadQueueItem> {
    getHttpUrl(task.url);
    const fileName = safePathSegment(basename(task.title), "文件名");
    const semester = safePathSegment(task.semester, "学期");
    const courseName = safePathSegment(task.courseName, "课程名");
    const targetPath = join(this.downloadRoot, semester, courseName, fileName);

    const existing = this.queue.find(
      (item) => item.url === task.url && item.targetPath === targetPath
    );
    if (existing) return existing;

    const now = new Date().toISOString();
    const item: DownloadQueueItem = {
      id: randomUUID(),
      url: task.url,
      title: fileName,
      courseName,
      sourceId: task.sourceId,
      semester,
      targetPath,
      temporaryPath: `${targetPath}.part`,
      totalBytes: 0,
      downloadedBytes: 0,
      status: "queued",
      createdAt: now,
      updatedAt: now
    };

    this.queue.push(item);
    await this.persist();
    this.onChanged?.();
    this.drain();
    return item;
  }

  async pause(id: string): Promise<boolean> {
    const item = this.queue.find((candidate) => candidate.id === id);
    if (!item || item.status === "ready" || item.status === "paused") return false;
    item.status = "paused";
    item.updatedAt = new Date().toISOString();
    this.active.get(id)?.controller.abort();
    await this.persist();
    this.onChanged?.();
    return true;
  }

  async resume(id: string): Promise<boolean> {
    const item = this.queue.find((candidate) => candidate.id === id);
    if (!item || item.status !== "paused") return false;
    item.status = "queued";
    item.failureMessage = undefined;
    item.updatedAt = new Date().toISOString();
    await this.persist();
    this.onChanged?.();
    this.drain();
    return true;
  }

  async cancel(id: string): Promise<boolean> {
    const itemIndex = this.queue.findIndex((item) => item.id === id);
    if (itemIndex < 0) return false;
    const [item] = this.queue.splice(itemIndex, 1);
    this.active.get(id)?.controller.abort();
    await rm(item.temporaryPath, { force: true });
    await this.persist();
    this.onChanged?.();
    return true;
  }

  getSummary(): CampusDownloadTask[] {
    return this.queue.map((item) => ({
      id: item.id,
      title: item.title,
      courseName: item.courseName,
      sourceId: item.sourceId,
      progress: item.totalBytes > 0
        ? Math.min(100, Math.round((item.downloadedBytes / item.totalBytes) * 100))
        : 0,
      status: item.status,
      targetPath: item.targetPath
    }));
  }

  async loadPersisted(): Promise<void> {
    if (this.queuePersistence) {
      this.queue = (await this.queuePersistence.load()).map((item) => ({
        ...item,
        temporaryPath: item.temporaryPath ?? `${item.targetPath}.part`,
        status: item.status === "syncing" ? "queued" : item.status
      }));
      this.drain();
      return;
    }
    try {
      const parsed = JSON.parse(
        await readFile(this.persistencePath, "utf8")
      ) as { queue?: DownloadQueueItem[] };
      if (Array.isArray(parsed.queue)) {
        this.queue = parsed.queue.map((item) => ({
          ...item,
          temporaryPath: item.temporaryPath ?? `${item.targetPath}.part`,
          status: item.status === "syncing" ? "queued" : item.status
        }));
      }
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
    this.drain();
  }

  async waitForIdle(): Promise<void> {
    while (
      this.runningOperations > 0 ||
      this.queue.some((item) => item.status === "queued" || item.status === "syncing")
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }

  async persist(): Promise<void> {
    if (this.queuePersistence) {
      await this.queuePersistence.save(this.queue);
      return;
    }
    await mkdir(dirname(this.persistencePath), { recursive: true });
    const temporaryPath = `${this.persistencePath}.${randomUUID()}.tmp`;
    await writeFile(
      temporaryPath,
      JSON.stringify({ queue: this.queue }),
      "utf8"
    );
    await rename(temporaryPath, this.persistencePath);
  }

  private drain(): void {
    while (
      this.active.size < this.maxConcurrent &&
      this.queue.some((item) => item.status === "queued")
    ) {
      const item = this.queue.find((candidate) => candidate.status === "queued");
      if (!item) return;
      item.status = "syncing";
      item.updatedAt = new Date().toISOString();
      this.runningOperations += 1;
      void this.downloadOne(item)
        .catch(() => undefined)
        .finally(() => {
          this.runningOperations -= 1;
        });
    }
  }

  private async downloadOne(item: DownloadQueueItem): Promise<void> {
    const controller = new AbortController();
    this.active.set(item.id, { item, controller });
    try {
      await this.doDownload(item, controller);
    } catch (error) {
      if (item.status !== "paused") {
        item.status = "failed";
        item.failureMessage = error instanceof Error ? error.message : "下载失败。";
        item.updatedAt = new Date().toISOString();
      }
    } finally {
      this.active.delete(item.id);
      await this.persist();
      this.onChanged?.();
      this.drain();
    }
  }

  private async doDownload(
    item: DownloadQueueItem,
    controller: AbortController
  ): Promise<void> {
    await mkdir(dirname(item.targetPath), { recursive: true });
    let resumeOffset = 0;
    try {
      resumeOffset = (await stat(item.temporaryPath)).size;
      item.downloadedBytes = resumeOffset;
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }

    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(item.url, {
        signal: controller.signal,
        headers: resumeOffset > 0 ? { Range: `bytes=${resumeOffset}-` } : {}
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok && response.status !== 206) {
      throw new Error(`下载失败：HTTP ${response.status}`);
    }

    if (resumeOffset > 0 && response.status !== 206) {
      resumeOffset = 0;
      item.downloadedBytes = 0;
    }
    const contentLength = response.headers.get("content-length");
    item.totalBytes = resumeOffset + (contentLength ? Number.parseInt(contentLength, 10) : 0);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("无法读取下载响应流。");
    const file = await open(item.temporaryPath, resumeOffset > 0 ? "a" : "w");

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          await file.write(value);
          item.downloadedBytes += value.byteLength;
          item.updatedAt = new Date().toISOString();
        }
      }
    } finally {
      await file.close();
      reader.releaseLock();
    }

    await rename(item.temporaryPath, item.targetPath);
    item.status = "ready";
    item.failureMessage = undefined;
    item.updatedAt = new Date().toISOString();
  }
}
