import { describe, expect, it } from "vitest";
import {
  createE2eFixtureDeadlineEvents,
  createE2eFixtureTimetableEvents
} from "./e2eFixtureSources";

const HOUR_IN_MS_FOR_TEST = 60 * 60 * 1000;

describe("E2E fixture event clock", () => {
  it("keeps visible course and deadline events inside the next 48 hours", () => {
    const now = new Date("2040-12-31T23:30:00.000Z");
    const timetableEvents = createE2eFixtureTimetableEvents(now);
    const deadlineEvents = createE2eFixtureDeadlineEvents(now);

    expect(timetableEvents.sourceUpdatedAt).toBe(now.toISOString());
    expect(timetableEvents.events[0]).toMatchObject({
      startAt: "2041-01-01T00:30:00.000Z",
      endAt: "2041-01-01T01:30:00.000Z"
    });
    expect(deadlineEvents.events[0]?.startAt).toBe(
      "2041-01-02T01:30:00.000Z"
    );

    for (const event of [
      ...timetableEvents.events,
      ...deadlineEvents.events
    ]) {
      const offset = Date.parse(event.startAt) - now.getTime();
      expect(offset).toBeGreaterThan(0);
      expect(offset).toBeLessThanOrEqual(48 * HOUR_IN_MS_FOR_TEST);
    }
  });
});
