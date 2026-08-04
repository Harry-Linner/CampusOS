import { describe, expect, it } from "vitest";
import type { CampusWorkspaceSnapshot } from "@campusos/shared";
import { buildGlobalSearchIndex, searchGlobalIndex } from "./globalSearch";

const snapshot: CampusWorkspaceSnapshot = {
  generatedAt: "2026-08-04T00:00:00.000Z",
  term: { label: "2026-2027 秋冬", phase: "upcoming", currentWeek: null, progressPercent: 0 },
  sourceStates: [],
  courses: [
    {
      id: "course-1-a",
      title: "组织行为学",
      courseCode: "MGT3001",
      instructor: "教师甲",
      location: "教学楼 101",
      startAt: "2026-09-14T00:00:00.000Z",
      endAt: "2026-09-14T01:35:00.000Z",
      sourceId: "academic-affairs"
    },
    {
      id: "course-1-b",
      title: "组织行为学",
      courseCode: "MGT3001",
      instructor: "教师甲",
      location: "教学楼 101",
      startAt: "2026-09-21T00:00:00.000Z",
      endAt: "2026-09-21T01:35:00.000Z",
      sourceId: "academic-affairs"
    }
  ],
  todayCourses: [],
  deadlines: [
    {
      id: "deadline-1",
      title: "案例分析提交",
      courseName: "组织行为学",
      dueAt: "2026-10-01T12:00:00.000Z",
      sourceId: "learning-platform",
      kind: "assignment",
      priority: "important"
    }
  ],
  materialCourses: [],
  materials: [
    {
      id: "material-1",
      title: "第一讲.pdf",
      courseName: "组织行为学",
      semester: "2026-2027 秋冬",
      sourceId: "learning-platform",
      updatedAt: "2026-09-01T00:00:00.000Z"
    }
  ],
  downloads: [],
  reminders: [],
  summary: {
    readySources: 0,
    totalSources: 0,
    downloadsInFlight: 0,
    materialsReady: 1,
    remindersQueued: 0,
    deadlinesDueSoon: 0
  }
};

describe("global search", () => {
  it("keeps an empty query empty and deduplicates recurring course sessions", () => {
    const index = buildGlobalSearchIndex(snapshot);
    expect(searchGlobalIndex(index, "")).toEqual([]);
    expect(index.filter((result) => result.kind === "course")).toHaveLength(1);
  });

  it("searches formal course, item, and material projections", () => {
    const index = buildGlobalSearchIndex(snapshot);
    expect(searchGlobalIndex(index, "MGT3001")[0]).toMatchObject({
      title: "组织行为学",
      target: "academic"
    });
    expect(searchGlobalIndex(index, "案例分析")[0]?.target).toBe("schedule");
    expect(searchGlobalIndex(index, "第一讲")[0]?.target).toBe("materials");
  });
});
