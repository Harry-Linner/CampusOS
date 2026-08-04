import { describe, expect, it } from "vitest";
import type {
  AcademicCalendarConfigData,
  AcademicTimetableData,
  AcademicTimetableSessionContext,
  CapabilityRecord
} from "@campusos/shared";
import { mergeAcademicTimetableSessions } from "@campusos/shared";
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
  it("uses course ids before names when merging repeated timetable sessions", () => {
    const base: Omit<AcademicTimetableSessionContext, "session"> = {
      providerId: "provider",
      academicYearStart: 2026,
      semesterNumber: 1
    };
    const sessions = mergeAcademicTimetableSessions([
      {
        ...base,
        session: {
          sourceId: "one",
          courseId: "course-a",
          courseName: "同名课程",
          teacher: "teacher",
          location: "room",
          dayOfWeek: 1,
          periods: [1],
          firstHalf: true,
          secondHalf: false,
          weekPattern: "all",
          confirmed: true
        }
      },
      {
        ...base,
        session: {
          sourceId: "two",
          courseId: "course-b",
          courseName: "同名课程",
          teacher: "teacher",
          location: "room",
          dayOfWeek: 1,
          periods: [2],
          firstHalf: true,
          secondHalf: false,
          weekPattern: "all",
          confirmed: true
        }
      }
    ]);

    expect(sessions).toHaveLength(2);
  });

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
    // The first-half calendar window contains eight teaching Mondays.
    expect(result.totalItems).toBe(8);
    expect(result.omittedItems).toBe(0);
    expect(result.events).toHaveLength(8);

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

  it("projects only the next autumn-winter semester outside teaching periods", () => {
    const historicalSession = {
      ...timetableRecord.data!.terms[0].sessions[0],
      sourceId: "historical-session",
      courseName: "历史学期课程"
    };
    const autumnSession = {
      ...timetableRecord.data!.terms[0].sessions[0],
      sourceId: "autumn-session",
      courseName: "秋学期课程"
    };
    const winterSession = {
      ...timetableRecord.data!.terms[0].sessions[0],
      sourceId: "winter-session",
      courseName: "冬学期课程"
    };
    const multiSemesterRecord: CapabilityRecord<AcademicTimetableData> = {
      ...timetableRecord,
      data: {
        terms: [
          {
            academicYearStart: 2025,
            season: "2|夏",
            state: "live",
            sessions: [historicalSession]
          },
          {
            academicYearStart: 2026,
            season: "1|秋",
            state: "live",
            sessions: [autumnSession]
          },
          {
            academicYearStart: 2026,
            season: "1|冬",
            state: "live",
            sessions: [winterSession]
          }
        ]
      }
    };
    const multiSemesterCalendar: AcademicCalendarConfigData = {
      ...calendarConfig,
      quarters: [
        {
          academicYearStart: 2025,
          season: "2|夏",
          startDate: "2026-04-27",
          classesBeginDate: "2026-04-27",
          endDate: "2026-07-05"
        },
        ...calendarConfig.quarters
      ]
    };

    const result = deriveTimetableCalendarEvents(
      [multiSemesterRecord],
      multiSemesterCalendar,
      "2026-07-28T04:00:00.000Z"
    );
    const titles = new Set(result.events.map((event) => event.title));

    expect(titles).toEqual(new Set(["秋学期课程", "冬学期课程"]));
  });

  it("deduplicates a full autumn-winter timetable and bounds each half by the calendar", () => {
    const sharedSession = {
      ...timetableRecord.data!.terms[0].sessions[0],
      sourceId: "autumn-copy",
      firstHalf: true,
      secondHalf: true
    };
    const duplicatedRecord: CapabilityRecord<AcademicTimetableData> = {
      ...timetableRecord,
      data: {
        terms: [
          {
            academicYearStart: 2026,
            season: "1|秋",
            state: "live",
            sessions: [sharedSession]
          },
          {
            academicYearStart: 2026,
            season: "1|冬",
            state: "live",
            sessions: [{ ...sharedSession, sourceId: "winter-copy" }]
          }
        ]
      }
    };

    const result = deriveTimetableCalendarEvents(
      [duplicatedRecord],
      calendarConfig,
      "2026-07-28T04:00:00.000Z"
    );
    const dates = result.events.map((event) => event.startAt.slice(0, 10));

    expect(dates).toHaveLength(18);
    expect(new Set(result.events.map((event) => event.id)).size).toBe(18);
    expect(dates.filter((date) => date === "2026-11-09")).toHaveLength(1);
    expect(dates.at(-1)).toBe("2027-01-11");
    expect(dates.every((date) => date <= "2027-01-15")).toBe(true);
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

    // Odd weeks within the eight-week first-half window.
    expect(result.events).toHaveLength(4);
    // First event is week 1
    expect(result.events[0].startAt).toBe("2026-09-14T08:00:00+08:00");
    // Second event is week 3 (skipped week 2)
    expect(result.events[1].startAt).toBe("2026-09-28T08:00:00+08:00");
  });

  it("continues Celechron custom repeats after week 16", () => {
    const extendedCalendar: AcademicCalendarConfigData = {
      ...calendarConfig,
      quarters: calendarConfig.quarters.map((quarter) =>
        quarter.season === "1|冬"
          ? { ...quarter, endDate: "2027-01-03" }
          : quarter
      )
    };
    const customWeekRecord: CapabilityRecord<AcademicTimetableData> = {
      ...timetableRecord,
      data: {
        terms: [{
          academicYearStart: 2026,
          season: "1|秋",
          state: "live",
          sessions: [{
            ...timetableRecord.data!.terms[0].sessions[0],
            sourceId: "custom-week-17",
            weeks: [17, 18, 19]
          }]
        }]
      }
    };

    const result = deriveTimetableCalendarEvents(
      [customWeekRecord],
      extendedCalendar,
      "2026-07-19T12:00:00.000Z"
    );

    expect(result.events.map((event) => event.startAt)).toEqual([
      "2027-01-04T08:00:00+08:00",
      "2027-01-11T08:00:00+08:00",
      "2027-01-18T08:00:00+08:00"
    ]);
  });

  it("omits unconfirmed sessions and short custom repeats like Celechron", () => {
    const result = deriveTimetableCalendarEvents(
      [{
        ...timetableRecord,
        data: {
          terms: [{
            ...timetableRecord.data!.terms[0],
            sessions: [
              { ...timetableRecord.data!.terms[0].sessions[0], confirmed: false },
              { ...timetableRecord.data!.terms[0].sessions[0], sourceId: "short-custom", weeks: [1, 2] }
            ]
          }]
        }
      }],
      calendarConfig,
      "2026-07-19T12:00:00.000Z"
    );

    expect(result.events).toHaveLength(0);
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

    expect(result.omittedItems).toBe(8);
    expect(result.events).toHaveLength(0);
  });
});
