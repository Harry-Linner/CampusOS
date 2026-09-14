import { describe, expect, it } from "vitest";
import {
  addDays,
  buildMonthDays,
  dayKey,
  formatDateTime,
  formatTimeRange,
  fromShanghaiParts,
  getShanghaiDayNumber,
  getShanghaiWeekday,
  groupEventsByDay,
  lunarOf,
  monthKey,
  naturalWeekNumber,
  startOfDay,
  startOfWeek,
  toDateInput,
  weekdayLabels
} from "./deskCalendarDates";

describe("Shanghai calendar dates", () => {
  it("keys a UTC instant by its Shanghai calendar day", () => {
    // 20:00Z is already the next day in Asia/Shanghai.
    expect(toDateInput(new Date("2026-09-11T20:00:00.000Z"))).toBe("2026-09-12");
    // 15:59Z is 23:59 Shanghai, 16:00Z is midnight Shanghai: the day boundary.
    expect(dayKey("2026-09-11T15:59:00.000Z")).toBe("2026-09-11");
    expect(dayKey("2026-09-11T16:00:00.000Z")).toBe("2026-09-12");
    expect(monthKey("2026-09-11T20:00:00.000Z")).toBe("2026-09");
  });

  it("round-trips Shanghai wall-clock parts and normalises to midnight", () => {
    expect(toDateInput(fromShanghaiParts(2026, 9, 12, 8, 30))).toBe("2026-09-12");
    expect(startOfDay(new Date("2026-09-11T20:00:00.000Z")).toISOString()).toBe("2026-09-11T16:00:00.000Z");
    expect(addDays(startOfDay(fromShanghaiParts(2026, 9, 12)), 1).toISOString()).toBe("2026-09-12T16:00:00.000Z");
  });

  it("starts weeks on Monday and numbers them by ISO week", () => {
    expect(getShanghaiWeekday(fromShanghaiParts(2026, 9, 12))).toBe(6); // Saturday
    expect(toDateInput(startOfWeek(fromShanghaiParts(2026, 9, 12)))).toBe("2026-09-07"); // Monday
    expect(getShanghaiDayNumber(fromShanghaiParts(2026, 9, 12))).toBe(12);
    expect(naturalWeekNumber(fromShanghaiParts(2026, 1, 1))).toBe(1);
    expect(naturalWeekNumber(fromShanghaiParts(2026, 9, 7))).toBe(37);
  });

  it("builds a six-week Monday-first month grid covering the whole month", () => {
    const days = buildMonthDays(fromShanghaiParts(2026, 9, 1));
    expect(days).toHaveLength(42);
    expect(weekdayLabels).toHaveLength(7);
    expect(toDateInput(days[0])).toBe("2026-08-31");
    expect(toDateInput(days[41])).toBe("2026-10-11");
    expect(days.some((day) => toDateInput(day) === "2026-09-30")).toBe(true);
  });

  it("formats same-day and cross-day ranges, and absolute timestamps", () => {
    expect(formatTimeRange("2026-09-12T01:00:00.000Z", "2026-09-12T02:30:00.000Z")).toBe("9:00 - 10:30");
    expect(formatTimeRange("2026-09-12T15:00:00.000Z", "2026-09-13T01:00:00.000Z")).toBe("9/12 23:00 - 9/13 9:00");
    expect(formatDateTime("2026-09-12T01:00:00.000Z")).toBe("9月12日 9:00");
  });

  it("exposes lunar day, solar term and festival data for a date", () => {
    const lunar = lunarOf(2026, 9, 12);

    expect(lunar.day).toMatch(/^[初十廿一二三四五六七八九]+$/);
    expect(Array.isArray(lunar.festivals)).toBe(true);
    expect(Array.isArray(lunar.yi)).toBe(true);
    expect(Array.isArray(lunar.ji)).toBe(true);
    expect(typeof lunar.jieqi).toBe("string");
  });
});

describe("grouping events by Shanghai day", () => {
  const range = { start: fromShanghaiParts(2026, 9, 7), end: fromShanghaiParts(2026, 9, 14) };

  it("expands a multi-day event onto every day it covers, clipped to the range", () => {
    const grouped = groupEventsByDay([
      { id: "a", startAt: "2026-09-08T01:00:00.000Z", endAt: "2026-09-10T03:00:00.000Z" }
    ], range);

    expect([...grouped.keys()].sort()).toEqual(["2026-09-08", "2026-09-09", "2026-09-10"]);
    expect(grouped.get("2026-09-09")?.map((event) => event.id)).toEqual(["a"]);
  });

  it("drops events outside the range and sorts each day by start time", () => {
    const grouped = groupEventsByDay([
      { id: "late", startAt: "2026-09-12T09:00:00.000Z", endAt: "2026-09-12T10:00:00.000Z" },
      { id: "early", startAt: "2026-09-12T01:00:00.000Z", endAt: "2026-09-12T02:00:00.000Z" },
      { id: "outside", startAt: "2026-09-20T01:00:00.000Z", endAt: "2026-09-20T02:00:00.000Z" }
    ], range);

    expect([...grouped.keys()]).toEqual(["2026-09-12"]);
    expect(grouped.get("2026-09-12")?.map((event) => event.id)).toEqual(["early", "late"]);
  });
});
