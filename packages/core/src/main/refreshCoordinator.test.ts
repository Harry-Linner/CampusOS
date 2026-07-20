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
});
