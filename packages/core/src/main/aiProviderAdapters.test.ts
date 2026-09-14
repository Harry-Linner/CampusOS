import { describe, expect, it, vi } from "vitest";
import { AiProviderAdapterError, createAiProviderAdapter, type AiProviderProfile } from "./aiProviderAdapters";

const generationInput = {
  systemPrompt: "Extract structured tasks.",
  input: { message: "sample" },
  schemaName: "campus_extraction_v2",
  schema: { type: "object", properties: {} }
};

const profile = (overrides: Partial<AiProviderProfile> = {}): AiProviderProfile => ({
  provider: "openai",
  protocol: "openai-responses",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  ...overrides
});

describe("AI provider adapters", () => {
  it("sends actual image content rather than a base64 string inside the extraction text", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ output_text: "{}" })));
    const adapter = createAiProviderAdapter({ profile: profile(), apiKey: "key", fetchFn });
    await adapter.generateStructured({ ...generationInput, images: [{ mime: "image/png", base64: "YWJj" }] });
    const body = JSON.parse(String(fetchFn.mock.calls[0][1]?.body));
    expect(body.input[0].content).toContainEqual({ type: "input_image", image_url: "data:image/png;base64,YWJj", detail: "auto" });
  });

  it("keeps caller cancellation active while reading a response body", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))
    } as Response));
    const adapter = createAiProviderAdapter({ profile: profile(), apiKey: "key", fetchFn });
    const pending = adapter.generateStructured({ ...generationInput, signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "network-error" });
    expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("times out when headers arrive but the response body stalls", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true }))
    } as Response));
    const adapter = createAiProviderAdapter({ profile: profile(), apiKey: "key", fetchFn, timeoutMs: 15 });
    await expect(adapter.generateStructured(generationInput)).rejects.toMatchObject({ code: "network-error" });
  });

  it("reports cancellation when the caller aborts before response headers arrive", async () => {
    const caller = new AbortController();
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted before headers")), { once: true });
    }));
    const adapter = createAiProviderAdapter({ profile: profile(), apiKey: "key", fetchFn });
    const pending = adapter.generateStructured({ ...generationInput, signal: caller.signal });
    await Promise.resolve();
    caller.abort();
    await expect(pending).rejects.toMatchObject({ code: "network-error", message: "AI 请求已取消。" });
  });

  it("reports a timeout when the response headers never arrive", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("timed out before headers")), { once: true });
    }));
    const adapter = createAiProviderAdapter({ profile: profile(), apiKey: "key", fetchFn, timeoutMs: 15 });
    await expect(adapter.generateStructured(generationInput)).rejects.toMatchObject({
      code: "network-error",
      message: "AI 服务响应超时，请稍后重试。"
    });
  });

  it("uses the Responses endpoint and parses its structured text envelope", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: "{\"intents\":[]}" }] }] }), { status: 200 }));
    const adapter = createAiProviderAdapter({ profile: profile(), apiKey: "openai-key", fetchFn });

    await expect(adapter.generateStructured(generationInput)).resolves.toEqual({ intents: [] });
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer openai-key" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "gpt-4o-mini", store: false });
  });

  it("routes DeepSeek through Chat Completions and parses the assistant content", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"intents\":[]}" } }] }), { status: 200 }));
    const adapter = createAiProviderAdapter({
      profile: profile({ provider: "deepseek", protocol: "openai-chat-completions", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" }),
      apiKey: "deepseek-key",
      fetchFn
    });

    await expect(adapter.generateStructured(generationInput)).resolves.toEqual({ intents: [] });
    expect(String(fetchFn.mock.calls[0][0])).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("uses Anthropic tool output with Anthropic authentication headers", async () => {
    const toolInput = { intents: [], unresolvedQuestions: [] };
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ content: [{ type: "tool_use", input: toolInput }] }), { status: 200 }));
    const adapter = createAiProviderAdapter({
      profile: profile({ provider: "anthropic", protocol: "anthropic-messages", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5" }),
      apiKey: "anthropic-key",
      fetchFn
    });

    await expect(adapter.generateStructured(generationInput)).resolves.toEqual(toolInput);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    expect(init?.headers).toMatchObject({ "x-api-key": "anthropic-key", "anthropic-version": "2023-06-01" });
  });

  it("keeps the Gemini key out of URLs and parses JSON content", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{\"intents\":[]}" }] } }] }), { status: 200 }));
    const adapter = createAiProviderAdapter({
      profile: profile({ provider: "gemini", protocol: "gemini-generate-content", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash" }),
      apiKey: "gemini-key",
      fetchFn
    });

    await expect(adapter.generateStructured(generationInput)).resolves.toEqual({ intents: [] });
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect(String(url)).not.toContain("gemini-key");
    expect(init?.headers).toMatchObject({ "x-goog-api-key": "gemini-key" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ generationConfig: { responseMimeType: "application/json", responseJsonSchema: generationInput.schema } });
  });

  it("maps malformed structured content and authentication failures to stable errors", async () => {
    const malformed = createAiProviderAdapter({
      profile: profile(),
      apiKey: "key",
      fetchFn: vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ output_text: "not-json" }), { status: 200 }))
    });
    await expect(malformed.generateStructured(generationInput)).rejects.toMatchObject({ code: "invalid-response" });

    const unauthorized = createAiProviderAdapter({
      profile: profile(),
      apiKey: "key",
      fetchFn: vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: { message: "invalid key" } }), { status: 401 }))
    });
    await expect(unauthorized.listModels()).rejects.toEqual(expect.objectContaining<Partial<AiProviderAdapterError>>({ code: "auth-error", message: expect.stringContaining("invalid key") }));
  });
});
