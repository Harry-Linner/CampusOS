import { describe, expect, it } from "vitest";
import { runThirdPartyHeadlessSandbox } from "./thirdPartyHeadlessSandbox";

describe("third-party headless QuickJS sandbox", () => {
  it("runs an ESM entrypoint without Node or network globals", async () => {
    await expect(runThirdPartyHeadlessSandbox({
      pluginId: "dev.example.local-task",
      source: `export function run(input) {
        return {
          input,
          globals: {
            Buffer: typeof Buffer,
            WebSocket: typeof WebSocket,
            fetch: typeof fetch,
            process: typeof process,
            require: typeof require
          }
        };
      }`,
      input: { task: "count" }
    })).resolves.toEqual({
      input: { task: "count" },
      globals: {
        Buffer: "undefined",
        WebSocket: "undefined",
        fetch: "undefined",
        process: "undefined",
        require: "undefined"
      }
    });
  });

  it("interrupts a CPU-bound plugin after its deadline", async () => {
    await expect(runThirdPartyHeadlessSandbox({
      pluginId: "dev.example.infinite-loop",
      source: "export function run() { while (true) {} }",
      input: null,
      limits: { executionTimeMs: 25 }
    })).rejects.toThrow("超过 25ms");
  });

  it("interrupts a plugin that exceeds its memory budget", async () => {
    await expect(runThirdPartyHeadlessSandbox({
      pluginId: "dev.example.memory-pressure",
      source: `export function run() {
        const chunks = [];
        while (true) {
          const chunkId = chunks.length;
          chunks.push(Array.from({ length: 4096 }, (_, index) => ({
            id: chunkId + ":" + index,
            value: "campusos-headless-memory-pressure-" + index
          })));
        }
      }`,
      input: null,
      limits: {
        executionTimeMs: 1_000,
        memoryLimitBytes: 4 * 1024 * 1024
      }
    })).rejects.toThrow("内存限制");
  });

  it("rejects imports, async results and non-JSON output", async () => {
    await expect(runThirdPartyHeadlessSandbox({
      pluginId: "dev.example.importer",
      source: 'import "node:fs"; export function run() { return null; }',
      input: null
    })).rejects.toThrow("执行失败");
    await expect(runThirdPartyHeadlessSandbox({
      pluginId: "dev.example.async-task",
      source: "export async function run() { return 1; }",
      input: null
    })).rejects.toThrow("不接受异步");
    await expect(runThirdPartyHeadlessSandbox({
      pluginId: "dev.example.invalid-output",
      source: "export function run() { return undefined; }",
      input: null
    })).rejects.toThrow("可序列化 JSON");
  });
});
