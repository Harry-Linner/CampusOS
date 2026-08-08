/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AiAssistantDraft,
  PluginCapabilityClient,
  PluginComponentProps
} from "@campusos/shared";
import { AssistantView } from "../../../../../plugins/official/ai-assistant/src/AssistantView";
import { AssistantSetupDialog } from "../../../../../plugins/official/ai-assistant/src/AssistantSetupDialog";

afterEach(cleanup);

const baseProps: PluginComponentProps = {
  capabilities: { read: vi.fn(async () => []) } as PluginCapabilityClient,
  loading: false,
  onRefresh: vi.fn(async () => undefined),
  snapshot: null
};

const draft: AiAssistantDraft = {
  sourceText: "明天晚上八点提交读书报告",
  title: "提交读书报告",
  description: "完成并提交读书报告",
  type: "deadline",
  startAt: "2026-08-06T11:00:00.000Z",
  endAt: "2026-08-06T12:00:00.000Z",
  timeNeededMinutes: 60,
  location: "",
  courseName: "",
  confidence: "high",
  missingFields: [],
  warnings: [],
  evidence: ["明天晚上八点"]
};

const createAssistantBridge = (
  overrides: Partial<NonNullable<PluginComponentProps["assistant"]>> = {}
): NonNullable<PluginComponentProps["assistant"]> => ({
  loadSettings: vi.fn(async () => ({
    configured: true,
    model: "gpt-4o-mini",
    savedAt: "2026-08-05T00:00:00.000Z",
    encrypted: true
  })),
  saveSettings: vi.fn(async (input) => ({
    configured: true,
    model: input.model,
    savedAt: "2026-08-05T00:00:00.000Z",
    encrypted: true
  })),
  clearSettings: vi.fn(async () => ({
    configured: false,
    model: "gpt-4o-mini",
    savedAt: null,
    encrypted: true
  })),
  testConnection: vi.fn(async () => ({
    ok: true as const,
    model: "gpt-4o-mini",
    checkedAt: "2026-08-05T00:00:00.000Z",
    latencyMs: 120
  })),
  parseMessage: vi.fn(async () => draft),
  ...overrides
});

describe("AssistantView", () => {
  it("sends an explicit message to the AI bridge, allows edits, and saves through Schedule", async () => {
    const assistant = createAssistantBridge();
    const saveTask = vi.fn(async () => ({ tasks: [], updatedAt: "2026-08-05T00:00:00.000Z" }));
    render(createElement(AssistantView, {
      ...baseProps,
      assistant,
      schedule: {
        saveTask,
        loadTasks: vi.fn(async () => ({ tasks: [], updatedAt: "" })),
        loadPeriods: vi.fn(async () => []),
        mutateTask: vi.fn(async () => ({ tasks: [], updatedAt: "" })),
        generatePlan: vi.fn(async () => { throw new Error("unused"); }),
        loadPlan: vi.fn(async () => null),
        exportIcal: vi.fn(async () => ({ filePath: "", eventCount: 0, generatedAt: "" })),
        subscribe: vi.fn(() => () => undefined)
      }
    }));

    await waitFor(() => expect(assistant.loadSettings).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("粘贴消息"), {
      target: { value: "明天晚上八点提交读书报告" }
    });
    fireEvent.click(screen.getByRole("button", { name: "交给 AI 解析" }));
    await waitFor(() => expect(assistant.parseMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: "明天晚上八点提交读书报告",
      courseNames: []
    })));
    const title = await screen.findByLabelText("标题");
    fireEvent.change(title, { target: { value: "已编辑读书报告" } });
    fireEvent.click(screen.getByRole("button", { name: "确认并写入日程" }));

    await waitFor(() => expect(saveTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "已编辑读书报告",
      type: "deadline",
      startAt: "2026-08-06T11:00:00.000Z",
      endAt: "2026-08-06T12:00:00.000Z"
    })));
  });

  it("configures and clears the encrypted API key through the assistant bridge", async () => {
    const assistant = createAssistantBridge({
      loadSettings: vi.fn(async () => ({
        configured: false,
        model: "gpt-4o-mini",
        savedAt: null,
        encrypted: true
      }))
    });
    render(createElement(AssistantView, { ...baseProps, assistant }));

    fireEvent.click(screen.getByRole("button", { name: "配置" }));
    await waitFor(() => expect(screen.getByText("未配置")).toBeDefined());
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "mock-key" } });
    fireEvent.change(screen.getByLabelText("模型"), { target: { value: "gpt-4.1" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(assistant.saveSettings).toHaveBeenCalledWith({
      apiKey: "mock-key",
      model: "gpt-4.1"
    }));
    expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "清除 API Key" }));
    await waitFor(() => expect(assistant.clearSettings).toHaveBeenCalled());
  });

  it("keeps parsing disabled until an API key is configured", async () => {
    const assistant = createAssistantBridge({
      loadSettings: vi.fn(async () => ({ configured: false, model: "gpt-4o-mini", savedAt: null, encrypted: true }))
    });
    render(createElement(AssistantView, { ...baseProps, assistant }));
    fireEvent.change(screen.getByLabelText("粘贴消息"), { target: { value: "请安排这条消息" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "交给 AI 解析" }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByRole("button", { name: "先配置 API Key" })).toBeDefined();
  });

  it("guides first-time setup, supports custom models, and tests the exact key-model pair", async () => {
    const assistant = createAssistantBridge({
      testConnection: vi.fn(async (input) => ({
        ok: true as const,
        model: input.model,
        checkedAt: "2026-08-05T00:00:00.000Z",
        latencyMs: 88
      }))
    });
    const onConfigured = vi.fn();
    render(createElement(AssistantSetupDialog, {
      assistant,
      onConfigured,
      onDismiss: vi.fn()
    }));

    expect(screen.getByRole("dialog", { name: "先配置 API Key" })).toBeDefined();
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "mock-key" } });
    fireEvent.change(screen.getByLabelText("模型"), { target: { value: "__custom__" } });
    fireEvent.change(screen.getByLabelText("自定义模型名称"), { target: { value: "custom-model" } });
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => expect(assistant.testConnection).toHaveBeenCalledWith({
      apiKey: "mock-key",
      model: "custom-model"
    }));
    expect(await screen.findByText("连接成功 · 88 ms")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "保存并开始使用" }));
    await waitFor(() => expect(assistant.saveSettings).toHaveBeenCalledWith({
      apiKey: "mock-key",
      model: "custom-model"
    }));
    expect(onConfigured).toHaveBeenCalled();
  });
});
