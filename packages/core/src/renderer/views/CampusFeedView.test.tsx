/* @vitest-environment jsdom */
import { createElement } from "react";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CampusFeedBridge, CampusFeedSnapshot, FeedItemRecord, FeedSourceDescriptor, PluginComponentProps } from "@campusos/shared";
import { CampusFeedView } from "../../../../../plugins/official/campus-feed/src/CampusFeedView";

afterEach(cleanup);

const bridge = (): NonNullable<PluginComponentProps["campusFeed"]> => ({
  getSnapshot: vi.fn(async () => ({ sources: [], items: [], notificationSettings: { keywords: [] }, lastRefresh: {} })),
  refreshSource: vi.fn(async () => []),
  refreshAll: vi.fn(async () => undefined),
  updateSource: vi.fn(async (_id: string, patch: unknown) => ({ id: "x", name: "x", category: "general", tags: [], baseUrl: "https://x", listUrl: "https://x", intervalMinutes: 60, enabled: true, ...(patch as Record<string, unknown>) })),
  saveNotificationSettings: vi.fn(async (input) => input),
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

  it("adds and removes persisted notification keywords", async () => {
    const feed = bridge();
    feed.getSnapshot = vi.fn(async () => ({ sources: [], items: [], notificationSettings: { keywords: ["奖学金"] }, lastRefresh: {} }));
    feed.saveNotificationSettings = vi.fn(async (input) => input);
    const { getByRole, findByText } = render(createElement(CampusFeedView, { ...baseProps, campusFeed: feed }));
    fireEvent.click(await getByRole("tab", { name: "设置" }));
    expect(await findByText("奖学金")).toBeTruthy();
    fireEvent.change(getByRole("textbox", { name: "通知关键词" }), { target: { value: "讲座" } });
    fireEvent.click(getByRole("button", { name: "添加关键词" }));
    await waitFor(() => expect(feed.saveNotificationSettings).toHaveBeenCalledWith({ keywords: ["奖学金", "讲座"] }));
    await waitFor(() => expect(findByText("讲座")).resolves.toBeTruthy());
    fireEvent.click(getByRole("button", { name: "移除关键词 讲座" }));
    await waitFor(() => expect(feed.saveNotificationSettings).toHaveBeenLastCalledWith({ keywords: ["奖学金"] }));
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
    getSnapshot: vi.fn(async () => ({ sources, items, notificationSettings: { keywords: [] }, lastRefresh: {} })),
    markRead: overrides.markRead ?? vi.fn(async () => undefined)
  }) as CampusFeedBridge;

  it("renders labeled source filter and filters on selection", async () => {
    const feed = makeBridge([sourceA, sourceB], [
      item("1", "s-a", "new", "A最新"), item("2", "s-a", "read", "A旧"), item("3", "s-b", "new", "B活动")
    ]);
    const { findByText, getByRole, queryByText, getByText } = render(createElement(CampusFeedView, { ...baseProps, campusFeed: feed }));
    expect(await findByText("A最新")).toBeTruthy();
    const sourceFilter = getByRole("combobox", { name: "来源" });
    expect(within(sourceFilter).getByRole("option", { name: /学工门户/ })).toBeTruthy();
    fireEvent.change(sourceFilter, { target: { value: "s-a" } });
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

  it("keeps source fetching and notification switches independent", async () => {
    const updateSource = vi.fn(async (_id: string, patch: Partial<FeedSourceDescriptor>) => ({ ...sourceA, ...patch }));
    const feed = makeBridge([{ ...sourceA, notificationEnabled: false }], []);
    feed.updateSource = updateSource;
    const { getByRole, findByText } = render(createElement(CampusFeedView, { ...baseProps, campusFeed: feed }));
    fireEvent.click(await getByRole("tab", { name: "订阅" }));
    expect(await findByText("学工门户")).toBeTruthy();
    expect(getByRole("switch", { name: "抓取 学工门户" }).getAttribute("aria-checked")).toBe("true");
    expect(getByRole("switch", { name: "接收 学工门户 的通知" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(getByRole("switch", { name: "接收 学工门户 的通知" }));
    await waitFor(() => expect(updateSource).toHaveBeenCalledWith("s-a", { notificationEnabled: true }));
  });

  it("locates and marks read the feed item named by a navigation target", async () => {
    const markRead = vi.fn(async () => undefined);
    const feed = makeBridge([{ ...sourceA, enabled: false }], [item("target", "s-a", "new", "目标资讯")], { markRead });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const targetProps = {
      ...baseProps,
      campusFeed: feed,
      navigationTarget: { requestId: "request-1", viewId: "campus-feed", entityId: "target" }
    };
    const { findByText } = render(createElement(CampusFeedView, targetProps));
    expect(await findByText("目标资讯")).toBeTruthy();
    expect(await findByText("已定位通知资讯")).toBeTruthy();
    await waitFor(() => expect(markRead).toHaveBeenCalledWith(["target"]));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it("opens a desktop notification batch as a focused feed list", async () => {
    const markRead = vi.fn(async () => undefined);
    const feed = makeBridge([sourceA, sourceB], [
      item("1", "s-a", "new", "本批第一条"),
      item("2", "s-a", "new", "批次外资讯"),
      item("3", "s-b", "new", "本批第二条")
    ], { markRead });
    Element.prototype.scrollIntoView = vi.fn();
    const { findByText, queryByText } = render(createElement(CampusFeedView, {
      ...baseProps,
      campusFeed: feed,
      navigationTarget: { requestId: "request-batch", viewId: "campus-feed", entityIds: ["1", "3"] }
    }));
    expect(await findByText("本次提醒的资讯")).toBeTruthy();
    expect(await findByText("本批第一条")).toBeTruthy();
    expect(await findByText("本批第二条")).toBeTruthy();
    expect(queryByText("批次外资讯")).toBeNull();
    expect(markRead).not.toHaveBeenCalled();
  });

  it("shows an initial loading state, then recovers with the snapshot", async () => {
    let resolveSnapshot!: (value: CampusFeedSnapshot) => void;
    const feed = bridge();
    feed.getSnapshot = vi.fn(() => new Promise<CampusFeedSnapshot>((resolve) => { resolveSnapshot = resolve; }));
    const { getByText, queryByText } = render(createElement(CampusFeedView, { ...baseProps, campusFeed: feed }));
    expect(getByText("正在读取校园资讯…")).toBeTruthy();
    expect(queryByText("还没有订阅信息源")).toBeNull();
    resolveSnapshot({ sources: [sourceA], items: [], notificationSettings: { keywords: [] }, lastRefresh: {} });
    await waitFor(() => expect(getByText("最新通知")).toBeTruthy());
  });

  it("shows read failure and retries the snapshot read", async () => {
    const feed = bridge();
    const getSnapshot = vi.fn()
      .mockRejectedValueOnce(new Error("读取失败"))
      .mockResolvedValueOnce({ sources: [sourceA], items: [item("1", "s-a", "new", "恢复后的资讯")], notificationSettings: { keywords: [] }, lastRefresh: {} });
    feed.getSnapshot = getSnapshot;
    const { findByText, getByRole } = render(createElement(CampusFeedView, { ...baseProps, campusFeed: feed }));
    expect(await findByText("资讯读取失败")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "重试读取" }));
    expect(await findByText("恢复后的资讯")).toBeTruthy();
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it("clears a previous refresh error after a later successful refresh", async () => {
    const feed = bridge();
    const refreshAll = vi.fn()
      .mockRejectedValueOnce(new Error("上游暂时不可用"))
      .mockResolvedValueOnce(undefined);
    feed.refreshAll = refreshAll;
    const { findByText, getByRole, queryByText } = render(createElement(CampusFeedView, {
      ...baseProps,
      campusFeed: { ...feed, getSnapshot: vi.fn(async () => ({ sources: [sourceA], items: [], notificationSettings: { keywords: [] }, lastRefresh: {} })) }
    }));
    expect(await findByText("最新通知")).toBeTruthy();
    const refresh = getByRole("button", { name: "刷新全部" });
    fireEvent.click(refresh);
    expect(await findByText("部分信息源没有更新")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "刷新全部" }));
    await waitFor(() => expect(queryByText("部分信息源没有更新")).toBeNull());
    expect(refreshAll).toHaveBeenCalledTimes(2);
  });

  it("ignores modified or control-key navigation events, while m and a work in the feed", async () => {
    const markRead = vi.fn(async () => undefined);
    const openExternal = vi.fn(async () => undefined);
    const feed = makeBridge([sourceA], [item("1", "s-a", "new", "正文资讯"), item("2", "s-a", "new", "第二条")], { markRead });
    feed.openExternal = openExternal;
    const { findByText, getByRole } = render(createElement(CampusFeedView, { ...baseProps, campusFeed: feed }));
    expect(await findByText("正文资讯")).toBeTruthy();
    const sourceFilter = getByRole("combobox", { name: "来源" });
    const refreshButton = getByRole("button", { name: "刷新全部" });
    fireEvent.keyDown(sourceFilter, { key: "m" });
    fireEvent.keyDown(sourceFilter, { key: "Enter" });
    fireEvent.keyDown(refreshButton, { key: "a", ctrlKey: true });
    fireEvent.keyDown(refreshButton, { key: "Enter" });
    expect(markRead).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "m" });
    await waitFor(() => expect(markRead).toHaveBeenCalledWith(["1"]));
    fireEvent.keyDown(document.body, { key: "a" });
    await waitFor(() => expect(markRead).toHaveBeenLastCalledWith(["1", "2"]));
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
    getSnapshot: vi.fn(async () => ({ sources, items, notificationSettings: { keywords: [] }, lastRefresh: {} }))
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
