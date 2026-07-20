import { describe, expect, it } from "vitest";
import {
  buildReminderQueue,
  createDefaultCampusAdapterContext,
  loadCampusWorkspace
} from "./campusWorkspace";

describe("loadCampusWorkspace", () => {
  it("aggregates source fixtures without fabricating download-task state", async () => {
    const snapshot = await loadCampusWorkspace(
      createDefaultCampusAdapterContext(new Date("2026-07-12T01:00:00.000Z"), {
        "academic-affairs": {
          configured: true,
          username: "3250100001",
          savedAt: "2026-07-11T10:00:00.000Z"
        }
      })
    );

    expect(snapshot.sourceStates).toHaveLength(4);
    expect(snapshot.summary.totalSources).toBe(4);
    expect(snapshot.summary.readySources).toBeGreaterThanOrEqual(3);
    expect(snapshot.todayCourses.length).toBeGreaterThan(0);
    expect(snapshot.downloads).toEqual([]);
    expect(snapshot.reminders.length).toBeGreaterThan(0);
    expect(
      snapshot.sourceStates.find((source) => source.sourceId === "academic-affairs")
    ).toMatchObject({
      connectionState: "connected",
      configuredUsername: "3250100001"
    });
  });

  it("marks academic affairs as needing credentials when no account is configured", async () => {
    const snapshot = await loadCampusWorkspace(
      createDefaultCampusAdapterContext(new Date("2026-07-12T01:00:00.000Z"))
    );

    const academicSource = snapshot.sourceStates.find(
      (source) => source.sourceId === "academic-affairs"
    );

    expect(academicSource).toMatchObject({
      status: "planned",
      connectionState: "needs-credentials",
      actionLabel: "前往设置页保存教务账号",
      configuredUsername: null
    });
    expect(
      snapshot.todayCourses.some((course) => course.sourceId === "academic-affairs")
    ).toBe(false);
  });

  it("derives campus-college mock timestamps from the adapter context", async () => {
    const now = new Date("2026-07-12T01:00:00.000Z");
    const snapshot = await loadCampusWorkspace(
      createDefaultCampusAdapterContext(now)
    );
    const workshop = snapshot.courses.find(
      (course) => course.id === "course-software-engineering-workshop"
    );
    const compilerDeadline = snapshot.deadlines.find(
      (deadline) => deadline.id === "cs-assignment-compiler"
    );
    const mobileDeadline = snapshot.deadlines.find(
      (deadline) => deadline.id === "mock-mobile-lab-report"
    );

    expect(workshop).toBeDefined();
    expect(compilerDeadline).toBeDefined();
    expect(mobileDeadline).toBeDefined();
    const workshopStart = new Date(workshop!.startAt);

    const compilerDueAt = new Date(compilerDeadline!.dueAt);
    const mobileDueAt = new Date(mobileDeadline!.dueAt);

    expect(workshopStart.getTime()).toBe(now.getTime() + 90 * 60 * 1000);
    expect(compilerDueAt.getTime()).toBe(workshopStart.getTime() + 5 * 60 * 1000);
    expect(mobileDueAt.getTime()).toBe(workshopStart.getTime() + 30 * 60 * 1000);
  });
});

describe("buildReminderQueue", () => {
  it("sorts future reminders chronologically and skips past fire times", () => {
    const reminders = buildReminderQueue(
      [
        {
          id: "course-a",
          title: "Course A",
          sourceId: "academic-affairs",
          startAt: "2026-07-12T03:00:00.000Z",
          endAt: "2026-07-12T04:00:00.000Z",
          location: "Room 101"
        }
      ],
      [
        {
          id: "deadline-a",
          title: "Deadline A",
          sourceId: "eta-platform",
          dueAt: "2026-07-12T08:00:00.000Z",
          kind: "workflow",
          priority: "important"
        }
      ],
      [15, 120],
      "2026-07-12T01:00:00.000Z"
    );

    expect(reminders.map((item) => item.id)).toEqual([
      "course-a-lead-15",
      "deadline-a-lead-120",
      "deadline-a-lead-15"
    ]);
  });
});
