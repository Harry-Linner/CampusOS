import { describe, expect, it } from "vitest";
import type {
  CalendarEventsData,
  CapabilityRecord,
  CampusWorkspaceSnapshot
} from "@campusos/shared";
import {
  createEmptyWorkspaceSnapshot,
  createLiveWorkspaceSnapshot,
  findCalendarEventRecords,
  mergeAcademicCalendarIntoWorkspace,
  mergeCalendarEventsIntoWorkspace,
  mergeLearningMaterialsIntoWorkspace,
  pruneWorkspaceDeadlinesBeforeToday
} from "./campusWorkspaceCapabilities";

const createSnapshot = (): CampusWorkspaceSnapshot => ({
  generatedAt: "2026-07-19T04:00:00.000Z",
  term: {
    label: "2026-2027 秋学期",
    phase: "mock",
    currentWeek: 12,
    progressPercent: 56
  },
  sourceStates: [
    {
      sourceId: "academic-affairs",
      label: "教务处网站",
      status: "ready",
      connectionState: "connected",
      lastSyncedAt: "2026-07-19T03:00:00.000Z",
      itemCount: 1,
      summary: "mock",
      configuredUsername: "3240100001"
    }
  ],
  courses: [],
  todayCourses: [],
  deadlines: [
    {
      id: "exam-seat-confirmation",
      title: "mock 考试",
      dueAt: "2026-07-20T10:00:00.000Z",
      sourceId: "academic-affairs",
      kind: "exam",
      priority: "important"
    }
  ],
  materials: [],
  downloads: [],
  reminders: [],
  summary: {
    readySources: 1,
    totalSources: 1,
    downloadsInFlight: 0,
    materialsReady: 0,
    remindersQueued: 0,
    deadlinesDueSoon: 1
  }
});

const examEventsData: CalendarEventsData = {
    feedId: "academic-exams",
    sourceId: "academic-affairs",
    sourceLabel: "教务处网站",
    sourceUpdatedAt: "2026-07-19T04:04:00.000Z",
    upstreamCapability: "academic.exams@1",
    upstreamProviderId: "org.campusos.zju-undergraduate",
    upstreamProviderIds: ["org.campusos.zju-undergraduate"],
    accountScoped: true,
    supportedKinds: ["exam"],
    totalItems: 2,
    omittedItems: 1,
    events: [
      {
        id: "org.campusos.academic-exams:concrete-final",
        originId: "concrete-final",
        originCapability: "academic.exams@1",
        sourceId: "academic-affairs",
        kind: "exam",
        title: "真实课程期末考试",
        startAt: "2026-07-20T09:00:00+08:00",
        endAt: "2026-07-20T11:00:00+08:00",
        timezone: "Asia/Shanghai",
        location: "紫金港东1A-101",
        courseName: "真实课程",
        note: "考试时间：2026年7月20日 09:00-11:00；座位：18"
      }
    ]
};

const examEventsRecord: CapabilityRecord<CalendarEventsData> = {
  capability: "calendar.events@1",
  providerId: "org.campusos.academic-exams",
  accountId: "3240100001",
  state: "live",
  updatedAt: "2026-07-19T04:05:00.000Z",
  data: examEventsData
};

const learningEventsData: CalendarEventsData = {
    feedId: "learning-assignments",
    sourceId: "learning-platform",
    sourceLabel: "学在浙大",
    sourceUpdatedAt: "2026-07-19T04:05:00.000Z",
    upstreamCapability: "learning.assignments@1",
    upstreamProviderId: "org.campusos.zju-learning",
    upstreamProviderIds: ["org.campusos.zju-learning"],
    accountScoped: true,
    supportedKinds: ["assignment"],
    totalItems: 2,
    omittedItems: 1,
    events: [
      {
        id: "org.campusos.deadline-assistant:assignment-1",
        originId: "assignment-1",
        originCapability: "learning.assignments@1",
        sourceId: "learning-platform",
        kind: "assignment",
        title: "提交课程报告",
        startAt: "2026-07-20T12:00:00.000Z",
        endAt: null,
        timezone: "Asia/Shanghai",
        location: null,
        courseName: "软件工程",
        note: "同步自学在浙大。"
      }
    ]
};

const learningEventsRecord: CapabilityRecord<CalendarEventsData> = {
  capability: "calendar.events@1",
  providerId: "org.campusos.deadline-assistant",
  accountId: "3240100001",
  state: "live",
  updatedAt: "2026-07-19T04:06:00.000Z",
  data: learningEventsData
};

describe("workspace capability integration", () => {
  it("keeps an unverified workspace empty and marks authenticated sources unavailable", () => {
    const snapshot = createEmptyWorkspaceSnapshot({
      generatedAt: "2026-08-05T04:00:00.000Z"
    });

    expect(snapshot.courses).toEqual([]);
    expect(snapshot.deadlines).toEqual([]);
    expect(snapshot.materials).toEqual([]);
    expect(snapshot.term.phase).toBe("unavailable");
    expect(snapshot.sourceStates).toContainEqual(
      expect.objectContaining({
        sourceId: "academic-affairs",
        status: "planned",
        connectionState: "needs-credentials",
        configuredUsername: null
      })
    );
    expect(snapshot.sourceStates).not.toContainEqual(
      expect.objectContaining({ summary: expect.stringContaining("mock") })
    );
  });

  it("starts verified accounts from an empty live snapshot instead of mock courses", () => {
    const snapshot = createLiveWorkspaceSnapshot({
      generatedAt: "2026-07-19T04:00:00.000Z",
      accountId: "3240100001"
    });

    expect(snapshot.courses).toEqual([]);
    expect(snapshot.deadlines).toEqual([]);
    expect(snapshot.sourceStates).toContainEqual(
      expect.objectContaining({
        sourceId: "academic-affairs",
        connectionState: "connected",
        configuredUsername: "3240100001",
        summary: expect.stringContaining("真实数据源")
      })
    );
    expect(snapshot.sourceStates).not.toContainEqual(
      expect.objectContaining({ summary: expect.stringContaining("mock") })
    );
  });

  it("fills a verified account workspace only from capability events", () => {
    const snapshot = mergeCalendarEventsIntoWorkspace(
      createLiveWorkspaceSnapshot({
        generatedAt: "2026-07-19T04:00:00.000Z",
        accountId: "3240100001"
      }),
      [examEventsRecord],
      [15]
    );

    expect(snapshot.courses).toEqual([]);
    expect(snapshot.deadlines).toEqual([
      expect.objectContaining({
        id: "org.campusos.academic-exams:concrete-final",
        title: "真实课程期末考试"
      })
    ]);
    expect(snapshot.deadlines).not.toContainEqual(
      expect.objectContaining({ id: "exam-seat-confirmation" })
    );
  });

  it("derives upcoming and active terms from the official Shanghai calendar", () => {
    const calendarRecord = {
      capability: "academic.calendar-config@1" as const,
      providerId: "org.campusos.zju-calendar-config",
      accountId: null,
      state: "live" as const,
      updatedAt: "2026-07-19T04:05:00.000Z",
      data: {
        timezone: "Asia/Shanghai" as const,
        sourceUrl: "https://www.zju.edu.cn/english/19600/list.htm",
        quarters: [
          {
            academicYearStart: 2026,
            season: "1|秋" as const,
            startDate: "2026-09-11",
            classesBeginDate: "2026-09-14",
            endDate: "2026-11-15"
          }
        ],
        periodTimes: [{ period: 1, start: "08:00", end: "08:45" }]
      }
    };

    expect(
      mergeAcademicCalendarIntoWorkspace(createSnapshot(), calendarRecord).term
    ).toEqual({
      label: "2026-2027 秋学期",
      phase: "upcoming",
      currentWeek: null,
      progressPercent: 0
    });

    const activeSnapshot = createSnapshot();
    activeSnapshot.generatedAt = "2026-09-21T04:00:00.000Z";
    expect(
      mergeAcademicCalendarIntoWorkspace(activeSnapshot, calendarRecord).term
    ).toEqual(
      expect.objectContaining({
        phase: "active",
        currentWeek: 2
      })
    );

    const fullSemesterRecord = {
      ...calendarRecord,
      data: {
        ...calendarRecord.data,
        quarters: [
          ...calendarRecord.data.quarters,
          {
            academicYearStart: 2026,
            season: "1|\u51ac" as const,
            startDate: "2026-11-09",
            classesBeginDate: "2026-11-09",
            endDate: "2027-01-15"
          }
        ]
      }
    };
    expect(
      mergeAcademicCalendarIntoWorkspace(createSnapshot(), fullSemesterRecord).term.label
    ).toBe("2026-2027 \u79cb\u51ac\u5b66\u671f");
  });

  it("keeps the spring-summer term active during the 小学期 fallback window", () => {
    const calendarRecord = {
      capability: "academic.calendar-config@1" as const,
      providerId: "org.campusos.zju-calendar-config",
      accountId: null,
      state: "live" as const,
      updatedAt: "2026-07-19T04:05:00.000Z",
      data: {
        timezone: "Asia/Shanghai" as const,
        sourceUrl: "https://www.zju.edu.cn/english/19600/list.htm",
        quarters: [
          {
            academicYearStart: 2025,
            season: "2|夏" as const,
            startDate: "2026-04-27",
            classesBeginDate: "2026-04-27",
            endDate: "2026-07-05"
          },
          {
            academicYearStart: 2026,
            season: "1|秋" as const,
            startDate: "2026-09-11",
            classesBeginDate: "2026-09-14",
            endDate: "2026-11-15"
          }
        ],
        periodTimes: [{ period: 1, start: "08:00", end: "08:45" }]
      }
    };

    const insideFallback = createSnapshot();
    insideFallback.generatedAt = "2026-07-28T04:00:00.000Z";
    expect(
      mergeAcademicCalendarIntoWorkspace(insideFallback, calendarRecord).term
    ).toEqual({
      label: "2025-2026 夏学期",
      phase: "active",
      currentWeek: null,
      progressPercent: 0
    });

    const outsideFallback = createSnapshot();
    outsideFallback.generatedAt = "2026-08-30T04:00:00.000Z";
    expect(
      mergeAcademicCalendarIntoWorkspace(outsideFallback, calendarRecord).term
    ).toEqual({
      label: "2026-2027 秋学期",
      phase: "upcoming",
      currentWeek: null,
      progressPercent: 0
    });
  });

  it("selects one record per active provider without leaking another account", () => {
    expect(
      findCalendarEventRecords(
        [examEventsRecord, learningEventsRecord],
        [examEventsRecord.providerId, learningEventsRecord.providerId],
        "3240100001"
      )
    ).toEqual([examEventsRecord, learningEventsRecord]);
    expect(
      findCalendarEventRecords(
        [examEventsRecord],
        [examEventsRecord.providerId],
        "3240109999"
      )
    ).toEqual([]);

    const unavailableRecord: CapabilityRecord<CalendarEventsData> = {
      ...examEventsRecord,
      accountId: null,
      state: "unavailable",
      message: "统一认证已断开。",
      data: {
        ...examEventsData,
        totalItems: 0,
        omittedItems: 0,
        events: []
      }
    };
    expect(
      findCalendarEventRecords(
        [examEventsRecord, unavailableRecord],
        [examEventsRecord.providerId],
        null
      )
    ).toEqual([unavailableRecord]);
  });

  it("replaces mock exams through the generic event feed without inventing dates", () => {
    const snapshot = mergeCalendarEventsIntoWorkspace(
      createSnapshot(),
      [examEventsRecord],
      [15]
    );

    expect(snapshot.deadlines).toHaveLength(1);
    expect(snapshot.deadlines[0]).toEqual(
      expect.objectContaining({
        id: "org.campusos.academic-exams:concrete-final",
        title: "真实课程期末考试",
        dueAt: "2026-07-20T09:00:00+08:00",
        kind: "exam",
        note: expect.stringContaining("座位：18")
      })
    );
    expect(snapshot.sourceStates[0].summary).toContain(
      "另有 1 项没有可信绝对时间，未写入日历"
    );
    expect(snapshot.reminders).toHaveLength(1);
  });

  it("removes mock exams when the event provider reports unavailable", () => {
    const snapshot = mergeCalendarEventsIntoWorkspace(
      createSnapshot(),
      [
        {
          ...examEventsRecord,
          accountId: null,
          state: "unavailable",
          message: "统一认证已失效。",
          data: {
            ...examEventsData,
            totalItems: 0,
            omittedItems: 0,
            events: []
          }
        }
      ],
      [15]
    );

    expect(snapshot.deadlines).toEqual([]);
    expect(snapshot.sourceStates[0]).toEqual(
      expect.objectContaining({
        status: "partial",
        connectionState: "needs-credentials",
        summary: expect.stringContaining("统一认证已失效。"),
        actionLabel: "先在设置页连接统一身份认证"
      })
    );
  });

  it("combines independent event providers and preserves source boundaries", () => {
    const snapshot = mergeCalendarEventsIntoWorkspace(
      createSnapshot(),
      [examEventsRecord, learningEventsRecord],
      [15]
    );

    expect(snapshot.deadlines).toHaveLength(2);
    expect(snapshot.deadlines).toContainEqual(
      expect.objectContaining({
        id: "org.campusos.deadline-assistant:assignment-1",
        title: "提交课程报告",
        sourceId: "learning-platform",
        kind: "assignment",
        courseName: "软件工程"
      })
    );
    expect(snapshot.sourceStates).toContainEqual(
      expect.objectContaining({
        sourceId: "learning-platform",
        label: "学在浙大",
        status: "ready",
        itemCount: 2,
        summary: expect.stringContaining(
          "另有 1 项没有可信绝对时间，未写入日历"
        )
      })
    );
  });

  it("excludes deadlines before today while retaining deadlines from today", () => {
    const boundaryRecord: CapabilityRecord<CalendarEventsData> = {
      ...learningEventsRecord,
      data: {
        ...learningEventsData,
        totalItems: 2,
        omittedItems: 0,
        events: [
          {
            ...learningEventsData.events[0],
            id: "assignment-yesterday",
            originId: "assignment-yesterday",
            startAt: "2026-07-18T23:00:00+08:00"
          },
          {
            ...learningEventsData.events[0],
            id: "assignment-today",
            originId: "assignment-today",
            startAt: "2026-07-19T08:00:00+08:00"
          }
        ]
      }
    };

    const snapshot = mergeCalendarEventsIntoWorkspace(
      createSnapshot(),
      [boundaryRecord],
      [15]
    );

    expect(
      snapshot.deadlines
        .filter((deadline) => deadline.sourceId === "learning-platform")
        .map((deadline) => deadline.id)
    ).toEqual(["assignment-today"]);
  });

  it("prunes expired deadlines and reminders from a hydrated snapshot", () => {
    const staleSnapshot = createSnapshot();
    staleSnapshot.deadlines = [
      {
        id: "expired",
        title: "已过期",
        dueAt: "2026-07-27T23:59:00+08:00",
        sourceId: "learning-platform",
        kind: "assignment",
        priority: "important"
      },
      {
        id: "today",
        title: "今天截止",
        dueAt: "2026-07-28T08:00:00+08:00",
        sourceId: "learning-platform",
        kind: "assignment",
        priority: "important"
      },
      {
        id: "future",
        title: "未来截止",
        dueAt: "2026-07-29T08:00:00+08:00",
        sourceId: "learning-platform",
        kind: "assignment",
        priority: "important"
      }
    ];
    staleSnapshot.reminders = [
      {
        id: "expired-lead-15",
        title: "旧提醒",
        kind: "deadline",
        sourceId: "learning-platform",
        fireAt: "2026-07-27T15:44:00.000Z",
        eventStartAt: "2026-07-27T15:59:00.000Z",
        leadMinutes: 15
      }
    ];

    const snapshot = pruneWorkspaceDeadlinesBeforeToday(
      staleSnapshot,
      "2026-07-28T04:00:00.000Z",
      [15]
    );

    expect(snapshot.deadlines.map((deadline) => deadline.id)).toEqual([
      "today",
      "future"
    ]);
    expect(snapshot.reminders.map((reminder) => reminder.id)).toEqual([
      "future-lead-15"
    ]);
    expect(snapshot.summary.remindersQueued).toBe(1);
  });

  it("replaces a changed assignment deadline and rebuilds its reminder", () => {
    const initial = mergeCalendarEventsIntoWorkspace(
      createLiveWorkspaceSnapshot({
        generatedAt: "2026-07-19T04:00:00.000Z",
        accountId: "3240100001"
      }),
      [learningEventsRecord],
      [60]
    );
    const changedRecord: CapabilityRecord<CalendarEventsData> = {
      ...learningEventsRecord,
      updatedAt: "2026-07-19T05:00:00.000Z",
      data: {
        ...learningEventsData,
        sourceUpdatedAt: "2026-07-19T05:00:00.000Z",
        events: learningEventsData.events.map((event) => ({
          ...event,
          startAt: "2026-07-22T14:00:00.000Z"
        }))
      }
    };
    const refreshed = mergeCalendarEventsIntoWorkspace(
      initial,
      [changedRecord],
      [60]
    );

    expect(refreshed.deadlines).toEqual([
      expect.objectContaining({
        id: "org.campusos.deadline-assistant:assignment-1",
        dueAt: "2026-07-22T14:00:00.000Z"
      })
    ]);
    expect(refreshed.reminders).toEqual([
      expect.objectContaining({
        id: "org.campusos.deadline-assistant:assignment-1-lead-60",
        fireAt: "2026-07-22T13:00:00.000Z",
        eventStartAt: "2026-07-22T14:00:00.000Z"
      })
    ]);
  });

  it("does not accumulate upstream item totals across repeated refreshes", () => {
    const initial = mergeCalendarEventsIntoWorkspace(
      createLiveWorkspaceSnapshot({
        generatedAt: "2026-07-19T04:00:00.000Z",
        accountId: "3240100001"
      }),
      [learningEventsRecord],
      [60]
    );
    const refreshed = mergeCalendarEventsIntoWorkspace(
      initial,
      [learningEventsRecord],
      [60]
    );

    expect(initial.sourceStates.find((source) => source.sourceId === "learning-platform")?.itemCount).toBe(2);
    expect(refreshed.sourceStates.find((source) => source.sourceId === "learning-platform")?.itemCount).toBe(2);
  });

  it("removes an assignment and its reminders when the live source removes it", () => {
    const initial = mergeCalendarEventsIntoWorkspace(
      createLiveWorkspaceSnapshot({
        generatedAt: "2026-07-19T04:00:00.000Z",
        accountId: "3240100001"
      }),
      [learningEventsRecord],
      [60]
    );
    const emptyRecord: CapabilityRecord<CalendarEventsData> = {
      ...learningEventsRecord,
      updatedAt: "2026-07-19T05:00:00.000Z",
      data: {
        ...learningEventsData,
        sourceUpdatedAt: "2026-07-19T05:00:00.000Z",
        totalItems: 0,
        omittedItems: 0,
        events: []
      }
    };
    const refreshed = mergeCalendarEventsIntoWorkspace(
      initial,
      [emptyRecord],
      [60]
    );

    expect(refreshed.deadlines).toEqual([]);
    expect(refreshed.reminders).toEqual([]);
  });

  it("rejects event times without an explicit timezone", () => {
    const unsafeRecord: CapabilityRecord<CalendarEventsData> = {
      ...learningEventsRecord,
      data: {
        ...learningEventsData,
        totalItems: 1,
        omittedItems: 0,
        events: [
          {
            ...learningEventsData.events[0],
            startAt: "2026-07-20T12:00:00"
          }
        ]
      }
    };

    const snapshot = mergeCalendarEventsIntoWorkspace(
      createSnapshot(),
      [unsafeRecord],
      [15]
    );

    expect(snapshot.deadlines.some((deadline) => deadline.sourceId === "learning-platform"))
      .toBe(false);
    expect(
      snapshot.sourceStates.find(
        (source) => source.sourceId === "learning-platform"
      )?.summary
    ).toContain("另有 1 项没有可信绝对时间");
  });

  it("replaces the material list from a complete learning snapshot", () => {
    const base = createSnapshot();
    base.materials = [{
      id: "old",
      title: "旧课件.pdf",
      courseName: "旧课程",
      semester: "旧学期",
      sourceId: "learning-platform",
      updatedAt: "2026-07-18T00:00:00.000Z"
    }];
    const refreshed = mergeLearningMaterialsIntoWorkspace(base, {
      capability: "learning.materials@1",
      providerId: "org.campusos.zju-learning",
      accountId: "3240100001",
      state: "live",
      updatedAt: "2026-07-20T09:00:00.000Z",
      data: {
        courses: [],
        materials: [{
          sourceId: "1:100",
          uploadId: "10",
          referenceId: "100",
          fileName: "新课件.pdf",
          courseId: "1",
          courseName: "课程一",
          semesterName: "2025-2026春夏",
          size: 1024,
          updatedAt: "2026-07-20T08:00:00.000Z",
          downloadUrl: "https://courses.zju.edu.cn/api/uploads/reference/100/blob",
          downloadFallbackUrl: "https://courses.zju.edu.cn/api/uploads/10/blob"
        }]
      }
    });

    expect(refreshed.materials).toEqual([
      expect.objectContaining({
        id: "1:100",
        title: "新课件.pdf",
        downloadUrl: "https://courses.zju.edu.cn/api/uploads/reference/100/blob",
        downloadFallbackUrl: "https://courses.zju.edu.cn/api/uploads/10/blob"
      })
    ]);
    expect(refreshed.summary.materialsReady).toBe(1);
  });

  it("uses only 2025-2026 spring-summer materials as the development download source", () => {
    const material = {
      sourceId: "1:100",
      uploadId: "10",
      referenceId: "100",
      fileName: "fixture.pdf",
      courseId: "1",
      courseName: "fixture course",
      semesterName: "2025-2026春夏",
      size: 1024,
      updatedAt: "2026-07-20T08:00:00.000Z",
      downloadUrl: "https://courses.zju.edu.cn/api/uploads/reference/100/blob",
      downloadFallbackUrl: "https://courses.zju.edu.cn/api/uploads/10/blob"
    };
    const refreshed = mergeLearningMaterialsIntoWorkspace(createSnapshot(), {
      capability: "learning.materials@1",
      providerId: "org.campusos.zju-learning",
      accountId: "account-fixture",
      state: "live",
      updatedAt: "2026-07-20T09:00:00.000Z",
      data: {
        courses: [
          {
            sourceId: "course-target",
            name: "target course",
            academicYearId: "2025-2026",
            semesterId: "spring-summer",
            semesterName: "2025-2026春夏"
          },
          {
            sourceId: "course-outside",
            name: "outside course",
            academicYearId: "2024-2025",
            semesterId: "spring-summer",
            semesterName: "2024-2025春夏"
          }
        ],
        materials: [
          material,
          { ...material, sourceId: "2:200", semesterName: "2025-2026春" },
          { ...material, sourceId: "3:300", semesterName: "2025-2026短" },
          { ...material, sourceId: "4:400", semesterName: "2024-2025春夏" }
        ]
      }
    });

    expect(refreshed.materials.map((item) => item.id)).toEqual(["1:100", "2:200"]);
    expect(refreshed.materialCourses).toEqual([
      {
        id: "course-target",
        name: "target course",
        semester: "2025-2026春夏"
      }
    ]);
    expect(refreshed.summary.materialsReady).toBe(2);
  });
});
