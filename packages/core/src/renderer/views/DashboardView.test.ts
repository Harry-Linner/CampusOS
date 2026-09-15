/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CampusCourseSession, CampusWorkspaceSnapshot } from "@campusos/shared";
import { DashboardView } from "./DashboardView";
afterEach(cleanup);

const course = (
  id: string,
  title: string,
  startAt: string,
  endAt: string
): CampusCourseSession => ({
  id,
  title,
  startAt,
  endAt,
  location: "教学楼",
  sourceId: "academic-affairs"
});

const createUpcomingSnapshot = (): CampusWorkspaceSnapshot => ({
  generatedAt: "2026-07-28T04:00:00.000Z",
  term: {
    label: "2026-2027 秋学期",
    phase: "upcoming",
    currentWeek: null,
    progressPercent: 0
  },
  sourceStates: [],
  courses: [
    course(
      "historical:w1",
      "历史课程",
      "2026-06-30T08:00:00+08:00",
      "2026-06-30T09:35:00+08:00"
    ),
    course(
      "autumn-friday:w1",
      "秋季开学周五课程",
      "2026-09-11T08:00:00+08:00",
      "2026-09-11T09:35:00+08:00"
    ),
    course(
      "autumn-tuesday:w1",
      "秋季周二课程",
      "2026-09-15T08:00:00+08:00",
      "2026-09-15T09:35:00+08:00"
    ),
    course(
      "autumn-wednesday:w1",
      "秋季周三课程",
      "2026-09-16T08:00:00+08:00",
      "2026-09-16T09:35:00+08:00"
    ),
    course(
      "autumn-tuesday:w2",
      "秋季第二周课程",
      "2026-09-22T08:00:00+08:00",
      "2026-09-22T09:35:00+08:00"
    )
  ],
  todayCourses: [],
  deadlines: [],
  materials: [],
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
});

describe("DashboardView", () => {
  it("previews today's courses as 今日事项预览 regardless of term phase", () => {
    const snapshot = createUpcomingSnapshot();
    snapshot.todayCourses = [snapshot.courses[0]];

    render(createElement(DashboardView, { loading: false, snapshot }));

    expect(screen.getByRole("heading", { name: "今日事项预览" })).toBeDefined();
    expect(screen.getByText("历史课程")).toBeDefined();
    expect(screen.queryByText("历史课程")?.closest("ol")).not.toBeNull();
  });

  it("shows the empty state when there are no courses today", () => {
    render(createElement(DashboardView, {
      loading: false,
      snapshot: createUpcomingSnapshot()
    }));

    expect(screen.getByRole("heading", { name: "今日事项预览" })).toBeDefined();
    expect(screen.getByText("今日暂无课程安排")).toBeDefined();
  });

  it("does not expose a mock marker when an active term has no week number", () => {
    const snapshot = createUpcomingSnapshot();
    snapshot.term = {
      ...snapshot.term,
      phase: "active",
      currentWeek: null
    };

    render(createElement(DashboardView, { loading: false, snapshot }));

    expect(screen.getByText("学期进行中")).toBeDefined();
    expect(screen.queryByText("mock")).toBeNull();
  });

  it("surfaces how many items the projection dropped, and stays silent when none", () => {
    const withOmissions = createUpcomingSnapshot();
    withOmissions.sourceStates = [
      {
        sourceId: "academic-affairs",
        label: "教务处网站",
        status: "partial",
        connectionState: "connected",
        lastSyncedAt: "2026-07-28T04:00:00.000Z",
        itemCount: 0,
        summary: "缓存或降级事件已接入，0 项进入日历。",
        omittedItemCount: 3
      },
      {
        sourceId: "learning-platform",
        label: "学在浙大",
        status: "ready",
        connectionState: "connected",
        lastSyncedAt: "2026-07-28T04:00:00.000Z",
        itemCount: 0,
        summary: "实时事件已接入，1 项进入日历。"
      }
    ];

    const { unmount } = render(createElement(DashboardView, {
      loading: false,
      snapshot: withOmissions
    }));
    expect(screen.getByText("另有 3 项缺少可信时间，未写入日历。")).toBeDefined();
    unmount();

    render(createElement(DashboardView, {
      loading: false,
      snapshot: createUpcomingSnapshot()
    }));
    expect(screen.queryByText(/缺少可信时间/)).toBeNull();
  });

  it("says which day the retained data came from when a source is degraded", () => {
    const degraded = createUpcomingSnapshot();
    degraded.sourceStates = [{
      sourceId: "academic-affairs",
      label: "教务处网站",
      status: "partial",
      connectionState: "connected",
      lastSyncedAt: "2026-07-20T04:00:00.000Z",
      itemCount: 0,
      summary: "缓存或降级事件已接入，0 项进入日历。本轮数据源降级且未返回事件，已保留上次事件。",
      retainedDegradedAt: "2026-07-20T04:00:00.000Z"
    }];

    render(createElement(DashboardView, { loading: false, snapshot: degraded }));

    expect(screen.getByText(/本轮数据源降级未返回事件，当前显示/)).toBeDefined();
  });

  it("keeps a stable hook order when the snapshot transitions from loading to ready", () => {
    // 回归：调休卡片 hooks 曾在条件 return 之后声明，snapshot 从 null 变为有值时
    // React 抛出 "Rendered more hooks than during the previous render" 导致纯色崩溃。
    const snapshot = createUpcomingSnapshot();
    const { rerender } = render(createElement(DashboardView, {
      loading: true,
      snapshot: null
    }));
    expect(screen.getByLabelText("正在加载总览")).toBeDefined();

    expect(() => {
      rerender(createElement(DashboardView, { loading: false, snapshot }));
    }).not.toThrow();
    expect(screen.getByRole("heading", { name: "今日事项预览" })).toBeDefined();

    // 反过来（有值 → 空）也不得改变 hooks 顺序。
    expect(() => {
      rerender(createElement(DashboardView, { loading: true, snapshot: null }));
    }).not.toThrow();
    expect(screen.getByLabelText("正在加载总览")).toBeDefined();
  });

  it("dynamically projects today courses from full course list when cached snapshot was from yesterday", () => {
    const snapshot = createUpcomingSnapshot();
    // 模拟快照来自昨天 2026-09-14，todayCourses 记录的是昨天的历史课
    snapshot.generatedAt = "2026-09-14T20:00:00.000Z";
    snapshot.todayCourses = [snapshot.courses[0]]; // 历史旧课 2026-06-30

    // 显式传入当前系统时间为 2026-09-15（周二）
    const todayDate = new Date("2026-09-15T09:00:00+08:00");
    render(createElement(DashboardView, {
      loading: false,
      snapshot,
      currentDate: todayDate
    }));

    // 验证左上角显示 9月15日
    expect(screen.getByText("9月15日星期二")).toBeDefined();
    // 验证今日事项动态筛选出 9月15日的秋季周二课程，而排除了昨天的旧课
    expect(screen.getByText("秋季周二课程")).toBeDefined();
    expect(screen.queryByText("历史课程")).toBeNull();
  });
});
