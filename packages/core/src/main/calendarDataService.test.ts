import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  holidays: [] as { date: string; label: string }[],
  makeupDays: [] as { date: string; label: string }[],
  records: [] as unknown[]
}));

vi.mock("./academicCalendarStore", () => ({
  loadAcademicCalendarSettings: vi.fn(async () => ({
    statutoryHolidays: state.holidays,
    makeupDays: state.makeupDays
  }))
}));

vi.mock("./officialCapabilityRepository", () => ({
  getOfficialCapabilityRepository: () => ({
    read: vi.fn(async () => state.records)
  })
}));

import { loadUnifiedCalendarData } from "./calendarDataService";

beforeEach(() => {
  state.holidays = [];
  state.makeupDays = [];
  state.records = [];
});

describe("unified calendar data", () => {
  it("uses official class dates for academic weeks", async () => {
    state.records = [{
      data: {
        quarters: [{ classesBeginDate: "2026-09-07", endDate: "2026-09-27" }]
      }
    }];
    const result = await loadUnifiedCalendarData("2026-09-15");
    expect(result.weeks["2026-09-07"]).toBe(1);
    expect(result.weeks["2026-09-14"]).toBe(2);
    expect(result.currentWeek).toBe(2);
  });

  it("keeps user-maintained holiday and makeup overrides authoritative", async () => {
    state.holidays = [{ date: "2026-10-01", label: "自定义假期" }];
    state.makeupDays = [{ date: "2026-10-01", label: "用户补班说明" }];
    const result = await loadUnifiedCalendarData("2026-10-01");
    expect(result.holidays).toEqual([{ date: "2026-10-01", label: "补班", holiday: false }]);
  });

  it("fills dates outside the official calendar with Monday-based natural weeks", async () => {
    const result = await loadUnifiedCalendarData("2026-09-07", {
      startAt: "2026-09-07T00:00:00.000Z",
      endAt: "2026-09-09T00:00:00.000Z"
    });
    expect(result.weeks).toMatchObject({ "2026-09-07": 37, "2026-09-08": 37 });
    expect(result.currentWeek).toBe(37);
  });
});
