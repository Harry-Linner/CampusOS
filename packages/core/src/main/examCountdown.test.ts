import { describe, expect, it } from "vitest";
import type { CalendarEventsData, CapabilityRecord } from "@campusos/shared";
import { computeExamCountdowns } from "@campusos/plugin-academic";

const records: CapabilityRecord<CalendarEventsData>[] = [{
  capability: "calendar.events@1",
  providerId: "org.campusos.academic-exams",
  accountId: "account-1",
  state: "live",
  updatedAt: "2026-08-01T00:00:00.000Z",
  data: {
    feedId: "academic-exams",
    sourceId: "academic-affairs",
    sourceLabel: "Academic affairs",
    sourceUpdatedAt: "2026-08-01T00:00:00.000Z",
    upstreamCapability: "academic.exams@1",
    upstreamProviderId: "org.campusos.zju-undergraduate",
    upstreamProviderIds: ["org.campusos.zju-undergraduate"],
    accountScoped: true,
    supportedKinds: ["exam"],
    totalItems: 2,
    omittedItems: 0,
    events: [
      {
        id: "exam-upcoming",
        originId: "exam-upcoming",
        originCapability: "academic.exams@1",
        sourceId: "academic-affairs",
        kind: "exam",
        title: "Upcoming exam",
        startAt: "2026-08-04T06:00:00.000Z",
        endAt: "2026-08-04T08:00:00.000Z",
        timezone: "Asia/Shanghai",
        location: "Room 101",
        courseName: "Course A",
        note: null
      },
      {
        id: "exam-past",
        originId: "exam-past",
        originCapability: "academic.exams@1",
        sourceId: "academic-affairs",
        kind: "exam",
        title: "Past exam",
        startAt: "2026-07-31T06:00:00.000Z",
        endAt: "2026-07-31T08:00:00.000Z",
        timezone: "Asia/Shanghai",
        location: null,
        courseName: null,
        note: null
      }
    ]
  }
}];

describe("exam countdown projection", () => {
  it("recomputes remaining hours from the supplied current time", () => {
    const first = computeExamCountdowns(records, new Date("2026-08-01T08:00:00.000Z"));
    const later = computeExamCountdowns(records, new Date("2026-08-01T09:00:00.000Z"));

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ daysUntil: 2, hoursUntil: 22, isUrgent: true });
    expect(later[0]).toMatchObject({ daysUntil: 2, hoursUntil: 21, isUrgent: true });
  });
});
