import { describe, expect, it, vi } from "vitest";
import { createWorkspaceRefreshScheduler } from "./workspaceRefreshScheduler";

describe("workspace refresh scheduler", () => {
  it("refreshes immediately and periodically from the main process", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => undefined);
    const scheduler = createWorkspaceRefreshScheduler({
      refresh,
      intervalMs: 1_000
    });

    scheduler.start();
    await vi.runAllTicks();
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("keeps refresh single-flight when an interval elapses during a request", async () => {
    vi.useFakeTimers();
    let resolveRefresh!: () => void;
    const refresh = vi.fn(
      () => new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      })
    );
    const scheduler = createWorkspaceRefreshScheduler({
      refresh,
      intervalMs: 1_000
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    resolveRefresh();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    scheduler.stop();
    resolveRefresh();
    vi.useRealTimers();
  });

  it("uses the reference 60 to 120 second randomized delay after completion", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => undefined);
    const scheduler = createWorkspaceRefreshScheduler({
      refresh,
      randomFn: () => 0.5
    });

    scheduler.start();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(89_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);

    scheduler.stop();
    vi.useRealTimers();
  });
});
