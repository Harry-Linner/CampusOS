import { describe, expect, it } from "vitest";
import {
  createE2eFixtureDeadlineEvents,
  createE2eFixtureTimetableEvents,
  createFixtureCalendar
} from "./e2eFixtureSources";

const HOUR_IN_MS_FOR_TEST = 60 * 60 * 1000;

describe("E2E fixture events", () => {
  it("projects the fixture timetable through the real rules on fixed 2026 dates", async () => {
    const [{ deriveTimetableCalendarEvents }, { ZJU_ACADEMIC_TERM_RULES }] = await Promise.all([
      import("@campusos/plugin-academic-timetable-events/main"),
      import("@campusos/plugin-zju-calendar-config/main")
    ]);
    const timetableEvents = createE2eFixtureTimetableEvents(
      new Date("2026-08-05T04:00:00.000Z"),
      deriveTimetableCalendarEvents,
      createFixtureCalendar(ZJU_ACADEMIC_TERM_RULES)
    );
    const dates = timetableEvents.events.map((event) => event.startAt.slice(0, 10)).sort();

    // fixture 课程：2026 秋学期、周一、第 1–4 周 → 09-14、09-21、09-28，10-05 落在国庆假期被移除。
    expect(dates).toEqual(["2026-09-14", "2026-09-21", "2026-09-28"]);
    expect(timetableEvents.supportedKinds).toEqual(["course"]);
    expect(timetableEvents.omittedItems).toBe(0);
  });

  it("keeps the deadline fixture inside the next 48 hours so it stays visible", () => {
    const now = new Date("2040-12-31T23:30:00.000Z");
    const deadlineEvents = createE2eFixtureDeadlineEvents(now);

    expect(deadlineEvents.events[0]?.startAt).toBe("2041-01-02T01:30:00.000Z");

    for (const event of deadlineEvents.events) {
      const offset = Date.parse(event.startAt) - now.getTime();
      expect(offset).toBeGreaterThan(0);
      expect(offset).toBeLessThanOrEqual(48 * HOUR_IN_MS_FOR_TEST);
    }
  });
});
