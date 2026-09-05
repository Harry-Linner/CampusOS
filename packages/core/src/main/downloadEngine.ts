import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { app } from "electron";
import type {
  CampusDownloadStatus,
  CampusDownloadTask,
  CampusSourceId
} from "@campusos/shared";
import { JobRegistry, type JobStatus } from "./jobRegistry";

export interface DownloadQueueItem {
  id: string;
  url: string;
  fallbackUrl?: string;
  expectedBytes?: number;
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
  resolveResponse?: DownloadResponseResolver;
}

export interface DownloadResponseRequest {
  item: Readonly<DownloadQueueItem>;
  headers: Record<string, string>;
  signal: AbortSignal;
}

export type DownloadResponseResolver = (
  request: DownloadResponseRequest
) => Promise<Response>;

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

const mapJobStatus = (status: JobStatus): CampusDownloadStatus => {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "syncing";
    case "paused":
      return "paused";
    case "completed":
      return "ready";
    case "failed":
      return "failed";
    case "canceled":
      return "failed";
  }
};

export class DownloadEngine {
  private registry: JobRegistry;
  private items = new Map<string, DownloadQueueItem>();
  private downloadRoot: string;
  private requestTimeoutMs: number;
  private persistencePath: string;
  private onChanged: (() => void) | null;
  private queuePersistence: DownloadQueuePersistence | null;
  private resolveResponse: DownloadResponseResolver;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(options: DownloadEngineOptions = {}) {
    if (!Number.isInteger(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT) ||
      (options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT) < 1) {
      throw new Error("下载并发数必须是正整数。");
    }
    const maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
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
    this.resolveResponse = options.resolveResponse ?? ((request) =>
      fetch(request.item.url, {
        signal: request.signal,
        headers: request.headers
      }));
    this.registry = new JobRegistry({
      maxConcurrent,
      onChanged: () => {
        this.syncFromRegistry();
        this.onChanged?.();
      },
      onFinalize: (job) => {
        void this.persist().catch(() => undefined);
        void job;
      }
    });
  }

  get pendingCount(): number {
    return this.registry.pendingCount;
  }

  get activeCount(): number {
    return this.registry.activeCount;
  }

  get allTasks(): readonly DownloadQueueItem[] {
    return [...this.items.values()];
  }

  async enqueue(task: {
    url: string;
    fallbackUrl?: string;
    expectedBytes?: number;
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

    const existing = [...this.items.values()].find(
      (item) => item.url === task.url && item.targetPath === targetPath
    );
    if (existing) {
      const expectedBytes = task.expectedBytes;
      let targetSize: number | null = null;
      try {
        targetSize = (await stat(existing.targetPath)).size;
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
      const targetMatches = targetSize !== null &&
        (expectedBytes === undefined || targetSize === expectedBytes);
      if (existing.status === "ready" && targetMatches) return existing;
      if (existing.status === "syncing" || existing.status === "queued") return existing;

      existing.fallbackUrl = task.fallbackUrl;
      existing.expectedBytes = expectedBytes;
      existing.status = "queued";
      existing.totalBytes = expectedBytes ?? 0;
      existing.downloadedBytes = 0;
      existing.failureMessage = undefined;
      existing.updatedAt = new Date().toISOString();
      await rm(existing.temporaryPath, { force: true });
      await this.persist();
      this.onChanged?.();
      this.schedule(existing);
      return existing;
    }

    const now = new Date().toISOString();
    const item: DownloadQueueItem = {
      id: randomUUID(),
      url: task.url,
      fallbackUrl: task.fallbackUrl,
      expectedBytes: task.expectedBytes,
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

    this.items.set(item.id, item);
    await this.persist();
    this.onChanged?.();
    this.schedule(item);
    return item;
  }

  private jobIdFor(itemId: string): string | null {
    return (
      this.registry
        .allJobs()
        .find((job) => job.metadata === itemId)?.id ?? null
    );
  }

  async pause(id: string): Promise<boolean> {
    const item = this.items.get(id);
    if (!item || item.status === "ready" || item.status === "paused") return false;
    const jobId = this.jobIdFor(id);
    if (jobId === null || !this.registry.pause(jobId)) return false;
    item.status = "paused";
    item.updatedAt = new Date().toISOString();
    await this.persist();
    this.onChanged?.();
    return true;
  }

  async resume(id: string): Promise<boolean> {
    const item = this.items.get(id);
    if (!item || (item.status !== "paused" && item.status !== "failed")) return false;
    const jobId = this.jobIdFor(id);
    if (jobId === null || !this.registry.resume(jobId)) {
      // 终态（无对应 job 或 job 已结束）→ 重新排队
      item.status = "queued";
      item.failureMessage = undefined;
      item.updatedAt = new Date().toISOString();
      this.schedule(item);
      await this.persist();
      this.onChanged?.();
      return true;
    }
    item.status = "queued";
    item.failureMessage = undefined;
    item.updatedAt = new Date().toISOString();
    await this.persist();
    this.onChanged?.();
    return true;
  }

  async cancel(id: string): Promise<boolean> {
    const item = this.items.get(id);
    if (!item) return false;
    const jobId = this.jobIdFor(id);
    if (jobId !== null) this.registry.cancel(jobId);
    this.items.delete(id);
    await rm(item.temporaryPath, { force: true });
    await this.persist();
    this.onChanged?.();
    return true;
  }

  /** 清空整个下载队列。活动任务会先取消，最终文件保留，仅删除临时文件。 */
  async clearAll(): Promise<number> {
    const items = [...this.items.values()];
    if (items.length === 0) return 0;

    for (const item of items) {
      const jobId = this.jobIdFor(item.id);
      if (jobId !== null) this.registry.cancel(jobId);
    }
    await this.registry.waitForIdle();

    this.items.clear();
    await Promise.all(
      items.map((item) => rm(item.temporaryPath, { force: true }).catch(() => undefined))
    );
    await this.persist();
    this.onChanged?.();
    return items.length;
  }

  getSummary(): CampusDownloadTask[] {
    return [...this.items.values()].map((item) => ({
      id: item.id,
      title: item.title,
      courseName: item.courseName,
      sourceId: item.sourceId,
      progress: item.totalBytes > 0
        ? Math.min(100, Math.round((item.downloadedBytes / item.totalBytes) * 100))
        : 0,
      status: item.status,
      targetPath: item.targetPath,
      failureMessage: item.failureMessage,
      createdAt: item.createdAt
    }));
  }

  async loadPersisted(): Promise<void> {
    if (this.queuePersistence) {
      this.items = new Map(
        (await this.queuePersistence.load()).map((item) => [
          item.id,
          {
            ...item,
            temporaryPath: item.temporaryPath ?? `${item.targetPath}.part`,
            status: item.status === "syncing" ? "queued" : item.status
          }
        ])
      );
    } else {
      try {
        const parsed = JSON.parse(
          await readFile(this.persistencePath, "utf8")
        ) as { queue?: DownloadQueueItem[] };
        if (Array.isArray(parsed.queue)) {
          this.items = new Map(
            parsed.queue.map((item) => [
              item.id,
              {
                ...item,
                temporaryPath: item.temporaryPath ?? `${item.targetPath}.part`,
                status: item.status === "syncing" ? "queued" : item.status
              }
            ])
          );
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
    }
    for (const item of this.items.values()) {
      if (item.status === "queued") this.schedule(item);
    }
  }

  async waitForIdle(): Promise<void> {
    await this.registry.waitForIdle();
  }

  async persist(): Promise<void> {
    // 串行化持久化：onFinalize 的异步 persist 与主动调用可能并发，
    // 并发写临时文件后 rename 会相互覆盖（EPERM）。
    const operation = this.persistChain.then(async () => {
      if (this.queuePersistence) {
        await this.queuePersistence.save([...this.items.values()]);
        return;
      }
      await mkdir(dirname(this.persistencePath), { recursive: true });
      const temporaryPath = `${this.persistencePath}.${randomUUID()}.tmp`;
      await writeFile(
        temporaryPath,
        JSON.stringify({ queue: [...this.items.values()] }),
        "utf8"
      );
      await rename(temporaryPath, this.persistencePath);
    });
    this.persistChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
  }

  private schedule(item: DownloadQueueItem): void {
    if (item.status === "ready" || item.status === "paused") return;
    this.registry.enqueue("download", {
      metadata: item.id,
      run: async (record, signal) => {
        const current = this.items.get(record.metadata as string);
        if (!current) return;
        current.status = "syncing";
        try {
          await this.doDownload(current, signal);
        } finally {
          // 确保 waitForIdle 返回前最终状态已持久化（避免与清理竞态）。
          await this.persist().catch(() => undefined);
        }
      }
    });
  }

  private syncFromRegistry(): void {
    for (const job of this.registry.allJobs()) {
      const item = this.items.get(job.metadata as string);
      if (!item) continue;
      item.status = mapJobStatus(job.status);
      item.updatedAt = job.updatedAt;
      item.failureMessage = job.failureMessage;
    }
  }

  private async doDownload(
    item: DownloadQueueItem,
    jobSignal: AbortSignal
  ): Promise<void> {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    jobSignal.addEventListener("abort", onAbort, { once: true });
    try {
      await this.downloadStream(item, controller);
    } finally {
      jobSignal.removeEventListener("abort", onAbort);
    }
  }

  private async downloadStream(
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
      response = await this.resolveResponse({
        item,
        signal: controller.signal,
        headers: resumeOffset > 0 ? { Range: `bytes=${resumeOffset}-` } : {}
      });
    } finally {
      clearTimeout(timeout);
    }
    if (controller.signal.aborted) {
      await response.body?.cancel();
      throw new DOMException("下载已取消。", "AbortError");
    }
    if (!response.ok && response.status !== 206) {
      throw new Error(`下载失败：HTTP ${response.status}`);
    }

    if (resumeOffset > 0 && response.status !== 206) {
      resumeOffset = 0;
      item.downloadedBytes = 0;
    }
    const contentLength = response.headers.get("content-length");
    const responseBytes = contentLength ? Number.parseInt(contentLength, 10) : null;
    const responseTotalBytes = responseBytes !== null &&
      Number.isSafeInteger(responseBytes) &&
      responseBytes >= 0
      ? resumeOffset + responseBytes
      : item.expectedBytes;
    item.totalBytes = responseTotalBytes ?? 0;

    // zju-learning-assistant src-tauri/src/controller.rs:779-816 uses the
    // selected reference/preview response length for its final skip decision.
    // Preview files can legitimately differ from the upload metadata size.
    if (resumeOffset === 0 && responseTotalBytes !== undefined) {
      try {
        const targetSize = (await stat(item.targetPath)).size;
        if (targetSize === responseTotalBytes) {
          await response.body?.cancel();
          item.downloadedBytes = targetSize;
          item.status = "ready";
          item.failureMessage = undefined;
          item.updatedAt = new Date().toISOString();
          return;
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
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("无法读取下载响应流。");
    const file = await open(item.temporaryPath, resumeOffset > 0 ? "a" : "w");

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (controller.signal.aborted) {
          throw new DOMException("下载已取消。", "AbortError");
        }
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

    if (responseTotalBytes !== undefined && item.downloadedBytes !== responseTotalBytes) {
      throw new Error(
        `下载文件大小不匹配：预期 ${responseTotalBytes} 字节，实际 ${item.downloadedBytes} 字节。`
      );
    }

    await rename(item.temporaryPath, item.targetPath);
    item.status = "ready";
    item.failureMessage = undefined;
    item.updatedAt = new Date().toISOString();
  }
}
