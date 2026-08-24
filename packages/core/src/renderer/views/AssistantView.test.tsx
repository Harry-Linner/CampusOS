/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiAssistantAcademicQueryResult, AiAssistantExtractionResult, LocalTaskRecord, PluginCapabilityClient, PluginComponentProps } from "@campusos/shared";
import { AssistantView } from "../../../../../plugins/official/ai-assistant/src/AssistantView";

afterEach(cleanup);

const baseProps: PluginComponentProps = { capabilities: { read: vi.fn(async () => []) } as PluginCapabilityClient, loading: false, onRefresh: vi.fn(async () => undefined), snapshot: null };
const extractedField = <T,>(value: T, text: string | null = null) => ({ value, confidence: "high" as const, source: "explicit" as const, evidence: text ? { start: 0, end: text.length, text } : null, needsConfirmation: false });

const extraction: AiAssistantExtractionResult = {
  intent: "general",
  sourceText: "Submit report tomorrow at 8 PM",
  source: { app: "manual", sentAt: null },
  schemaVersion: 3,
  promptVersion: "test-v3",
  intents: [{
    id: "intent-1",
    intent: "create",
    kind: "deadline",
    title: extractedField("Submit report", "Submit report"),
    description: extractedField("Finish the report"),
    deadlineAt: extractedField("2026-08-06T12:00:00.000Z", "tomorrow at 8 PM"),
    startAt: extractedField<string | null>(null),
    endAt: extractedField<string | null>(null),
    durationMinutes: extractedField<number | null>(null),
    location: extractedField<string | null>(null),
    courseName: extractedField<string | null>(null),
    confidence: "high",
    missingFields: ["durationMinutes"],
    warnings: [],
    fingerprint: "fingerprint-1"
  }],
  unresolvedQuestions: []
};

const settings = { configured: true, provider: "openai" as const, protocol: "openai-responses" as const, baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", savedAt: "2026-08-05T00:00:00.000Z", encrypted: true };

const createAssistantBridge = (overrides: Partial<NonNullable<PluginComponentProps["assistant"]>> = {}): NonNullable<PluginComponentProps["assistant"]> => ({
  loadSettings: vi.fn(async () => settings),
  saveSettings: vi.fn(async (input) => ({ ...settings, ...input, configured: true, savedAt: "2026-08-05T00:00:00.000Z", encrypted: true })),
  clearSettings: vi.fn(async () => ({ ...settings, configured: false, savedAt: null })),
  testConnection: vi.fn(async (input) => ({ ok: true as const, provider: input.provider, protocol: input.protocol, model: input.model, checkedAt: "2026-08-05T00:00:00.000Z", latencyMs: 120, structuredOutput: true as const, modelListingSupported: true })),
  discoverModels: vi.fn(async (input) => ({ provider: input.provider, models: ["discovered-model"], checkedAt: "2026-08-05T00:00:00.000Z", latencyMs: 80 })),
  parseMessage: vi.fn(async () => extraction),
  ...overrides
});

const existingTask: LocalTaskRecord = {
  id: "task-existing",
  status: "running",
  description: "Finish the report",
  timeSpentMinutes: 0,
  timeNeededMinutes: 60,
  startAt: "2026-08-06T11:00:00.000Z",
  endAt: "2026-08-06T12:00:00.000Z",
  location: "",
  title: "Submit report",
  breakable: true,
  type: "deadline",
  repeatType: "norepeat",
  repeatPeriod: 1,
  repeatEndsOn: "2026-08-06",
  blocksPlanning: true,
  fromId: null,
  courseName: null,
  source: null
};

const createScheduleBridge = (overrides: Partial<NonNullable<PluginComponentProps["schedule"]>> = {}): NonNullable<PluginComponentProps["schedule"]> => ({
  saveTask: vi.fn(async () => ({ tasks: [], updatedAt: "2026-08-05T00:00:00.000Z" })),
  loadTasks: vi.fn(async () => ({ tasks: [], updatedAt: "2026-08-05T00:00:00.000Z" })),
  loadPeriods: vi.fn(async () => []),
  mutateTask: vi.fn(async () => ({ tasks: [], updatedAt: "2026-08-05T00:00:00.000Z" })),
  exportIcal: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
  ...overrides
});

describe("AssistantView", () => {
  it("presents message time as an optional context control", async () => {
    const assistant = createAssistantBridge();
    render(createElement(AssistantView, { ...baseProps, assistant }));
    await waitFor(() => expect(assistant.loadSettings).toHaveBeenCalled());

    expect(screen.getByText("消息发送时间")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "使用当前时间" }));
    expect((screen.getByLabelText("消息发送时间") as HTMLInputElement).value).not.toBe("");
    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    expect((screen.getByLabelText("消息发送时间") as HTMLInputElement).value).toBe("");
  });

  it("parses a message into a candidate and commits it through Schedule with a local fingerprint", async () => {
    const assistant = createAssistantBridge();
    const saveTask = vi.fn(async () => ({ tasks: [], updatedAt: "2026-08-05T00:00:00.000Z", operation: { kind: "created" as const, taskId: "task-1" } }));
    render(createElement(AssistantView, { ...baseProps, assistant, schedule: createScheduleBridge({ saveTask }) }));
    await waitFor(() => expect(assistant.loadSettings).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("粘贴消息"), { target: { value: extraction.sourceText } });
    fireEvent.click(screen.getByRole("button", { name: "交给 AI 解析" }));
    await waitFor(() => expect(screen.getByText("Submit report", { selector: "h3" })).toBeTruthy());
    const candidate = screen.getByText("Submit report", { selector: "h3" }).closest("article")!;
    fireEvent.click(within(candidate).getByRole("button", { name: "确认并写入" }));
    await waitFor(() => expect(saveTask).toHaveBeenCalledWith(expect.objectContaining({ title: "Submit report", timeNeededMinutes: 60, courseName: null, source: expect.objectContaining({ kind: "ai-assistant", fingerprint: "fingerprint-1", provider: "openai" }) })));
  });

  it("renders multiple candidates and unresolved questions", async () => {
    const second = { ...extraction.intents[0], id: "intent-2", title: extractedField("Attend review meeting"), kind: "event" as const, fingerprint: "fingerprint-2" };
    const assistant = createAssistantBridge({ parseMessage: vi.fn(async () => ({ ...extraction, intents: [extraction.intents[0], second], unresolvedQuestions: ["Which room is the meeting in?"] })) });
    render(createElement(AssistantView, { ...baseProps, assistant }));
    await waitFor(() => expect(assistant.loadSettings).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("粘贴消息"), { target: { value: "two actions" } });
    fireEvent.click(screen.getByRole("button", { name: "交给 AI 解析" }));
    await waitFor(() => expect(screen.getByText("2 个候选 · Schema 3")).toBeTruthy());
    expect(screen.getByText("Which room is the meeting in?")).toBeTruthy();
  });

  it.each([
    { intent: "update" as const, button: "确认更新", expectedNotice: "已更新：Submit report" },
    { intent: "cancel" as const, button: "确认取消", expectedNotice: "已取消：Submit report" }
  ])("matches a unique existing task before $intent", async ({ intent, button, expectedNotice }) => {
    const assistant = createAssistantBridge({ parseMessage: vi.fn(async () => ({ ...extraction, intents: [{ ...extraction.intents[0], intent }] })) });
    const saveTask = vi.fn(async () => ({ tasks: [existingTask], updatedAt: "2026-08-05T00:00:00.000Z", operation: { kind: "updated" as const, taskId: existingTask.id } }));
    const mutateTask = vi.fn(async () => ({ tasks: [], updatedAt: "2026-08-05T00:00:00.000Z" }));
    const schedule = createScheduleBridge({ saveTask, mutateTask, loadTasks: vi.fn(async () => ({ tasks: [existingTask], updatedAt: "2026-08-05T00:00:00.000Z" })) });
    render(createElement(AssistantView, { ...baseProps, assistant, schedule }));

    await waitFor(() => expect(assistant.loadSettings).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("粘贴消息"), { target: { value: extraction.sourceText } });
    fireEvent.click(screen.getByRole("button", { name: "交给 AI 解析" }));
    await waitFor(() => expect(screen.getByRole("button", { name: button })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: button }));

    await waitFor(() => expect(screen.getByText(expectedNotice)).toBeTruthy());
    if (intent === "update") {
      expect(saveTask).toHaveBeenCalledWith(expect.objectContaining({ id: existingTask.id, title: "Submit report" }));
      expect(mutateTask).not.toHaveBeenCalled();
    } else {
      expect(mutateTask).toHaveBeenCalledWith({ id: existingTask.id, status: "deleted" });
      expect(saveTask).not.toHaveBeenCalled();
    }
  });

  it("switches to the read-only data-query mode and renders the answer with evidence sources", async () => {
    const academic: AiAssistantAcademicQueryResult = {
      intent: "academic-query",
      sourceText: "我下周哪天有早八？",
      source: { app: "manual", sentAt: null },
      answer: "周一第 1、2 节有高等数学。",
      evidence: [{ capability: "academic.timetable@1", label: "课表", capturedAt: "2026-08-05T00:00:00.000Z", state: "live", values: ["高等数学", "第1节"] }],
      degraded: false,
      generatedAt: "2026-08-05T00:00:00.000Z",
      promptVersion: "test-academic-v1"
    };
    const assistant = createAssistantBridge({ parseMessage: vi.fn(async () => academic) });
    render(createElement(AssistantView, { ...baseProps, assistant }));
    await waitFor(() => expect(assistant.loadSettings).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("粘贴消息"), { target: { value: academic.sourceText } });
    fireEvent.click(screen.getByRole("button", { name: "交给 AI 解析" }));

    await waitFor(() => expect(screen.getByText("数据问答 · 只读本地数据")).toBeTruthy());
    expect(screen.getByText("数据问答", { selector: "h2" })).toBeTruthy();
    expect(screen.getByText(academic.answer)).toBeTruthy();
    expect(screen.getByText("证据引用")).toBeTruthy();
    expect(screen.getByText("课表")).toBeTruthy();
    expect(screen.getByText("高等数学")).toBeTruthy();
    // 通用模式不残留
    expect(screen.queryByText("待确认事项")).toBeNull();
  });

  it("keeps follow-up questions in data-query mode and shows degraded answers without a fake result", async () => {
    const degraded: AiAssistantAcademicQueryResult = {
      intent: "academic-query",
      sourceText: "我成绩多少？",
      source: { app: "manual", sentAt: null },
      answer: "尚未验证学业账号，暂时无法查询本地学业数据。",
      evidence: [],
      degraded: true,
      generatedAt: "2026-08-05T00:00:00.000Z",
      promptVersion: "test-academic-v1"
    };
    const assistant = createAssistantBridge({ parseMessage: vi.fn(async () => degraded) });
    render(createElement(AssistantView, { ...baseProps, assistant }));
    await waitFor(() => expect(assistant.loadSettings).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("粘贴消息"), { target: { value: degraded.sourceText } });
    fireEvent.click(screen.getByRole("button", { name: "交给 AI 解析" }));

    await waitFor(() => expect(screen.getByText(degraded.answer)).toBeTruthy());
    expect(document.querySelector(".assistant-academic-degraded")).toBeTruthy();
    expect(screen.queryByText("证据引用")).toBeNull();
  });
});
