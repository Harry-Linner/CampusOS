import { describe, expect, it } from "vitest";
import type {
  AcademicCalendarConfigData,
  AcademicTimetableData,
  CapabilityRecord
} from "@campusos/shared";
import { deriveTimetableCalendarEvents } from "@campusos/plugin-academic-timetable-events/main";

const calendarConfig: AcademicCalendarConfigData = {
  timezone: "Asia/Shanghai",
  sourceUrl: "https://www.zju.edu.cn/english/19600/list.htm",
  quarters: [
    {
      academicYearStart: 2026,
      season: "1|秋",
      startDate: "2026-09-11",
      classesBeginDate: "2026-09-14",
      endDate: "2026-11-15"
    },
    {
      academicYearStart: 2026,
      season: "1|冬",
      startDate: "2026-11-09",
      classesBeginDate: "2026-11-09",
      endDate: "2027-01-15"
    }
  ],
  periodTimes: [
    { period: 1, start: "08:00", end: "08:45" },
    { period: 2, start: "08:50", end: "09:35" },
    { period: 3, start: "09:50", end: "10:35" }
  ]
};

const timetableRecord: CapabilityRecord<AcademicTimetableData> = {
  capability: "academic.timetable@1",
  providerId: "org.campusos.zju-undergraduate",
  accountId: "3240100001",
  state: "live",
  updatedAt: "2026-07-19T04:00:00.000Z",
  data: {
    terms: [
      {
        academicYearStart: 2026,
        season: "1|秋",
        state: "live",
        sessions: [
          {
            sourceId: "session-1",
            courseName: "高等数学",
            teacher: "张教授",
            location: "紫金港东1A-301",
            dayOfWeek: 1,
            periods: [1, 2],
            firstHalf: true,
            secondHalf: false,
            weekPattern: "all",
            confirmed: true
          }
        ]
      }
    ]
  }
};

describe("academic timetable events", () => {
  it("expands a weekly course session into concrete calendar events", () => {
    const generatedAt = "2026-07-19T12:00:00.000Z";
    const result = deriveTimetableCalendarEvents(
      [timetableRecord],
      calendarConfig,
      generatedAt
    );

    expect(result.feedId).toBe("timetable-events");
    expect(result.supportedKinds).toEqual(["course"]);
    expect(result.upstreamProviderIds).toEqual([
      "org.campusos.zju-undergraduate"
    ]);
    // 16 weeks × 1 session = 16 attempted, 16 produced
    expect(result.totalItems).toBe(16);
    expect(result.omittedItems).toBe(0);
    expect(result.events).toHaveLength(16);

    // Week 1 Monday: 2026-09-14 (classesBeginDate is a Monday)
    const week1Event = result.events[0];
    expect(week1Event).toBeDefined();
    expect(week1Event.title).toBe("高等数学");
    expect(week1Event.kind).toBe("course");
    expect(week1Event.startAt).toBe("2026-09-14T08:00:00+08:00");
    expect(week1Event.endAt).toBe("2026-09-14T09:35:00+08:00");
    expect(week1Event.location).toBe("紫金港东1A-301");

    // Week 2 Monday: 2026-09-21
    const week2Event = result.events[1];
    expect(week2Event.startAt).toBe("2026-09-21T08:00:00+08:00");
  });

  it("returns empty when no calendar config is available", () => {
    const result = deriveTimetableCalendarEvents(
      [timetableRecord],
      null,
      "2026-07-19T12:00:00.000Z"
    );

    expect(result.events).toHaveLength(0);
    expect(result.supportedKinds).toEqual(["course"]);
  });

  it("respects odd/even week patterns", () => {
    const oddWeekRecord: CapabilityRecord<AcademicTimetableData> = {
      ...timetableRecord,
      data: {
        terms: [
          {
            academicYearStart: 2026,
            season: "1|秋",
            state: "live",
            sessions: [
              {
                ...timetableRecord.data!.terms[0].sessions[0],
                sourceId: "odd-session",
                weekPattern: "odd"
              }
            ]
          }
        ]
      }
    };

    const result = deriveTimetableCalendarEvents(
      [oddWeekRecord],
      calendarConfig,
      "2026-07-19T12:00:00.000Z"
    );

    // Odd weeks only: 1, 3, 5, 7, 9, 11, 13, 15 = 8 events
    expect(result.events).toHaveLength(8);
    // First event is week 1
    expect(result.events[0].startAt).toBe("2026-09-14T08:00:00+08:00");
    // Second event is week 3 (skipped week 2)
    expect(result.events[1].startAt).toBe("2026-09-28T08:00:00+08:00");
  });

  it("omits sessions with no matching period times", () => {
    const noPeriodRecord: CapabilityRecord<AcademicTimetableData> = {
      ...timetableRecord,
      data: {
        terms: [
          {
            academicYearStart: 2026,
            season: "1|秋",
            state: "live",
            sessions: [
              {
                ...timetableRecord.data!.terms[0].sessions[0],
                sourceId: "bad-period",
                periods: [99] // No period time defined for period 99
              }
            ]
          }
        ]
      }
    };

    const result = deriveTimetableCalendarEvents(
      [noPeriodRecord],
      calendarConfig,
      "2026-07-19T12:00:00.000Z"
    );

    expect(result.omittedItems).toBe(16);
    expect(result.events).toHaveLength(0);
  });
});
