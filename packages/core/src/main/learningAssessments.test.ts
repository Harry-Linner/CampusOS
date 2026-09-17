import { describe, expect, it } from "vitest";
import { createZjuLearningConnector, parseLearningAssessments, parseLearningSubmissionStatus } from "@campusos/plugin-zju-learning/main";
import { deriveDeadlineEvents } from "@campusos/plugin-deadline-assistant/main";
import type { CapabilityRecord, LearningAssignmentsData } from "@campusos/shared";
import { createEmptyWorkspaceSnapshot, mergeCalendarEventsIntoWorkspace } from "./campusWorkspaceCapabilities";

const course = { sourceId: "9", name: "Fixture course", academicYearId: null, semesterId: null, semesterName: null };
const ok = (payload: unknown) => ({ ok: true as const, body: JSON.stringify(payload) });
describe("learning assessment refresh", () => {
  it("uses explicit submission state and retains published future quizzes", async () => {
    const publications: unknown[] = [];
    const connector = createZjuLearningConnector({
      loadAcademicProfileProof: async () => ({ studentId: "fixture-account" }),
      fetchSemesters: async () => ok({ semesters: [] }),
      fetchCoursesPage: async () => ok({ pages: 1, courses: [{ id: 9, name: course.name }] }),
      fetchAssignments: async () => ok({ todo_list: [{ id: 1, title: "Homework", course_name: course.name, is_student: true, end_time: "2026-09-20 10:00:00" }] }),
      fetchCourseActivities: async () => ok({ activities: [{ id: 1, type: "homework", title: "Homework", end_time: "2026-09-20 10:00:00" }] }),
      fetchCourseAssessment: async (_id, operation) => ok(operation === "homework-submissions" ? { homework_activities: [{ id: 1, status_code: "submitted" }] }
        : operation === "course-exams" ? { exams: [{ id: 1, title: "Quiz", published: true, start_time: "2026-09-19 10:00:00", end_time: "2026-09-19 11:00:00" }] }
        : operation === "submitted-exams" ? { exam_ids: [] } : { classrooms: [] }),
      loadCachedAssignments: async () => null, loadCachedMaterials: async () => null,
      publish: async publication => { publications.push(publication); }, registerRefreshJob: () => () => undefined,
      now: () => new Date("2026-09-17T00:00:00Z")
    });
    await connector.activate({ pluginId: connector.manifest.id, grantedPermissions: connector.manifest.permissions, bindings: {} });
    const data = publications.find((p: any) => p.capability === "learning.assignments@1") as CapabilityRecord<LearningAssignmentsData>;
    expect(data.state).toBe("live");
    expect(data.data?.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: "1", submissionStatus: "submitted" }),
      expect.objectContaining({ sourceId: "quiz:9:1", activityType: "quiz", submissionStatus: "pending" })
    ]));
    const events = deriveDeadlineEvents(data, "2026-09-17T00:00:00Z").events;
    expect(events[0].submissionStatus).toBe("submitted");
    expect(events.find(e => e.activityType === "quiz")?.startAt).toBe("2026-09-19T02:00:00.000Z");
    const projected = mergeCalendarEventsIntoWorkspace(createEmptyWorkspaceSnapshot({ generatedAt: "2026-09-17T00:00:00Z" }), [{
      capability: "calendar.events@1", providerId: "org.campusos.deadline-assistant", accountId: "fixture-account", state: "live", updatedAt: "2026-09-17T00:00:00Z",
      data: deriveDeadlineEvents(data, "2026-09-17T00:00:00Z")
    }], [60]);
    expect(projected.calendarEvents?.find(event => event.originId === "1")?.submissionStatus).toBe("submitted");
    expect(projected.deadlines).toHaveLength(1);
    expect(projected.deadlines[0].dueAt).toBe("2026-09-19T03:00:00.000Z");
    expect(projected.reminders.some(reminder => reminder.title.includes("Homework"))).toBe(false);
  });
  it("never infers submission from missing todos or unknown status codes", () => {
    const statuses = parseLearningSubmissionStatus(JSON.stringify({ homework_activities: [{ id: 1, status_code: "absent" }, { id: 2, status_code: "other" }] }));
    expect(statuses.get("1")).toBe("pending");
    expect(statuses.get("2")).toBe("unknown");
    expect(statuses.get("3")).toBeUndefined();
    expect(() => parseLearningSubmissionStatus("{}")).toThrow();
  });
  it("detects ongoing classroom interaction without inventing a deadline", () => {
    const items = parseLearningAssessments('{"exams":[]}', '{"exam_ids":[]}', JSON.stringify({ classrooms: [
      { id: 2, title: "Live interaction", status: "start", start_at: "2026-09-17T00:00:00Z" },
      { id: 3, title: "Finished", status: "finish" }
    ] }), course, "2026-09-17T00:10:00Z");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ activityType: "classroom", dueAt: null, submissionStatus: "unknown" });
  });
});
