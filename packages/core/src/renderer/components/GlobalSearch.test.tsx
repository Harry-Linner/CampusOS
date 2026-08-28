/* @vitest-environment jsdom */

import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CampusWorkspaceSnapshot } from "@campusos/shared";
import { GlobalSearch } from "./GlobalSearch";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
  screen.getByPlaceholderText("搜索课程、事项和资料") as HTMLInputElement;

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
    expect(screen.getByText("输入名称、课程代码、教师或学期")).toBeTruthy();
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
