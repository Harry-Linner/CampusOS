import { describe, expect, it } from "vitest";
import { createJobRegistry } from "./jobRegistry";

describe("JobRegistry（通用 job 注册表）", () => {
  it("生成 branded id `<kind>-N` 顺序号", () => {
    const registry = createJobRegistry({ maxConcurrent: 1 });
    const first = registry.enqueue("download", {
      run: async () => undefined,
      metadata: {}
    });
    const second = registry.enqueue("download", {
      run: async () => undefined,
      metadata: {}
    });
    const exportJob = registry.enqueue("export", {
      run: async () => undefined,
      metadata: {}
    });
    expect(first.id).toBe("download-1");
    expect(second.id).toBe("download-2");
    expect(exportJob.id).toBe("export-1");
  });

  it("按并发上限执行并流转生命周期", async () => {
    let concurrent = 0;
    let peakConcurrent = 0;
    const registry = createJobRegistry({ maxConcurrent: 2 });
    for (let index = 0; index < 3; index += 1) {
      registry.enqueue("download", {
        run: async () => {
          concurrent += 1;
          peakConcurrent = Math.max(peakConcurrent, concurrent);
          await new Promise((resolve) => setTimeout(resolve, 5));
          concurrent -= 1;
        },
        metadata: {}
      });
    }

    await registry.waitForIdle();

    expect(peakConcurrent).toBeLessThanOrEqual(2);
    expect(registry.jobsOfKind("download").map((job) => job.status)).toEqual([
      "completed",
      "completed",
      "completed"
    ]);
  });

  it("按 kind 并发限制执行", async () => {
    const order: string[] = [];
    const registry = createJobRegistry({
      maxConcurrent: 4,
      perKindConcurrency: { download: 1 }
    });
    registry.enqueue("download", {
      run: async (job) => {
        order.push(`${job.id}:start`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(`${job.id}:end`);
      },
      metadata: {}
    });
    registry.enqueue("download", {
      run: async (job) => {
        order.push(`${job.id}:start`);
        order.push(`${job.id}:end`);
      },
      metadata: {}
    });

    await registry.waitForIdle();

    expect(order).toEqual([
      "download-1:start",
      "download-1:end",
      "download-2:start",
      "download-2:end"
    ]);
  });

  it("失败记录 failureMessage 并置为 failed，可 resume", async () => {
    let attempts = 0;
    const registry = createJobRegistry({ maxConcurrent: 1 });
    const job = registry.enqueue("download", {
      run: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("下载失败：HTTP 500");
        }
      },
      metadata: {}
    });

    await registry.waitForIdle();

    const failed = registry.getJob(job.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.failureMessage).toBe("下载失败：HTTP 500");

    expect(registry.resume(job.id)).toBe(true);
    await registry.waitForIdle();
    const resumed = registry.getJob(job.id);
    expect(resumed?.status).toBe("completed");
    expect(resumed?.failureMessage).toBeUndefined();
  });

  it("pause 中止执行，resume 重新排队", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const registry = createJobRegistry({ maxConcurrent: 1 });
    const job = registry.enqueue("download", {
      run: async (_job, signal) => {
        await gate;
        if (signal.aborted) throw new Error("aborted");
      },
      metadata: {}
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(registry.pause(job.id)).toBe(true);
    release?.();
    await registry.waitForIdle();
    expect(registry.getJob(job.id)?.status).toBe("paused");

    expect(registry.resume(job.id)).toBe(true);
    await registry.waitForIdle();
    expect(registry.getJob(job.id)?.status).toBe("completed");
  });

  it("cancel 移除排队中的 job", async () => {
    const registry = createJobRegistry({ maxConcurrent: 1 });
    const first = registry.enqueue("download", {
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
      metadata: {}
    });
    const second = registry.enqueue("download", {
      run: async () => undefined,
      metadata: {}
    });
    expect(registry.cancel(second.id)).toBe(true);
    expect(registry.getJob(second.id)).toBeNull();
    await registry.waitForIdle();
    expect(registry.getJob(first.id)?.status).toBe("completed");
  });

  it("progress 更新进度并触发 onChanged", () => {
    let changedCount = 0;
    const registry = createJobRegistry({
      maxConcurrent: 1,
      onChanged: () => {
        changedCount += 1;
      }
    });
    const job = registry.enqueue("export", {
      run: async () => undefined,
      metadata: {}
    });
    registry.progress(job.id, 50, 100);
    expect(registry.getJob(job.id)?.current).toBe(50);
    expect(registry.getJob(job.id)?.total).toBe(100);
    expect(changedCount).toBeGreaterThan(0);
  });

  it("onFinalize 在每个 job 结束（完成/失败/取消）时回调", async () => {
    const finalized: string[] = [];
    const registry = createJobRegistry({
      maxConcurrent: 1,
      onFinalize: (job) => {
        finalized.push(`${job.id}:${job.status}`);
      }
    });
    const job = registry.enqueue("sync", {
      run: async () => undefined,
      metadata: {}
    });
    await registry.waitForIdle();
    expect(finalized).toContain(`${job.id}:completed`);
  });

  it("非法 kind 抛错", () => {
    const registry = createJobRegistry();
    expect(() =>
      registry.enqueue("Bad Kind", { run: async () => undefined, metadata: {} })
    ).toThrow("job kind");
  });
});
