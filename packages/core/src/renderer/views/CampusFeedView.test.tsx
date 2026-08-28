/* @vitest-environment jsdom */
import { createElement } from "react";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CampusFeedBridge, FeedItemRecord, FeedSourceDescriptor, PluginComponentProps } from "@campusos/shared";
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

describe("campus-feed view (source/tag/unread filters)", () => {
  const sourceA: FeedSourceDescriptor = { id: "s-a", name: "学工门户", category: "general", tags: ["评奖评优"], baseUrl: "https://a", listUrl: "https://a/list", intervalMinutes: 60, enabled: true };
  const sourceB: FeedSourceDescriptor = { id: "s-b", name: "校团委", category: "general", tags: ["活动"], baseUrl: "https://b", listUrl: "https://b/list", intervalMinutes: 60, enabled: true };
  const item = (id: string, sourceId: string, state: "new" | "read", title: string): FeedItemRecord => ({
    id, sourceId, title, url: `https://x/${id}`, publishedAt: "2026-08-28T00:00:00.000Z",
    summary: null, contentHash: `h-${id}`, fetchedAt: "2026-08-28T00:00:00.000Z", state
  });

  const makeBridge = (sources: FeedSourceDescriptor[], items: FeedItemRecord[], overrides: { markRead?: ReturnType<typeof vi.fn> } = {}): NonNullable<PluginComponentProps["campusFeed"]> => ({
    ...bridge(),
    getSnapshot: vi.fn(async () => ({ sources, items, lastRefresh: {} })),
    markRead: overrides.markRead ?? vi.fn(async () => undefined)
  }) as CampusFeedBridge;

  it("renders source chips with per-source unread badges and filters on click", async () => {
    const feed = makeBridge([sourceA, sourceB], [
      item("1", "s-a", "new", "A最新"), item("2", "s-a", "read", "A旧"), item("3", "s-b", "new", "B活动")
    ]);
    const { findByText, getByRole, queryByText, getByText } = render(createElement(CampusFeedView, { ...baseProps, campusFeed: feed }));
    expect(await findByText("A最新")).toBeTruthy();
    // "全部来源" chip + a chip per enabled source
    expect(getByRole("button", { name: "全部来源" })).toBeTruthy();
    const sourceGroup = getByRole("group", { name: "按来源筛选" });
    fireEvent.click(within(sourceGroup).getByRole("button", { name: /^学工门户/ }));
    expect(queryByText("B活动")).toBeNull();
    expect(getByText("A最新")).toBeTruthy();
  });

  it("filters to unread only when the switch is on", async () => {
    const feed = makeBridge([sourceA], [item("1", "s-a", "new", "新条目"), item("2", "s-a", "read", "已读条目")]);
    const { findByText, getByRole, queryByText, getByText } = render(createElement(CampusFeedView, { ...baseProps, campusFeed: feed }));
    expect(await findByText("新条目")).toBeTruthy();
    expect(getByText("已读条目")).toBeTruthy();
    fireEvent.click(getByRole("switch", { name: "只看未读" }));
    expect(queryByText("已读条目")).toBeNull();
    expect(getByText("新条目")).toBeTruthy();
  });

  it("marks a single source read through its section button", async () => {
    const markRead = vi.fn(async () => undefined);
    const feed = makeBridge([sourceA, sourceB], [item("1", "s-a", "new", "A新"), item("4", "s-b", "read", "B旧")], { markRead });
    const { findByText, getAllByRole } = render(createElement(CampusFeedView, { ...baseProps, campusFeed: feed }));
    expect(await findByText("A新")).toBeTruthy();
    // header 全部已读 + source A 全部已读 (source B has no unread)
    const readButtons = getAllByRole("button", { name: "全部已读" });
    expect(readButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(readButtons[1]);
    expect(markRead).toHaveBeenCalledWith(["1"]);
  });
});

describe("campus-feed view (第2层 三视图与分节折叠)", () => {
  const sourceA: FeedSourceDescriptor = { id: "s-a", name: "学工门户", category: "general", tags: ["评奖评优"], baseUrl: "https://a", listUrl: "https://a/list", intervalMinutes: 60, enabled: true };
  const sourceB: FeedSourceDescriptor = { id: "s-b", name: "校团委", category: "general", tags: ["活动"], baseUrl: "https://b", listUrl: "https://b/list", intervalMinutes: 60, enabled: true };
  const item = (id: string, sourceId: string, title: string): FeedItemRecord => ({
    id, sourceId, title, url: `https://x/${id}`, publishedAt: "2026-08-28T00:00:00.000Z",
    summary: null, contentHash: `h-${id}`, fetchedAt: "2026-08-28T00:00:00.000Z", state: "new"
  });
  const makeBridge = (sources: FeedSourceDescriptor[], items: FeedItemRecord[]): NonNullable<PluginComponentProps["campusFeed"]> => ({
    ...bridge(),
    getSnapshot: vi.fn(async () => ({ sources, items, lastRefresh: {} }))
  }) as CampusFeedBridge;

  it("switches to the all-stream view without hiding items", async () => {
    const feed = makeBridge([sourceA, sourceB], [item("1", "s-a", "A最新"), item("3", "s-b", "B活动")]);
    const { findByText, getByRole, getByText } = render(createElement(CampusFeedView, { ...baseProps, campusFeed: feed }));
    expect(await findByText("A最新")).toBeTruthy();
    expect(getByText("B活动")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "时间流" }));
    expect(getByText("A最新")).toBeTruthy();
    expect(getByText("B活动")).toBeTruthy();
  });

  it("collapses a source group to hide its items", async () => {
    const feed = makeBridge([sourceA, sourceB], [item("1", "s-a", "A最新"), item("3", "s-b", "B活动")]);
    const { findByText, getAllByRole, queryByText, getByText } = render(createElement(CampusFeedView, { ...baseProps, campusFeed: feed }));
    expect(await findByText("A最新")).toBeTruthy();
    const collapseButtons = getAllByRole("button", { name: /条通知/ });
    fireEvent.click(collapseButtons[0]);
    expect(queryByText("A最新")).toBeNull();
    expect(getByText("B活动")).toBeTruthy();
  });
});
