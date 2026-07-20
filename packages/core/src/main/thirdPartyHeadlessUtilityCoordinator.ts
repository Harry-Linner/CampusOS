import { randomUUID } from "node:crypto";
import type { ThirdPartyHeadlessSandboxRequest } from "./thirdPartyHeadlessSandbox";
import {
  HEADLESS_UTILITY_PROTOCOL_VERSION,
  isHeadlessUtilityReadyMessage,
  parseHeadlessUtilityResultMessage,
  type HeadlessUtilityRunMessage
} from "./thirdPartyHeadlessUtilityProtocol";

export interface SpawnedHeadlessUtility {
  readonly pid: number | undefined;
  postMessage: (message: HeadlessUtilityRunMessage) => void;
  kill: () => boolean;
  onMessage: (listener: (message: unknown) => void) => void;
  onExit: (listener: (code: number) => void) => void;
  onError: (listener: (message: string) => void) => void;
}

export interface ThirdPartyHeadlessUtilityRunner {
  run: (request: ThirdPartyHeadlessSandboxRequest) => Promise<unknown>;
}

export interface HeadlessUtilityCoordinatorOptions {
  spawn: () => SpawnedHeadlessUtility;
  getResidentSetBytes?: (pid: number) => number | undefined;
  maxResidentSetBytes?: number;
  memoryPollIntervalMs?: number;
  requestTimeoutOverheadMs?: number;
  startupTimeoutMs?: number;
}

const defaultExecutionTimeMs = 100;

const executionTimeFor = (
  request: ThirdPartyHeadlessSandboxRequest
): number => {
  const value = request.limits?.executionTimeMs;
  return Number.isInteger(value) && (value as number) >= 10 && (value as number) <= 1_000
    ? value as number
    : defaultExecutionTimeMs;
};

export const createThirdPartyHeadlessUtilityCoordinator = ({
  spawn,
  getResidentSetBytes,
  maxResidentSetBytes = 256 * 1024 * 1024,
  memoryPollIntervalMs = 25,
  requestTimeoutOverheadMs = 2_000,
  startupTimeoutMs = 5_000
}: HeadlessUtilityCoordinatorOptions): ThirdPartyHeadlessUtilityRunner => ({
  run: (request) => new Promise<unknown>((resolve, reject) => {
    const requestId = randomUUID();
    const child = spawn();
    let settled = false;
    let requestSent = false;
    let requestTimer: ReturnType<typeof setTimeout> | undefined;

    const startupTimer = setTimeout(() => {
      finish(new Error("第三方 headless utility 启动超时。"));
    }, startupTimeoutMs);
    const memoryTimer = getResidentSetBytes
      ? setInterval(() => {
          const pid = child.pid;
          if (pid === undefined) return;
          const residentSetBytes = getResidentSetBytes(pid);
          if (
            residentSetBytes !== undefined &&
            residentSetBytes > maxResidentSetBytes
          ) {
            finish(new Error("第三方 headless utility 超过进程内存限制。"));
          }
        }, memoryPollIntervalMs)
      : undefined;

    function finish(error: Error, output?: never): void;
    function finish(error: null, output: unknown): void;
    function finish(error: Error | null, output?: unknown): void {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      if (requestTimer) clearTimeout(requestTimer);
      if (memoryTimer) clearInterval(memoryTimer);
      child.kill();
      if (error) reject(error);
      else resolve(output);
    }

    child.onMessage((message) => {
      if (isHeadlessUtilityReadyMessage(message)) {
        if (requestSent) {
          finish(new Error("第三方 headless utility 返回了重复 ready。"));
          return;
        }
        requestSent = true;
        clearTimeout(startupTimer);
        requestTimer = setTimeout(() => {
          finish(new Error("第三方 headless utility 请求超时。"));
        }, executionTimeFor(request) + requestTimeoutOverheadMs);
        try {
          child.postMessage({
            kind: "run",
            protocolVersion: HEADLESS_UTILITY_PROTOCOL_VERSION,
            requestId,
            request
          });
        } catch (error) {
          finish(new Error(
            error instanceof Error
              ? `第三方 headless utility 发送失败：${error.message}`
              : "第三方 headless utility 发送失败。"
          ));
        }
        return;
      }

      const result = parseHeadlessUtilityResultMessage(message);
      if (!requestSent || !result || result.requestId !== requestId) {
        finish(new Error("第三方 headless utility 返回了无效消息。"));
        return;
      }
      if (result.ok) finish(null, result.output);
      else finish(new Error(result.error));
    });
    child.onExit((code) => {
      finish(new Error(`第三方 headless utility 异常退出：${code}`));
    });
    child.onError((message) => {
      finish(new Error(`第三方 headless utility 进程错误：${message.slice(0, 300)}`));
    });
  })
});
