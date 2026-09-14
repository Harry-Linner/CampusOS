import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThirdPartyHeadlessSandboxRequest } from "./thirdPartyHeadlessSandbox";
import {
  createThirdPartyHeadlessUtilityCoordinator,
  type SpawnedHeadlessUtility
} from "./thirdPartyHeadlessUtilityCoordinator";
import {
  HEADLESS_UTILITY_PROTOCOL_VERSION,
  parseHeadlessUtilityRunMessage,
  parseHeadlessUtilityResultMessage,
  type HeadlessUtilityRunMessage
} from "./thirdPartyHeadlessUtilityProtocol";

class FakeUtility implements SpawnedHeadlessUtility {
  pid: number | undefined = 42;
  killed = false;
  sent: HeadlessUtilityRunMessage[] = [];
  private messageListeners: Array<(message: unknown) => void> = [];
  private exitListeners: Array<(code: number) => void> = [];
  private errorListeners: Array<(message: string) => void> = [];

  postMessage = (message: HeadlessUtilityRunMessage): void => {
    this.sent.push(message);
  };

  kill = (): boolean => {
    this.killed = true;
    this.pid = undefined;
    return true;
  };

  onMessage = (listener: (message: unknown) => void): void => {
    this.messageListeners.push(listener);
  };

  onExit = (listener: (code: number) => void): void => {
    this.exitListeners.push(listener);
  };

  onError = (listener: (message: string) => void): void => {
    this.errorListeners.push(listener);
  };

  emitMessage(message: unknown): void {
    for (const listener of this.messageListeners) listener(message);
  }

  emitExit(code: number): void {
    for (const listener of this.exitListeners) listener(code);
  }

  emitError(message: string): void {
    for (const listener of this.errorListeners) listener(message);
  }
}

const request: ThirdPartyHeadlessSandboxRequest = {
  pluginId: "dev.example.local-task",
  source: "export function run(input) { return input; }",
  input: { value: 7 },
  limits: { executionTimeMs: 25 }
};

afterEach(() => {
  vi.useRealTimers();
});

describe("third-party headless utility coordinator", () => {
  it("correlates a successful one-shot request and always kills the child", async () => {
    const child = new FakeUtility();
    const runner = createThirdPartyHeadlessUtilityCoordinator({
      spawn: () => child
    });
    const result = runner.run(request);

    child.emitMessage({
      kind: "ready",
      protocolVersion: HEADLESS_UTILITY_PROTOCOL_VERSION
    });
    expect(child.sent).toHaveLength(1);
    child.emitMessage({
      kind: "result",
      protocolVersion: HEADLESS_UTILITY_PROTOCOL_VERSION,
      requestId: child.sent[0].requestId,
      ok: true,
      output: { value: 7 }
    });

    await expect(result).resolves.toEqual({ value: 7 });
    expect(child.killed).toBe(true);
  });

  it("rejects a mismatched response and an abnormal process exit", async () => {
    const mismatchedChild = new FakeUtility();
    const mismatchedRunner = createThirdPartyHeadlessUtilityCoordinator({
      spawn: () => mismatchedChild
    });
    const mismatchedResult = mismatchedRunner.run(request);
    mismatchedChild.emitMessage({
      kind: "ready",
      protocolVersion: HEADLESS_UTILITY_PROTOCOL_VERSION
    });
    mismatchedChild.emitMessage({
      kind: "result",
      protocolVersion: HEADLESS_UTILITY_PROTOCOL_VERSION,
      requestId: "00000000-0000-4000-8000-000000000000",
      ok: true,
      output: null
    });
    await expect(mismatchedResult).rejects.toThrow("无效消息");
    expect(mismatchedChild.killed).toBe(true);

    const exitedChild = new FakeUtility();
    const exitedRunner = createThirdPartyHeadlessUtilityCoordinator({
      spawn: () => exitedChild
    });
    const exitedResult = exitedRunner.run(request);
    exitedChild.emitExit(9);
    await expect(exitedResult).rejects.toThrow("异常退出：9");
    expect(exitedChild.killed).toBe(true);
  });

  it("kills a child on startup and execution timeout", async () => {
    vi.useFakeTimers();
    const startupChild = new FakeUtility();
    const startupRunner = createThirdPartyHeadlessUtilityCoordinator({
      spawn: () => startupChild,
      startupTimeoutMs: 20
    });
    const startupResult = startupRunner.run(request);
    const startupAssertion = expect(startupResult).rejects.toThrow("启动超时");
    await vi.advanceTimersByTimeAsync(21);
    await startupAssertion;
    expect(startupChild.killed).toBe(true);

    const executionChild = new FakeUtility();
    const executionRunner = createThirdPartyHeadlessUtilityCoordinator({
      spawn: () => executionChild,
      requestTimeoutOverheadMs: 5
    });
    const executionResult = executionRunner.run(request);
    executionChild.emitMessage({
      kind: "ready",
      protocolVersion: HEADLESS_UTILITY_PROTOCOL_VERSION
    });
    const executionAssertion = expect(executionResult).rejects.toThrow("请求超时");
    await vi.advanceTimersByTimeAsync(31);
    await executionAssertion;
    expect(executionChild.killed).toBe(true);
  });

  it("kills a child whose resident set exceeds the outer limit", async () => {
    vi.useFakeTimers();
    const child = new FakeUtility();
    const runner = createThirdPartyHeadlessUtilityCoordinator({
      spawn: () => child,
      getResidentSetBytes: () => 20 * 1024 * 1024,
      maxResidentSetBytes: 10 * 1024 * 1024,
      memoryPollIntervalMs: 5
    });
    const result = runner.run(request);
    const assertion = expect(result).rejects.toThrow("进程内存限制");

    await vi.advanceTimersByTimeAsync(6);
    await assertion;
    expect(child.killed).toBe(true);
  });

  it("strictly validates messages at both sides of the boundary", () => {
    expect(parseHeadlessUtilityRunMessage({
      kind: "run",
      protocolVersion: HEADLESS_UTILITY_PROTOCOL_VERSION,
      requestId: "00000000-0000-4000-8000-000000000000",
      request,
      injected: true
    })).toBeNull();
    expect(parseHeadlessUtilityResultMessage({
      kind: "result",
      protocolVersion: HEADLESS_UTILITY_PROTOCOL_VERSION,
      requestId: "00000000-0000-4000-8000-000000000000",
      ok: false,
      error: "x".repeat(501)
    })).toBeNull();
  });
});
