import { describe, expect, it, vi } from "vitest";
import { createRefreshCoordinator } from "./refreshCoordinator";

describe("refresh coordinator", () => {
  it("runs the same source once when foreground refreshes overlap", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refresh = vi.fn(async () => {
      await gate;
      return {
        sourceId: "zju-undergraduate",
        status: "cache" as const,
        updatedAt: "2026-07-19T04:00:00.000Z"
      };
    });
    const coordinator = createRefreshCoordinator();
    coordinator.register("zju-undergraduate", refresh);

    const first = coordinator.runAll();
    const second = coordinator.runAll();
    expect(refresh).toHaveBeenCalledTimes(1);

    release?.();
    await expect(first).resolves.toEqual(await second);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("runs dependent refresh jobs only after their providers finish", async () => {
    const order: string[] = [];
    const coordinator = createRefreshCoordinator();
    coordinator.register(
      "academic-exams-events",
      async () => {
        order.push("events");
        return {
          sourceId: "academic-exams-events",
          status: "live",
          updatedAt: "2026-07-19T04:01:00.000Z"
        };
      },
      { after: ["zju-undergraduate"] }
    );
    coordinator.register("zju-undergraduate", async () => {
      order.push("source");
      return {
        sourceId: "zju-undergraduate",
        status: "live",
        updatedAt: "2026-07-19T04:00:00.000Z"
      };
    });

    await coordinator.runAll();

    expect(order).toEqual(["source", "events"]);
  });

  it("reports dependency configuration failures without running the job", async () => {
    const refresh = vi.fn();
    const coordinator = createRefreshCoordinator();
    coordinator.register("calendar-events", refresh, {
      after: ["missing-source"]
    });

    await expect(coordinator.runAll()).resolves.toEqual([
      expect.objectContaining({
        sourceId: "calendar-events",
        status: "unavailable",
        message: "刷新依赖未注册：missing-source"
      })
    ]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("runOne 运行单个已注册来源并返回结果", async () => {
    const coordinator = createRefreshCoordinator();
    coordinator.register("zju-undergraduate", async () => ({
      sourceId: "zju-undergraduate",
      status: "live",
      updatedAt: "2026-07-19T04:00:00.000Z"
    }));

    await expect(coordinator.runOne("zju-undergraduate")).resolves.toEqual({
      sourceId: "zju-undergraduate",
      status: "live",
      updatedAt: "2026-07-19T04:00:00.000Z"
    });
    await expect(coordinator.runOne("missing-source")).resolves.toBeNull();
  });

  it("recordResult 收到请求指纹与失败分类（供健康台账）", async () => {
    const recordResult = vi.fn();
    const coordinator = createRefreshCoordinator({ recordResult });
    coordinator.register("zju-calendar-config", async () => ({
      sourceId: "zju-calendar-config",
      status: "unavailable",
      updatedAt: "2026-07-19T04:00:00.000Z",
      message: "浙江大学官网校历请求超时。",
      requestFingerprint: "abc123",
      retryClassification: "retryable" as const
    }));

    await coordinator.runAll();

    expect(recordResult).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "zju-calendar-config",
        requestFingerprint: "abc123",
        retryClassification: "retryable"
      }),
      expect.any(Number)
    );
  });
});
