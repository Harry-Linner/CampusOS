import { describe, expect, it, vi } from "vitest";
import { createDesktopPetService } from "./desktopPetService";

const settings = { configured: true, provider: "openai" as const, protocol: "openai-responses" as const, baseUrl: "https://api.openai.com/v1", model: "test", savedAt: null, encrypted: true };
const result = { intent: "general" as const, sourceText: "明天交报告", source: { app: "manual" as const }, schemaVersion: 3 as const, promptVersion: "test", intents: [], unresolvedQuestions: [] };
const tick = async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); };

describe("desktop pet session jobs", () => {
  it("parses once, retains completed results for late navigation, and releases them explicitly", async () => {
    const parse = vi.fn(async () => ({ result, settings }));
    const service = createDesktopPetService({ parse });
    const id = service.submit({ kind: "text", text: "明天交报告" });
    await tick();
    expect(parse).toHaveBeenCalledTimes(1);
    expect(service.list()[0]).toMatchObject({ id, status: "ready" });
    expect(service.get(id)?.result).toEqual(result);
    expect(service.get(id)?.settings?.model).toBe("test");
    expect(JSON.stringify(service.list())).not.toContain("sourceText");
    service.dismiss(id);
    expect(service.get(id)).toBeNull();
  });

  it("cancels the real request and ignores a provider that completes after cancellation", async () => {
    let finish!: (value: { result: typeof result; settings: typeof settings }) => void;
    let signal!: AbortSignal;
    const service = createDesktopPetService({ parse: (_input, inputSignal) => {
      signal = inputSignal;
      return new Promise((resolve) => { finish = resolve; });
    }});
    const id = service.submit({ kind: "text", text: "取消这次解析" });
    await tick();
    service.cancel(id);
    expect(signal.aborted).toBe(true);
    finish({ result, settings });
    await tick();
    expect(service.list()[0].status).toBe("cancelled");
    expect(service.get(id)?.result).toBeUndefined();
  });

  it("bounds the queue, validates input, and continues after a failed item", async () => {
    const parse = vi.fn().mockRejectedValueOnce(new Error("provider failed")).mockResolvedValue({ result, settings });
    const service = createDesktopPetService({ parse });
    expect(() => service.submit({ kind: "text", text: " " })).toThrow();
    expect(() => service.submit({ kind: "text", text: "x".repeat(51_201) })).toThrow();
    const first = service.submit({ kind: "text", text: "first" });
    service.submit({ kind: "text", text: "second" });
    await tick(); await tick();
    expect(service.list().find((job) => job.id === first)?.status).toBe("error");
    expect(service.get(first)?.message).toBe("解析失败，请检查 AI 连接后重试。");
    expect(service.get(first)?.message).not.toContain("provider failed");
    expect(service.list().some((job) => job.status === "ready")).toBe(true);
    service.retry(first);
    await tick();
    expect(service.get(first)?.result).toEqual(result);
  });

  it("does not persist raw input and clears all jobs on dispose", async () => {
    const service = createDesktopPetService({ parse: vi.fn(async () => ({ result, settings })) });
    service.submit({ kind: "text", text: "私人消息" });
    service.dispose();
    await tick();
    expect(service.list()).toEqual([]);
  });

  it("guides failed image jobs to a vision model or text input", async () => {
    const service = createDesktopPetService({ parse: vi.fn(async () => { throw new Error("unsupported image"); }) });
    const id = service.submit({ kind: "image", mime: "image/png", base64: Buffer.alloc(12).toString("base64") });
    await tick();
    expect(service.get(id)).toMatchObject({
      status: "error",
      message: "图片解析失败，请换用支持图片的视觉模型，或改用文字后重试。"
    });
    expect(service.get(id)?.message).not.toContain("unsupported image");
  });
});
