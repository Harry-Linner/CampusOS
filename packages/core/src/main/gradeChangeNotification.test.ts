import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AcademicGradesData, CapabilityRecord } from "@campusos/shared";
import { createDatabaseService } from "./databaseService";
import { processGradeChangeNotification } from "./gradeChangeNotification";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

const gradeRecord = (
  accountId: string,
  grades: AcademicGradesData["grades"]
): CapabilityRecord<AcademicGradesData> => ({
  capability: "academic.grades@1",
  providerId: "org.campusos.zju-undergraduate",
  accountId,
  state: "live",
  updatedAt: "2026-08-05T08:00:00.000Z",
  data: { grades }
});

describe("grade change notifications", () => {
  it("announces the first trusted refresh and establishes an account baseline", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-grade-notification-"));
    temporaryDirectories.push(storageRoot);
    const database = createDatabaseService({
      databasePath: join(storageRoot, "campusos.sqlite")
    });
    const notify = vi.fn();

    try {
      const result = await processGradeChangeNotification({
        accountId: "account-a",
        connectorStatus: "live",
        gradeRecord: gradeRecord("account-a", [{
          sourceId: "attempt-a",
          courseCode: "COURSE-A",
          courseName: "Course A",
          credit: 3,
          originalScore: "90",
          gradePoint: 4.5,
          academicYearStart: 2025,
          termNumber: 2,
          isMajorCourse: true,
          courseCategory: null
        }]),
        enabled: true,
        database,
        notify,
        now: new Date("2026-08-05T08:01:00.000Z")
      });

      expect(result).toBe("baseline-created");
      expect(notify).toHaveBeenCalledWith({
        title: "首次成绩推送",
        body: "若有新出分的课程，CampusOS 将会通知你。可在设置中关闭此功能。"
      });
      expect(database.loadAcademicGradeNotificationBaseline("account-a"))
        .toEqual({
          fivePointGpa: 4.5,
          gradedCourseCount: 1,
          fused: true,
          savedAt: "2026-08-05T08:01:00.000Z"
        });
    } finally {
      database.close();
    }
  });

  it("sends a generic notification when the five-point GPA changes", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-grade-notification-"));
    temporaryDirectories.push(storageRoot);
    const database = createDatabaseService({
      databasePath: join(storageRoot, "campusos.sqlite")
    });
    const notify = vi.fn();
    const privateCourseName = "Private Course Name";

    try {
      await processGradeChangeNotification({
        accountId: "account-a",
        connectorStatus: "live",
        gradeRecord: gradeRecord("account-a", [{
          sourceId: "attempt-a",
          courseCode: "PRIVATE-CODE",
          courseName: privateCourseName,
          credit: 3,
          originalScore: "80",
          gradePoint: 3.5,
          academicYearStart: 2025,
          termNumber: 2,
          isMajorCourse: true,
          courseCategory: null
        }]),
        enabled: true,
        database,
        notify,
        now: new Date("2026-08-05T08:01:00.000Z")
      });
      notify.mockClear();

      const result = await processGradeChangeNotification({
        accountId: "account-a",
        connectorStatus: "live",
        gradeRecord: gradeRecord("account-a", [{
          sourceId: "attempt-a",
          courseCode: "PRIVATE-CODE",
          courseName: privateCourseName,
          credit: 3,
          originalScore: "90",
          gradePoint: 4.5,
          academicYearStart: 2025,
          termNumber: 2,
          isMajorCourse: true,
          courseCategory: null
        }]),
        enabled: true,
        database,
        notify,
        now: new Date("2026-08-05T08:02:00.000Z")
      });

      expect(result).toBe("change-notified");
      expect(notify).toHaveBeenCalledWith({
        title: "成绩变动提醒",
        body: "有新出分的课程，可在 CampusOS 的学业页面中刷新查看。"
      });
      expect(JSON.stringify(notify.mock.calls)).not.toContain(privateCourseName);
      expect(JSON.stringify(notify.mock.calls)).not.toContain("PRIVATE-CODE");
      expect(JSON.stringify(notify.mock.calls)).not.toContain("90");
      expect(database.loadAcademicGradeNotificationBaseline("account-a"))
        .toMatchObject({
          fivePointGpa: 4.5,
          gradedCourseCount: 1,
          savedAt: "2026-08-05T08:02:00.000Z"
        });
    } finally {
      database.close();
    }
  });

  it("notifies when the raw graded course count changes without a GPA change", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-grade-notification-"));
    temporaryDirectories.push(storageRoot);
    const database = createDatabaseService({
      databasePath: join(storageRoot, "campusos.sqlite")
    });
    const notify = vi.fn();
    const grade = (sourceId: string): AcademicGradesData["grades"][number] => ({
      sourceId,
      courseCode: sourceId,
      courseName: sourceId,
      credit: 2,
      originalScore: "90",
      gradePoint: 4.5,
      academicYearStart: 2025,
      termNumber: 2,
      isMajorCourse: true,
      courseCategory: null
    });

    try {
      await processGradeChangeNotification({
        accountId: "account-a",
        connectorStatus: "live",
        gradeRecord: gradeRecord("account-a", [grade("attempt-a")]),
        enabled: true,
        database,
        notify
      });
      notify.mockClear();

      const result = await processGradeChangeNotification({
        accountId: "account-a",
        connectorStatus: "live",
        gradeRecord: gradeRecord("account-a", [
          grade("attempt-a"),
          grade("attempt-b")
        ]),
        enabled: true,
        database,
        notify
      });

      expect(result).toBe("change-notified");
      expect(notify).toHaveBeenCalledOnce();
      expect(database.loadAcademicGradeNotificationBaseline("account-a"))
        .toMatchObject({ fivePointGpa: 4.5, gradedCourseCount: 2 });
    } finally {
      database.close();
    }
  });

  it("does not notify for an unchanged trusted refresh but advances the baseline time", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-grade-notification-"));
    temporaryDirectories.push(storageRoot);
    const database = createDatabaseService({
      databasePath: join(storageRoot, "campusos.sqlite")
    });
    const notify = vi.fn();
    const record = gradeRecord("account-a", []);

    try {
      await processGradeChangeNotification({
        accountId: "account-a",
        connectorStatus: "live",
        gradeRecord: record,
        enabled: true,
        database,
        notify,
        now: new Date("2026-08-05T08:01:00.000Z")
      });
      notify.mockClear();

      const result = await processGradeChangeNotification({
        accountId: "account-a",
        connectorStatus: "live",
        gradeRecord: record,
        enabled: true,
        database,
        notify,
        now: new Date("2026-08-05T08:02:00.000Z")
      });

      expect(result).toBe("unchanged");
      expect(notify).not.toHaveBeenCalled();
      expect(database.loadAcademicGradeNotificationBaseline("account-a"))
        .toMatchObject({ savedAt: "2026-08-05T08:02:00.000Z" });
    } finally {
      database.close();
    }
  });

  it("does not establish or advance a baseline while grade notifications are disabled", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-grade-notification-"));
    temporaryDirectories.push(storageRoot);
    const database = createDatabaseService({
      databasePath: join(storageRoot, "campusos.sqlite")
    });
    const notify = vi.fn();

    try {
      const result = await processGradeChangeNotification({
        accountId: "account-a",
        connectorStatus: "live",
        gradeRecord: gradeRecord("account-a", []),
        enabled: false,
        database,
        notify,
        now: new Date("2026-08-05T08:01:00.000Z")
      });

      expect(result).toBe("skipped");
      expect(notify).not.toHaveBeenCalled();
      expect(database.loadAcademicGradeNotificationBaseline("account-a"))
        .toBeNull();
    } finally {
      database.close();
    }
  });

  it("skips cache and degraded refreshes even when a grade payload is present", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-grade-notification-"));
    temporaryDirectories.push(storageRoot);
    const database = createDatabaseService({
      databasePath: join(storageRoot, "campusos.sqlite")
    });
    const notify = vi.fn();
    const liveRecord = gradeRecord("account-a", []);

    try {
      const degradedResult = await processGradeChangeNotification({
        accountId: "account-a",
        connectorStatus: "fallback",
        gradeRecord: liveRecord,
        enabled: true,
        database,
        notify
      });
      const cachedResult = await processGradeChangeNotification({
        accountId: "account-a",
        connectorStatus: "live",
        gradeRecord: { ...liveRecord, state: "cache" },
        enabled: true,
        database,
        notify
      });
      const unavailableResult = await processGradeChangeNotification({
        accountId: "account-a",
        connectorStatus: "live",
        gradeRecord: null,
        enabled: true,
        database,
        notify
      });

      expect(degradedResult).toBe("skipped");
      expect(cachedResult).toBe("skipped");
      expect(unavailableResult).toBe("skipped");
      expect(notify).not.toHaveBeenCalled();
      expect(database.loadAcademicGradeNotificationBaseline("account-a"))
        .toBeNull();
    } finally {
      database.close();
    }
  });

  it("keeps notification baselines isolated between accounts", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-grade-notification-"));
    temporaryDirectories.push(storageRoot);
    const database = createDatabaseService({
      databasePath: join(storageRoot, "campusos.sqlite")
    });
    const notify = vi.fn();

    try {
      await processGradeChangeNotification({
        accountId: "account-a",
        connectorStatus: "live",
        gradeRecord: gradeRecord("account-a", []),
        enabled: true,
        database,
        notify
      });
      notify.mockClear();

      const result = await processGradeChangeNotification({
        accountId: "account-b",
        connectorStatus: "live",
        gradeRecord: gradeRecord("account-b", []),
        enabled: true,
        database,
        notify
      });

      expect(result).toBe("baseline-created");
      expect(notify).toHaveBeenCalledOnce();
      expect(database.loadAcademicGradeNotificationBaseline("account-a"))
        .not.toBeNull();
      expect(database.loadAcademicGradeNotificationBaseline("account-b"))
        .not.toBeNull();
    } finally {
      database.close();
    }
  });

  it("uses the account's Celechron repeated-course strategy for the GPA baseline", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-grade-notification-"));
    temporaryDirectories.push(storageRoot);
    const database = createDatabaseService({
      databasePath: join(storageRoot, "campusos.sqlite")
    });

    try {
      database.saveAcademicGpaStrategy(
        "account-a",
        "first",
        "2026-08-05T08:00:00.000Z"
      );
      await processGradeChangeNotification({
        accountId: "account-a",
        connectorStatus: "live",
        gradeRecord: gradeRecord("account-a", [{
          sourceId: "attempt-a",
          realId: "repeated-course",
          courseCode: "REPEAT",
          courseName: "First attempt",
          credit: 3,
          originalScore: "60",
          gradePoint: 1,
          academicYearStart: 2024,
          termNumber: 1,
          isMajorCourse: true,
          courseCategory: null
        }, {
          sourceId: "attempt-b",
          realId: "repeated-course",
          courseCode: "REPEAT",
          courseName: "Second attempt",
          credit: 3,
          originalScore: "90",
          gradePoint: 4.5,
          academicYearStart: 2025,
          termNumber: 1,
          isMajorCourse: true,
          courseCategory: null
        }]),
        enabled: true,
        database,
        notify: vi.fn()
      });

      expect(database.loadAcademicGradeNotificationBaseline("account-a"))
        .toMatchObject({ fivePointGpa: 1, gradedCourseCount: 2 });
    } finally {
      database.close();
    }
  });
});
