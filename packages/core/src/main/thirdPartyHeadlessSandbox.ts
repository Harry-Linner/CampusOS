import releaseVariant from "@jitl/quickjs-wasmfile-release-sync";
import {
  isFail,
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule
} from "quickjs-emscripten-core";

export interface ThirdPartyHeadlessSandboxLimits {
  executionTimeMs: number;
  memoryLimitBytes: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  maxSourceBytes: number;
  stackLimitBytes: number;
}

export interface ThirdPartyHeadlessSandboxRequest {
  pluginId: string;
  source: string;
  input: unknown;
  limits?: Partial<ThirdPartyHeadlessSandboxLimits>;
  capabilities?: Record<string, unknown>;
}

const defaultLimits: ThirdPartyHeadlessSandboxLimits = Object.freeze({
  executionTimeMs: 100,
  memoryLimitBytes: 16 * 1024 * 1024,
  maxInputBytes: 256 * 1024,
  maxOutputBytes: 256 * 1024,
  maxSourceBytes: 1024 * 1024,
  stackLimitBytes: 512 * 1024
});

const pluginIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const encoder = new TextEncoder();
let quickJsModulePromise: Promise<QuickJSWASMModule> | undefined;

const loadQuickJs = (): Promise<QuickJSWASMModule> => {
  quickJsModulePromise ??= newQuickJSWASMModuleFromVariant(releaseVariant);
  return quickJsModulePromise;
};

const resolveLimits = (
  overrides: Partial<ThirdPartyHeadlessSandboxLimits> = {}
): ThirdPartyHeadlessSandboxLimits => {
  const limits = { ...defaultLimits, ...overrides };
  const valid =
    Number.isInteger(limits.executionTimeMs) &&
    limits.executionTimeMs >= 10 &&
    limits.executionTimeMs <= 1_000 &&
    Number.isInteger(limits.memoryLimitBytes) &&
    limits.memoryLimitBytes >= 4 * 1024 * 1024 &&
    limits.memoryLimitBytes <= 64 * 1024 * 1024 &&
    Number.isInteger(limits.maxInputBytes) &&
    limits.maxInputBytes >= 1 &&
    limits.maxInputBytes <= 1024 * 1024 &&
    Number.isInteger(limits.maxOutputBytes) &&
    limits.maxOutputBytes >= 1 &&
    limits.maxOutputBytes <= 1024 * 1024 &&
    Number.isInteger(limits.maxSourceBytes) &&
    limits.maxSourceBytes >= 1 &&
    limits.maxSourceBytes <= 2 * 1024 * 1024 &&
    Number.isInteger(limits.stackLimitBytes) &&
    limits.stackLimitBytes >= 128 * 1024 &&
    limits.stackLimitBytes <= 2 * 1024 * 1024;
  if (!valid) throw new Error("第三方 headless 沙箱资源限制无效。");
  return limits;
};

const serializeJson = (
  value: unknown,
  label: string,
  maxBytes: number
): string => {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label}必须是可序列化 JSON。`);
  }
  if (serialized === undefined) {
    throw new Error(`${label}必须是可序列化 JSON。`);
  }
  if (encoder.encode(serialized).byteLength > maxBytes) {
    throw new Error(`${label}超过大小限制。`);
  }
  return serialized;
};

const sandboxError = (
  context: QuickJSContext,
  errorHandle: QuickJSHandle,
  executionTimeMs: number
): Error => {
  const dumped = context.dump(errorHandle) as {
    name?: unknown;
    message?: unknown;
  } | string;
  const message = typeof dumped === "string"
    ? dumped
    : typeof dumped?.message === "string"
      ? dumped.message
      : "未知执行错误";
  if (/interrupted/i.test(message)) {
    return new Error(`第三方插件执行超过 ${executionTimeMs}ms，已中断。`);
  }
  if (/out of memory|memory limit/i.test(message)) {
    return new Error("第三方插件超过内存限制，已中断。");
  }
  return new Error(`第三方插件执行失败：${message.slice(0, 300)}`);
};

export const runThirdPartyHeadlessSandbox = async ({
  pluginId,
  source,
  input,
  limits: limitOverrides,
  capabilities
}: ThirdPartyHeadlessSandboxRequest): Promise<unknown> => {
  if (!pluginIdPattern.test(pluginId) || pluginId.startsWith("org.campusos.")) {
    throw new Error("第三方插件 ID 无效。");
  }
  const limits = resolveLimits(limitOverrides);
  if (encoder.encode(source).byteLength > limits.maxSourceBytes) {
    throw new Error("第三方插件源码超过大小限制。");
  }
  const serializedInput = serializeJson(
    input,
    "第三方插件输入",
    limits.maxInputBytes
  );
  const quickJs = await loadQuickJs();
  const runtime = quickJs.newRuntime();
  runtime.setMemoryLimit(limits.memoryLimitBytes);
  runtime.setMaxStackSize(limits.stackLimitBytes);
  runtime.setInterruptHandler(
    shouldInterruptAfterDeadline(Date.now() + limits.executionTimeMs)
  );
  const context = runtime.newContext();

  try {
    const inputJsonHandle = context.newString(serializedInput);
    context.setProp(context.global, "__CAMPUSOS_INPUT_JSON__", inputJsonHandle);
    inputJsonHandle.dispose();

    if (capabilities) {
      const capsJson = JSON.stringify(capabilities);
      if (encoder.encode(capsJson).byteLength <= limits.maxInputBytes) {
        const capsHandle = context.newString(capsJson);
        context.setProp(context.global, "__CAMPUSOS_CAPABILITIES_JSON__", capsHandle);
        capsHandle.dispose();
      }
    }

    const moduleResult = context.evalCode(
      source,
      `${pluginId}/main.mjs`,
      { type: "module" }
    );
    if (isFail(moduleResult)) {
      const error = sandboxError(
        context,
        moduleResult.error,
        limits.executionTimeMs
      );
      moduleResult.error.dispose();
      throw error;
    }

    const moduleNamespace = moduleResult.value;
    try {
      const runHandle = context.getProp(moduleNamespace, "run");
      try {
        if (context.typeof(runHandle) !== "function") {
          throw new Error("第三方 headless 入口必须导出同步 run(input) 函数。");
        }
        const inputResult = context.evalCode(
          "JSON.parse(globalThis.__CAMPUSOS_INPUT_JSON__)",
          `${pluginId}/input.js`,
          { type: "global" }
        );
        if (isFail(inputResult)) {
          const error = sandboxError(
            context,
            inputResult.error,
            limits.executionTimeMs
          );
          inputResult.error.dispose();
          throw error;
        }

        const inputHandle = inputResult.value;
        try {
          const outputResult = context.callFunction(
            runHandle,
            context.undefined,
            inputHandle
          );
          if (isFail(outputResult)) {
            const error = sandboxError(
              context,
              outputResult.error,
              limits.executionTimeMs
            );
            outputResult.error.dispose();
            throw error;
          }

          const outputHandle = outputResult.value;
          try {
            const thenHandle = context.getProp(outputHandle, "then");
            try {
              if (context.typeof(thenHandle) === "function") {
                throw new Error("第三方 headless v1 不接受异步 run() 返回值。");
              }
            } finally {
              thenHandle.dispose();
            }
            context.setProp(context.global, "__CAMPUSOS_OUTPUT__", outputHandle);
            const outputJsonResult = context.evalCode(
              "JSON.stringify(globalThis.__CAMPUSOS_OUTPUT__)",
              `${pluginId}/output.js`,
              { type: "global" }
            );
            if (isFail(outputJsonResult)) {
              const error = sandboxError(
                context,
                outputJsonResult.error,
                limits.executionTimeMs
              );
              outputJsonResult.error.dispose();
              throw error;
            }
            const outputJsonHandle = outputJsonResult.value;
            try {
              if (context.typeof(outputJsonHandle) !== "string") {
                throw new Error("第三方插件输出必须是可序列化 JSON。");
              }
              const outputJson = context.getString(outputJsonHandle);
              if (encoder.encode(outputJson).byteLength > limits.maxOutputBytes) {
                throw new Error("第三方插件输出超过大小限制。");
              }
              return JSON.parse(outputJson) as unknown;
            } finally {
              outputJsonHandle.dispose();
            }
          } finally {
            outputHandle.dispose();
          }
        } finally {
          inputHandle.dispose();
        }
      } finally {
        runHandle.dispose();
      }
    } finally {
      moduleNamespace.dispose();
    }
  } finally {
    context.dispose();
    runtime.dispose();
  }
};
