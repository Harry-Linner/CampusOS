import { describe, expect, it, vi } from "vitest";
import {
  createZjuLearningConnector,
  parseLearningActivitiesResponse,
  parseLearningCoursesResponse,
  parseLearningAssignmentsResponse
} from "@campusos/plugin-zju-learning/main";

describe("zju learning connector", () => {
  it("isolates malformed and non-student todos without inventing due dates", () => {
    const data = parseLearningAssignmentsResponse(JSON.stringify({
      todo_list: [
        {
          id: 101,
          title: "第一次作业",
          course_name: "数据结构",
          end_time: "2026-07-20 20:00:00",
          is_student: true
        },
        {
          id: "102",
          title: "阅读材料",
          course_name: "软件工程",
          end_time: null,
          is_student: "1"
        },
        {
          id: "teacher-task",
          title: "批改作业",
          is_student: false
        },
        { title: "缺少 ID", is_student: true },
        "broken"
      ]
    }));

    expect(data.assignments).toEqual([
      {
        sourceId: "101",
        title: "第一次作业",
        courseName: "数据结构",
        dueAt: "2026-07-20T12:00:00.000Z"
      },
      {
        sourceId: "102",
        title: "阅读材料",
        courseName: "软件工程",
        dueAt: null
      }
    ]);
  });

  it("publishes cache when a malformed live response cannot be parsed", async () => {
    const cached = {
      assignments: [
        {
          sourceId: "cached-1",
          title: "缓存作业",
          courseName: "测试课程",
          dueAt: "2026-07-21T08:00:00.000Z"
        }
      ]
    };
    const publish = vi.fn(async () => undefined);
    const connector = createZjuLearningConnector({
      loadAcademicProfileProof: async () => ({ studentId: "3240100001" }),
      fetchAssignments: async () => ({ ok: true, body: "{}" }),
      fetchSemesters: async () => ({ ok: true, body: '{"semesters":[]}' }),
      fetchCoursesPage: async () => ({ ok: true, body: '{"courses":[],"pages":1}' }),
      fetchCourseActivities: async () => ({ ok: true, body: '{"activities":[]}' }),
      loadCachedAssignments: async () => cached,
      loadCachedMaterials: async () => null,
      publish,
      registerRefreshJob: () => () => undefined,
      now: () => new Date("2026-07-19T04:00:00.000Z")
    });

    await connector.activate({
      pluginId: connector.manifest.id,
      grantedPermissions: connector.manifest.permissions,
      bindings: {}
    });

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "learning.assignments@1",
        accountId: "3240100001",
        state: "cache",
        data: cached
      })
    );
  });

  it("parses the zju-learning-assistant course and activity upload contract", () => {
    const courses = parseLearningCoursesResponse(JSON.stringify({
      pages: 1,
      courses: [{
        id: 74393,
        name: "计算机网络",
        academic_year_id: 12,
        semester_id: 34
      }]
    }), new Map([["34", "2025-2026 秋冬学期"]]));
    const materials = parseLearningActivitiesResponse(JSON.stringify({
      activities: [
        {
          uploads: [{
            id: 908844,
            reference_id: 929150,
            name: "lecture-01.pdf",
            size: 2048,
            updated_at: "2026-07-20T08:00:00Z"
          }]
        },
        { uploads: null }
      ]
    }), courses.courses[0], "2026-07-20T09:00:00.000Z");

    expect(materials).toEqual([{
      sourceId: "74393:929150",
      uploadId: "908844",
      referenceId: "929150",
      fileName: "lecture-01.pdf",
      courseId: "74393",
      courseName: "计算机网络",
      semesterName: "2025-2026 秋冬学期",
      size: 2048,
      updatedAt: "2026-07-20T08:00:00.000Z",
      downloadUrl: "https://courses.zju.edu.cn/api/uploads/reference/929150/blob",
      downloadFallbackUrl: "https://courses.zju.edu.cn/api/uploads/908844/blob"
    }]);
  });

  it("accepts an empty first course page reported with zero pages", () => {
    expect(parseLearningCoursesResponse('{"courses":[],"pages":0}')).toEqual({
      courses: [],
      pages: 0
    });
  });

  it("refreshes every course before atomically publishing a material snapshot", async () => {
    const publish = vi.fn(async () => undefined);
    const connector = createZjuLearningConnector({
      loadAcademicProfileProof: async () => ({ studentId: "3240100001" }),
      fetchAssignments: async () => ({ ok: true, body: '{"todo_list":[]}' }),
      fetchSemesters: async () => ({
        ok: true,
        body: '{"semesters":[{"id":34,"name":"秋冬学期"}]}'
      }),
      fetchCoursesPage: async () => ({
        ok: true,
        body: '{"courses":[{"id":1,"name":"课程一","semester_id":34},{"id":2,"name":"课程二","semester_id":34}],"pages":1}'
      }),
      fetchCourseActivities: async (courseId) => ({
        ok: true,
        body: JSON.stringify({
          activities: [{ uploads: [{
            id: Number(courseId) * 10,
            reference_id: Number(courseId) * 100,
            name: `${courseId}.pdf`,
            size: 1000
          }] }]
        })
      }),
      loadCachedAssignments: async () => null,
      loadCachedMaterials: async () => null,
      publish,
      registerRefreshJob: () => () => undefined,
      now: () => new Date("2026-07-20T09:00:00.000Z")
    });

    await connector.activate({
      pluginId: connector.manifest.id,
      grantedPermissions: connector.manifest.permissions,
      bindings: {}
    });

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      capability: "learning.materials@1",
      state: "live",
      data: expect.objectContaining({
        materials: expect.arrayContaining([
          expect.objectContaining({ sourceId: "1:100" }),
          expect.objectContaining({ sourceId: "2:200" })
        ])
      })
    }));
  });

  it("refreshes materials even when assignments are unavailable without cache", async () => {
    const publish = vi.fn(async () => undefined);
    const connector = createZjuLearningConnector({
      loadAcademicProfileProof: async () => ({ studentId: "3240100001" }),
      fetchAssignments: async () => ({ ok: false, message: "todos unavailable" }),
      fetchSemesters: async () => ({
        ok: true,
        body: '{"semesters":[{"id":34,"name":"秋冬学期"}]}'
      }),
      fetchCoursesPage: async () => ({
        ok: true,
        body: '{"courses":[{"id":1,"name":"课程一","semester_id":34}],"pages":1}'
      }),
      fetchCourseActivities: async () => ({
        ok: true,
        body: '{"activities":[{"uploads":[]}]}'
      }),
      loadCachedAssignments: async () => null,
      loadCachedMaterials: async () => null,
      publish,
      registerRefreshJob: () => () => undefined,
      now: () => new Date("2026-07-20T09:00:00.000Z")
    });

    await connector.activate({
      pluginId: connector.manifest.id,
      grantedPermissions: connector.manifest.permissions,
      bindings: {}
    });

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      capability: "learning.assignments@1",
      state: "unavailable"
    }));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      capability: "learning.materials@1",
      state: "live"
    }));
  });
});
