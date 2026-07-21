import { describe, expect, it, vi } from "vitest";
import type {
  AcademicExamsData,
  CapabilityRecord,
  LearningAssignmentsData
} from "@campusos/shared";
import {
  createAcademicExamsFeature,
  deriveAcademicExamEvents
} from "@campusos/plugin-academic-exams/main";
import { manifest as academicExamsManifest } from "@campusos/plugin-academic-exams/manifest";
import {
  createDeadlineAssistant,
  deriveDeadlineEvents
} from "@campusos/plugin-deadline-assistant/main";
import { manifest as deadlineAssistantManifest } from "@campusos/plugin-deadline-assistant/manifest";

const examRecord: CapabilityRecord<AcademicExamsData> = {
  capability: "academic.exams@1",
  providerId: "org.campusos.zju-undergraduate",
  accountId: "3240100001",
  state: "live",
  updatedAt: "2026-07-19T04:00:00.000Z",
  data: {
    exams: [
      {
        sourceId: "exam-1",
        courseId: "COURSE-1",
        courseName: "软件工程",
        kind: "final",
        scheduleText: "2026年7月20日 09:00-11:00",
        startAt: "2026-07-20T09:00:00+08:00",
        endAt: "2026-07-20T11:00:00+08:00",
        dateLabel: null,
        location: "紫金港东1A-101",
        seat: "18"
      },
      {
        sourceId: "exam-relative",
        courseId: "COURSE-2",
        courseName: "数据结构",
        kind: "midterm",
        scheduleText: "考试周第 3 天",
        startAt: null,
        endAt: null,
        dateLabel: "考试周第 3 天",
        location: null,
        seat: null
      }
    ]
  }
};

const assignmentRecord: CapabilityRecord<LearningAssignmentsData> = {
  capability: "learning.assignments@1",
  providerId: "org.campusos.zju-learning",
  accountId: "3240100001",
  state: "cache",
  updatedAt: "2026-07-19T04:01:00.000Z",
  data: {
    assignments: [
      {
        sourceId: "assignment-1",
        title: "提交课程报告",
        courseName: "软件工程",
        dueAt: "2026-07-20T12:00:00.000Z"
      },
      {
        sourceId: "assignment-undated",
        title: "阅读资料",
        courseName: "数据结构",
        dueAt: null
      }
    ]
  }
};

describe("academic calendar event plugins", () => {
  it("derives only concrete exams and records their upstream provenance", () => {
    const feed = deriveAcademicExamEvents(
      [examRecord],
      "2026-07-19T04:02:00.000Z"
    );

    expect(feed).toEqual(
      expect.objectContaining({
        upstreamCapability: "academic.exams@1",
        upstreamProviderId: "org.campusos.zju-undergraduate",
        upstreamProviderIds: ["org.campusos.zju-undergraduate"],
        totalItems: 2,
        omittedItems: 1
      })
    );
    expect(feed.events).toEqual([
      expect.objectContaining({
        id: "org.campusos.academic-exams:org.campusos.zju-undergraduate:exam-1",
        originId: "exam-1",
        kind: "exam",
        timezone: "Asia/Shanghai"
      })
    ]);
  });

  it("combines exams from multiple academic providers without ID collisions", () => {
    const graduateRecord: CapabilityRecord<AcademicExamsData> = {
      ...examRecord,
      providerId: "org.campusos.zju-graduate",
      data: {
        exams: examRecord.data?.exams.slice(0, 1).map((exam) => ({
          ...exam,
          sourceId: "exam-1",
          courseName: "研究生课程"
        })) ?? []
      }
    };

    const feed = deriveAcademicExamEvents(
      [examRecord, graduateRecord],
      "2026-07-19T04:02:00.000Z"
    );

    expect(feed.upstreamProviderId).toBeNull();
    expect(feed.upstreamProviderIds).toEqual([
      "org.campusos.zju-undergraduate",
      "org.campusos.zju-graduate"
    ]);
    expect(feed.events).toHaveLength(2);
    expect(new Set(feed.events.map((event) => event.id)).size).toBe(2);
  });

  it("derives only assignments with a concrete deadline", () => {
    const feed = deriveDeadlineEvents(
      assignmentRecord,
      "2026-07-19T04:02:00.000Z"
    );

    expect(feed.totalItems).toBe(2);
    expect(feed.omittedItems).toBe(1);
    expect(feed.events).toEqual([
      expect.objectContaining({
        id: "org.campusos.deadline-assistant:assignment-1",
        originCapability: "learning.assignments@1",
        startAt: "2026-07-20T12:00:00.000Z"
      })
    ]);
  });

  it("registers the exam event refresh after the undergraduate source", async () => {
    const publish = vi.fn(async () => undefined);
    const unregister = vi.fn();
    const registerRefreshJob = vi.fn(() => unregister);
    const feature = createAcademicExamsFeature({
      loadExamsRecords: async () => [examRecord],
      publish,
      registerRefreshJob,
      now: () => new Date("2026-07-19T04:02:00.000Z")
    });

    const activation = await feature.activate({
      pluginId: academicExamsManifest.id,
      grantedPermissions: [...academicExamsManifest.permissions],
      bindings: {
        "academic.exams@1": "org.campusos.zju-undergraduate",
        "core.refresh@1": "core",
        "core.provenance-store@1": "core"
      }
    });

    expect(registerRefreshJob).toHaveBeenCalledWith(
      academicExamsManifest.id,
      expect.any(Function),
      { after: ["org.campusos.zju-undergraduate"] }
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "calendar.events@1",
        accountId: "3240100001",
        state: "live"
      })
    );
    activation.deactivate();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("registers DDL event refresh after the learning source", async () => {
    const publish = vi.fn(async () => undefined);
    const unregister = vi.fn();
    const registerRefreshJob = vi.fn(() => unregister);
    const feature = createDeadlineAssistant({
      loadAssignmentsRecord: async () => assignmentRecord,
      publish,
      registerRefreshJob,
      now: () => new Date("2026-07-19T04:02:00.000Z")
    });

    const activation = await feature.activate({
      pluginId: deadlineAssistantManifest.id,
      grantedPermissions: [...deadlineAssistantManifest.permissions],
      bindings: {
        "learning.assignments@1": "org.campusos.zju-learning",
        "core.refresh@1": "core",
        "core.provenance-store@1": "core"
      }
    });

    expect(registerRefreshJob).toHaveBeenCalledWith(
      deadlineAssistantManifest.id,
      expect.any(Function),
      { after: ["org.campusos.zju-learning"] }
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "calendar.events@1",
        accountId: "3240100001",
        state: "cache"
      })
    );
    activation.deactivate();
    expect(unregister).toHaveBeenCalledTimes(1);
  });
});
