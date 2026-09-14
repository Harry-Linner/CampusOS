/* @vitest-environment jsdom */

import { createElement } from "react";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CampusWorkspaceSnapshot, CampusFeedBridge, CampusFeedSnapshot } from "@campusos/shared";
import { GlobalSearch } from "./GlobalSearch";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("searches archived metadata without an academic snapshot and navigates to the returned item", async () => {
  const searchHistory = vi.fn(async () => ({ total: 1, items: [{ id: "archived", sourceId: "history-source", title: "历史条目", url: "https://example.edu/old", summary: null, publishedAt: "2020-01-01T00:00:00Z", fetchedAt: "2020-01-01T00:00:00Z", contentHash: "h", state: "read" as const }] }));
  const onNavigate = vi.fn();
  render(createElement(GlobalSearch, { open: true, onClose: vi.fn(), snapshot: null, onNavigate, campusFeed: { searchHistory } }));
  fireEvent.change(screen.getByPlaceholderText("搜索课程、事项、资料和资讯"), { target: { value: "来源关键词" } });
  fireEvent.click(await screen.findByText("历史条目"));
  expect(screen.queryByText(/历史资讯.*条.*已显示/)).toBeNull();
  expect(searchHistory).toHaveBeenCalledWith({ query: "来源关键词", offset: 0 });
  expect(onNavigate).toHaveBeenCalledWith({ viewId: "campus-feed", entityId: "archived" });
});

it("refreshes an open search when subscriptions change and discards previous pages", async () => {
  let listener: Parameters<CampusFeedBridge["subscribe"]>[0] = () => undefined;
  const unsubscribe = vi.fn();
  const item = (id: string) => ({ id, sourceId: id, title: `消息${id}`, url: "https://example.edu/old", summary: null, publishedAt: null, fetchedAt: "2020-01-01T00:00:00Z", contentHash: "h", state: "read" as const });
  const searchHistory = vi.fn().mockResolvedValueOnce({ total: 2, items: [item("a")] }).mockResolvedValueOnce({ total: 2, items: [item("b")] }).mockResolvedValueOnce({ total: 1, items: [item("c")] });
  const subscribe = (next: typeof listener) => { listener = next; return unsubscribe; };
  const view = render(createElement(GlobalSearch, { open: true, onClose: vi.fn(), snapshot: null, onNavigate: vi.fn(), campusFeed: { searchHistory, subscribe } }));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "消息" } });
  await screen.findByText("消息a");
  fireEvent.click(screen.getByRole("button", { name: /加载更多/ }));
  await screen.findByText("消息b");
  act(() => listener({ sources: [], items: [], lastRefresh: {}, notificationSettings: { keywords: [] } } satisfies CampusFeedSnapshot));
  await screen.findByText("消息c");
  expect(screen.queryByText("消息a")).toBeNull();
  expect(screen.queryByText("消息b")).toBeNull();
  expect(searchHistory).toHaveBeenLastCalledWith({ query: "消息", offset: 0 });
  view.unmount();
  expect(unsubscribe).toHaveBeenCalled();
});

it("keeps search pages when a feed broadcast does not change subscriptions", async () => {
  let listener: Parameters<CampusFeedBridge["subscribe"]>[0] = () => undefined;
  const snapshot: CampusFeedSnapshot = { sources: [], items: [], lastRefresh: {}, notificationSettings: { keywords: [] } };
  const searchHistory = vi.fn(async () => ({ total: 0, items: [] }));
  const getSnapshot = vi.fn(async () => snapshot);
  render(createElement(GlobalSearch, { open: true, onClose: vi.fn(), snapshot: null, onNavigate: vi.fn(), campusFeed: { searchHistory, getSnapshot, subscribe: next => { listener = next; return () => undefined; } } }));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "消息" } });
  await waitFor(() => expect(searchHistory).toHaveBeenCalledTimes(1));
  act(() => listener(snapshot));
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(searchHistory).toHaveBeenCalledTimes(1);
});

const snapshot: CampusWorkspaceSnapshot = {
  generatedAt: "2026-08-15T00:00:00.000Z",
  term: {
    label: "2026-2027 秋冬",
    phase: "upcoming",
    currentWeek: null,
    progressPercent: 0
  },
  sourceStates: [],
  courses: [
    {
      id: "course-1",
      title: "高等数学",
      courseCode: "MATH1001",
      instructor: "张教授",
      location: "紫金港东1A-301",
      sourceId: "academic-affairs",
      startAt: "2026-09-14T00:00:00.000Z",
      endAt: "2026-09-14T01:35:00.000Z"
    }
  ],
  todayCourses: [],
  deadlines: [
    {
      id: "deadline-1",
      title: "提交课程设计",
      courseName: "软件工程",
      note: "截止前提交",
      dueAt: "2026-08-20T23:59:00.000Z",
      sourceId: "learning-platform",
      kind: "assignment",
      priority: "routine"
    }
  ],
  materials: [
    {
      id: "material-1",
      title: "第 1 章课件",
      courseName: "高等数学",
      semester: "2025-2026 夏",
      sourceId: "learning-platform",
      updatedAt: "2026-08-01T00:00:00.000Z"
    }
  ],
  downloads: [],
  reminders: [],
  summary: {
    readySources: 0,
    totalSources: 0,
    downloadsInFlight: 0,
    materialsReady: 0,
    remindersQueued: 0,
    deadlinesDueSoon: 0
  }
};

const createProps = (overrides: Partial<Parameters<typeof GlobalSearch>[0]> = {}) => ({
  open: true,
  snapshot,
  onClose: vi.fn(),
  onNavigate: vi.fn(),
  ...overrides
});

const getInput = (): HTMLInputElement =>
  screen.getByPlaceholderText("搜索课程、事项、资料和资讯") as HTMLInputElement;

describe("GlobalSearch", () => {
  it("renders nothing when closed", () => {
    const props = createProps({ open: false });
    const { container } = render(createElement(GlobalSearch, props));
    expect(container.firstChild).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("resets the query and focuses the input when opened", async () => {
    render(createElement(GlobalSearch, createProps()));
    const input = getInput();
    expect(input.value).toBe("");
    expect(screen.getByText("输入名称、来源、日期或列表摘要关键词")).toBeTruthy();
  });

  it("filters courses, items, and materials by query", async () => {
    render(createElement(GlobalSearch, createProps()));
    const input = getInput();
    fireEvent.change(input, { target: { value: "高等" } });
    expect(screen.getByText("高等数学")).toBeTruthy();
    expect(screen.getByText("课程")).toBeTruthy();
    expect(screen.getByText("MATH1001 · 张教授 · 紫金港东1A-301")).toBeTruthy();

    fireEvent.change(input, { target: { value: "提交课程设计" } });
    expect(screen.getByText("提交课程设计")).toBeTruthy();
    expect(screen.getByText("事项")).toBeTruthy();

    fireEvent.change(input, { target: { value: "第 1 章" } });
    expect(screen.getByText("第 1 章课件")).toBeTruthy();
    expect(screen.getByText("资料")).toBeTruthy();
  });

  it("shows an empty state when no result matches", () => {
    render(createElement(GlobalSearch, createProps()));
    const input = getInput();
    fireEvent.change(input, { target: { value: "不存在的关键词" } });
    expect(screen.getByText("没有匹配结果")).toBeTruthy();
  });

  it("navigates and closes when a result is selected", () => {
    const props = createProps();
    render(createElement(GlobalSearch, props));
    const input = getInput();
    fireEvent.change(input, { target: { value: "高等" } });
    fireEvent.click(screen.getByText("高等数学"));
    expect(props.onNavigate).toHaveBeenCalledWith(expect.objectContaining({ viewId: "academic" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const props = createProps();
    render(createElement(GlobalSearch, props));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is pressed directly", () => {
    const props = createProps();
    const { container } = render(createElement(GlobalSearch, props));
    const backdrop = container.querySelector(".global-search-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.mouseDown(backdrop!);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when the dialog body is pressed", () => {
    const props = createProps();
    render(createElement(GlobalSearch, props));
    const dialog = screen.getByRole("dialog", { name: "全局搜索" });
    fireEvent.mouseDown(dialog);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("removes the keydown listener when closed or unmounted", async () => {
    const props = createProps();
    const { unmount } = render(createElement(GlobalSearch, props));
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(props.onClose).not.toHaveBeenCalled());
  });
});
