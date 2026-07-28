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
  it("previews the next semester's matching weekday outside teaching periods", () => {
    render(createElement(DashboardView, {
      loading: false,
      snapshot: createUpcomingSnapshot()
    }));

    expect(screen.getByRole("heading", { name: "下学期周二预览" })).toBeDefined();
    expect(screen.getByText("秋季周二课程")).toBeDefined();
    expect(screen.queryByText("历史课程")).toBeNull();
    expect(screen.queryByText("秋季开学周五课程")).toBeNull();
    expect(screen.queryByText("秋季周三课程")).toBeNull();
    expect(screen.queryByText("秋季第二周课程")).toBeNull();
  });
});
