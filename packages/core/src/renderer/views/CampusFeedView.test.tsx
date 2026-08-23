/* @vitest-environment jsdom */
import { createElement } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CampusFeedBridge, PluginComponentProps } from "@campusos/shared";
import { CampusFeedView } from "../../../../../plugins/official/campus-feed/src/CampusFeedView";

afterEach(cleanup);

const bridge = (): NonNullable<PluginComponentProps["campusFeed"]> => ({
  getSnapshot: vi.fn(async () => ({ sources: [], items: [], lastRefresh: {} })),
  refreshSource: vi.fn(async () => []),
  refreshAll: vi.fn(async () => undefined),
  updateSource: vi.fn(async (_id: string, patch: unknown) => ({ id: "x", name: "x", category: "general", tags: [], baseUrl: "https://x", listUrl: "https://x", intervalMinutes: 60, enabled: true, ...(patch as Record<string, unknown>) })),
  removeSource: vi.fn(async () => undefined),
  markRead: vi.fn(async () => undefined),
  openExternal: vi.fn(async () => undefined),
  loadAiSettings: vi.fn(async () => null),
  saveAiSettings: vi.fn(async () => null),
  testAiConnection: vi.fn(async () => ({ ok: true, message: "ok" })),
  extractScheduleCandidates: vi.fn(async () => []),
  createScheduleTasks: vi.fn(async () => ({ created: 0, deduplicated: 0 })),
  subscribe: vi.fn(() => () => undefined)
}) as CampusFeedBridge;

const baseProps = {
  snapshot: null,
  loading: false,
  capabilities: {} as PluginComponentProps["capabilities"],
  onRefresh: async () => undefined
} as PluginComponentProps;

describe("campus-feed view", () => {
  it("renders the settings tab with the AI connection form", async () => {
    const { getByRole, findByText } = render(createElement(CampusFeedView, { ...baseProps, campusFeed: bridge() }));
    const settingsTab = await getByRole("tab", { name: "设置" });
    fireEvent.click(settingsTab);
    expect(await findByText("AI 处理")).toBeTruthy();
    expect(getByRole("button", { name: "测试连接" })).toBeTruthy();
    expect(getByRole("button", { name: "保存设置" })).toBeTruthy();
  });
});
