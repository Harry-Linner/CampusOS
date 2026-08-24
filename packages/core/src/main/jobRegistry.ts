/**
 * 通用 job 注册表（dsh-jobs 式抽象）：
 * branded id（`<kind>-N` 顺序号）、状态生命周期、并发调度、进度与取消信号。
 * 下载队列（DownloadEngine）与未来的导出/同步任务共用此注册表。
 */

export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

export interface JobRecord<TMetadata = unknown> {
  /** branded id：`${kind}-${seq}`。 */
  id: string;
  kind: string;
  status: JobStatus;
  total: number;
  current: number;
  createdAt: string;
  updatedAt: string;
  failureMessage?: string;
  metadata: TMetadata;
}

export interface JobTask<TMetadata = unknown> {
  run: (
    job: JobRecord<TMetadata>,
    signal: AbortSignal
  ) => Promise<void>;
  metadata: TMetadata;
}

export interface JobRegistryOptions {
  /** 全局最大并发（按 kind 分别计数时传 perKindConcurrency）。 */
  maxConcurrent?: number;
  /** 每类 job 的并发上限。 */
  perKindConcurrency?: Record<string, number>;
  onChanged?: () => void;
  /** 状态发生结构性变化（完成/失败/取消/暂停等）时回调，供持久化。 */
  onFinalize?: (job: JobRecord) => void;
}

interface ScheduledJob {
  record: JobRecord;
  task: JobTask;
  controller: AbortController;
  /** 运行代际：resume 后旧 run 的收尾不得覆盖新 run 的状态。 */
  runGeneration: number;
}

const DEFAULT_MAX_CONCURRENT = 3;

const nextId = (kind: string, counters: Map<string, number>): string => {
  const seq = (counters.get(kind) ?? 0) + 1;
  counters.set(kind, seq);
  return `${kind}-${seq}`;
};

export class JobRegistry {
  private jobs = new Map<string, ScheduledJob>();
  private running = 0;
  private maxConcurrent: number;
  private perKindConcurrency: Record<string, number>;
  private kindCounters = new Map<string, number>();
  private onChanged: (() => void) | null;
  private onFinalize: ((job: JobRecord) => void) | null;

  constructor(options: JobRegistryOptions = {}) {
    const max = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    if (!Number.isInteger(max) || max < 1) {
      throw new Error("job 并发数必须是正整数。");
    }
    this.maxConcurrent = max;
    this.perKindConcurrency = options.perKindConcurrency ?? {};
    this.onChanged = options.onChanged ?? null;
    this.onFinalize = options.onFinalize ?? null;
  }

  get pendingCount(): number {
    return [...this.jobs.values()].filter(
      (scheduled) => scheduled.record.status === "queued"
    ).length;
  }

  get activeCount(): number {
    return this.running;
  }

  allJobs(): JobRecord[] {
    return [...this.jobs.values()].map((scheduled) => ({
      ...scheduled.record
    }));
  }

  jobsOfKind(kind: string): JobRecord[] {
    return this.allJobs().filter((job) => job.kind === kind);
  }

  getJob(id: string): JobRecord | null {
    return this.jobs.get(id)?.record ?? null;
  }

  enqueue<TMetadata>(
    kind: string,
    task: JobTask<TMetadata>
  ): JobRecord<TMetadata> {
    if (typeof kind !== "string" || !/^[a-z][a-z0-9-]*$/.test(kind)) {
      throw new Error("job kind 必须是合法标识符。");
    }
    const now = new Date().toISOString();
    const record: JobRecord<TMetadata> = {
      id: nextId(kind, this.kindCounters),
      kind,
      status: "queued",
      total: 0,
      current: 0,
      createdAt: now,
      updatedAt: now,
      metadata: task.metadata
    };
    this.jobs.set(record.id, {
      record: record as JobRecord,
      task: task as JobTask,
      controller: new AbortController(),
      runGeneration: 0
    });
    this.onChanged?.();
    this.drain();
    return { ...record };
  }

  pause(id: string): boolean {
    const scheduled = this.jobs.get(id);
    if (
      !scheduled ||
      scheduled.record.status === "completed" ||
      scheduled.record.status === "paused" ||
      scheduled.record.status === "canceled"
    ) {
      return false;
    }
    scheduled.record.status = "paused";
    scheduled.record.updatedAt = new Date().toISOString();
    scheduled.controller.abort();
    this.onChanged?.();
    return true;
  }

  resume(id: string): boolean {
    const scheduled = this.jobs.get(id);
    if (
      !scheduled ||
      (scheduled.record.status !== "paused" &&
        scheduled.record.status !== "failed")
    ) {
      return false;
    }
    // 暂停时 abort 过的 signal 不可复用，恢复时重建 controller 并推进代际。
    scheduled.controller = new AbortController();
    scheduled.runGeneration += 1;
    scheduled.record.status = "queued";
    scheduled.record.failureMessage = undefined;
    scheduled.record.updatedAt = new Date().toISOString();
    this.onChanged?.();
    this.drain();
    return true;
  }

  cancel(id: string): boolean {
    const scheduled = this.jobs.get(id);
    if (!scheduled) return false;
    scheduled.controller.abort();
    if (
      scheduled.record.status === "queued" ||
      scheduled.record.status === "paused" ||
      scheduled.record.status === "failed"
    ) {
      scheduled.record.status = "canceled";
      scheduled.record.updatedAt = new Date().toISOString();
      this.jobs.delete(id);
      this.onChanged?.();
      this.onFinalize?.({ ...scheduled.record });
      return true;
    }
    return false;
  }

  progress(id: string, current: number, total?: number): void {
    const scheduled = this.jobs.get(id);
    if (!scheduled) return;
    if (Number.isFinite(current) && current >= 0) {
      scheduled.record.current = current;
    }
    if (total !== undefined && Number.isFinite(total) && total >= 0) {
      scheduled.record.total = total;
    }
    scheduled.record.updatedAt = new Date().toISOString();
  }

  async waitForIdle(): Promise<void> {
    while (
      this.running > 0 ||
      [...this.jobs.values()].some(
        (scheduled) => scheduled.record.status === "queued"
      )
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }

  private kindRunningCount(kind: string): number {
    return [...this.jobs.values()].filter(
      (scheduled) =>
        scheduled.record.kind === kind &&
        scheduled.record.status === "running"
    ).length;
  }

  private drain(): void {
    while (true) {
      const candidate = [...this.jobs.values()].find((scheduled) => {
        if (scheduled.record.status !== "queued") return false;
        const kindLimit = this.perKindConcurrency[scheduled.record.kind];
        if (kindLimit !== undefined && this.kindRunningCount(scheduled.record.kind) >= kindLimit) {
          return false;
        }
        return true;
      });
      if (!candidate || this.running >= this.maxConcurrent) return;

      candidate.record.status = "running";
      candidate.record.updatedAt = new Date().toISOString();
      this.running += 1;
      this.onChanged?.();
      void this.runOne(candidate.record.id)
        .catch(() => undefined)
        .finally(() => {
          // 先减并发计数再 drain：被取代的旧 run 收尾后必须释放并尝试下一波。
          this.running -= 1;
          this.drain();
        });
    }
  }

  private async runOne(id: string): Promise<void> {
    const scheduled = this.jobs.get(id);
    if (!scheduled) return;
    const { record, task, controller } = scheduled;
    const generation = scheduled.runGeneration;
    try {
      await task.run(record, controller.signal);
      if (
        scheduled.runGeneration === generation &&
        record.status === "running"
      ) {
        record.status = "completed";
        record.updatedAt = new Date().toISOString();
      }
    } catch (error) {
      // 被 resume 取代的旧 run 不得覆盖新 run 的状态。
      if (scheduled.runGeneration === generation && record.status !== "paused") {
        record.status = "failed";
        record.failureMessage =
          error instanceof Error ? error.message : "job 执行失败。";
        record.updatedAt = new Date().toISOString();
      }
    } finally {
      this.onChanged?.();
      this.onFinalize?.({ ...record });
    }
  }
}

/** 模块级默认注册表：供下载、导出、同步等任务共享。 */
export const sharedJobRegistry = new JobRegistry({
  maxConcurrent: 3
});

export const createJobRegistry = (
  options: JobRegistryOptions = {}
): JobRegistry => new JobRegistry(options);
