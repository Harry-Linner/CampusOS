import { describe, expect, it, vi } from "vitest";
import {
  createAiAssistantService,
  type AiAssistantVault,
  type StoredAiAssistantSettings
} from "./aiAssistantService";

const createVault = (initial: StoredAiAssistantSettings | null = null): AiAssistantVault & {
  payload: StoredAiAssistantSettings | null;
} => {
  const vault = {
    payload: initial,
    encrypted: true,
    isEncryptionAvailable: () => true,
    encrypt: vi.fn((value: string) => `encrypted:${value}`),
    decrypt: vi.fn((value: string) => value.replace("encrypted:", "")),
    read: vi.fn(async () => vault.payload),
    write: vi.fn(async (payload: StoredAiAssistantSettings) => {
      vault.payload = payload;
    }),
    clear: vi.fn(async () => {
      vault.payload = null;
    })
  };
  return vault;
};

const storedSettings: StoredAiAssistantSettings = {
  dataVersion: 1,
  encryptedApiKey: "encrypted:mock-key",
  model: "gpt-4o-mini",
  savedAt: "2026-08-05T00:00:00.000Z"
};

const modelDraft = {
  title: "提交读书报告",
  description: "完成并提交读书报告",
  type: "deadline",
  startAt: "2026-08-06T11:00:00.000Z",
  endAt: "2026-08-06T12:00:00.000Z",
  timeNeededMinutes: 60,
  location: "",
  courseName: "Sample Course",
  confidence: "high",
  missingFields: [],
  warnings: [],
  evidence: ["明天晚上八点", "Sample Course"]
};

describe("AiAssistantService", () => {
  it("encrypts the API key and never returns it to the renderer", async () => {
    const vault = createVault();
    const service = createAiAssistantService({
      vault,
      now: () => new Date("2026-08-05T00:00:00.000Z")
    });

    const record = await service.saveSettings({ apiKey: " mock-key ", model: "gpt-4o-mini" });

    expect(vault.encrypt).toHaveBeenCalledWith("mock-key");
    expect(vault.payload).toEqual(storedSettings);
    expect(record).toEqual({
      configured: true,
      model: "gpt-4o-mini",
      savedAt: "2026-08-05T00:00:00.000Z",
      encrypted: true
    });
    expect(JSON.stringify(record)).not.toContain("mock-key");
  });

  it("keeps the encrypted key when only the model changes", async () => {
    const vault = createVault(storedSettings);
    const service = createAiAssistantService({ vault });

    await service.saveSettings({ apiKey: "", model: "gpt-4.1" });

    expect(vault.encrypt).not.toHaveBeenCalled();
    expect(vault.payload?.encryptedApiKey).toBe("encrypted:mock-key");
    expect(vault.payload?.model).toBe("gpt-4.1");
  });

  it("calls the Responses API with strict structured output and validates the draft", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer mock-key" }));
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ model: "gpt-4o-mini", store: false });
      expect(body.instructions).toContain("不得补造日期");
      expect(body.text).toEqual(expect.objectContaining({
        format: expect.objectContaining({ type: "json_schema", strict: true })
      }));
      return new Response(JSON.stringify({
        output: [{ content: [{ type: "output_text", text: JSON.stringify(modelDraft) }] }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const service = createAiAssistantService({ vault: createVault(storedSettings), fetchFn });

    const result = await service.parseMessage({
      text: "Sample Course reading report due tomorrow at 8 PM",
      courseNames: ["Sample Course"],
      now: "2026-08-05T02:00:00.000Z"
    });

    expect(fetchFn).toHaveBeenCalledWith("https://api.openai.com/v1/responses", expect.objectContaining({ method: "POST" }));
    expect(result).toEqual({
      sourceText: "Sample Course reading report due tomorrow at 8 PM",
      ...modelDraft
    });
  });

  it("rejects unconfigured requests and model output that invents a course", async () => {
    const emptyService = createAiAssistantService({ vault: createVault() });
    await expect(emptyService.parseMessage({ text: "消息", courseNames: [], now: "2026-08-05T00:00:00.000Z" }))
      .rejects.toMatchObject({ code: "not-configured" });

    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      output: [{ content: [{ type: "output_text", text: JSON.stringify({ ...modelDraft, courseName: "不存在的课程" }) }] }]
    }), { status: 200 }));
    const service = createAiAssistantService({ vault: createVault(storedSettings), fetchFn });
    await expect(service.parseMessage({ text: "message", courseNames: ["Sample Course"], now: "2026-08-05T00:00:00.000Z" }))
      .rejects.toMatchObject({ code: "invalid-response" });
  });

  it("tests the selected key and model without persisting or returning model output", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ model: "gpt-4o-mini", store: false, max_output_tokens: 4 });
      return new Response(JSON.stringify({ output: [] }), { status: 200 });
    });
    const vault = createVault();
    const service = createAiAssistantService({
      vault,
      fetchFn,
      now: () => new Date("2026-08-05T00:00:00.000Z")
    });

    const result = await service.testConnection({ apiKey: "mock-key", model: "gpt-4o-mini" });

    expect(result).toEqual({
      ok: true,
      model: "gpt-4o-mini",
      checkedAt: "2026-08-05T00:00:00.000Z",
      latencyMs: expect.any(Number)
    });
    expect(vault.write).not.toHaveBeenCalled();
  });
});
