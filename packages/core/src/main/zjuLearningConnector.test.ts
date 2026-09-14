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

  it("derives assignments from per-course homework activities when the todo list is empty", async () => {
    // `/api/todos` 只含未完成待办：待办为空时，逐课 activities 里的作业必须仍然发布。
    const publish = vi.fn(async () => undefined);
    const connector = createZjuLearningConnector({
      loadAcademicProfileProof: async () => ({ studentId: "3240100001" }),
      fetchAssignments: async () => ({ ok: true, body: '{"todo_list":[]}' }),
      fetchSemesters: async () => ({ ok: true, body: '{"semesters":[]}' }),
      fetchCoursesPage: async () => ({
        ok: true,
        body: JSON.stringify({
          pages: 1,
          courses: [{ id: 99477, name: "短学期课程", academic_year_id: 12, semester_id: 34 }]
        })
      }),
      fetchCourseActivities: async () => ({
        ok: true,
        body: JSON.stringify({
          activities: [
            { id: 501, type: "homework", title: "第一次作业", end_time: "2026-07-20 20:00:00", uploads: null },
            { id: 502, type: "material", title: "课件", end_time: null, uploads: null }
          ]
        })
      }),
      loadCachedAssignments: async () => null,
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

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      capability: "learning.assignments@1",
      accountId: "3240100001",
      state: "live",
      data: {
        assignments: [{
          sourceId: "501",
          title: "第一次作业",
          courseName: "短学期课程",
          dueAt: "2026-07-20T12:00:00.000Z",
          description: null,
          attachments: [],
          upstreamUpdatedAt: null
        }]
      }
    }));
  });

  it("keeps one assignment per homework and takes the deadline from the later fetch", async () => {
    // 老师改过 DDL 时上游会返回同名作业的两条记录：必须归并成一条，并取较晚的那次。
    const publish = vi.fn(async (input: unknown) => {
      void input;
    });
    const connector = createZjuLearningConnector({
      loadAcademicProfileProof: async () => ({ studentId: "3240100001" }),
      fetchAssignments: async () => ({ ok: true, body: '{"todo_list":[]}' }),
      fetchSemesters: async () => ({ ok: true, body: '{"semesters":[]}' }),
      fetchCoursesPage: async () => ({
        ok: true,
        body: JSON.stringify({
          pages: 1,
          courses: [{ id: 99477, name: "短学期课程", academic_year_id: 12, semester_id: 34 }]
        })
      }),
      fetchCourseActivities: async () => ({
        ok: true,
        body: JSON.stringify({
          activities: [
            { id: 501, type: "homework", title: "hw1", end_time: "2026-07-10 20:00:00", updated_at: "2026-07-01T00:00:00Z", uploads: null },
            { id: 502, type: "homework", title: "hw1", end_time: "2026-07-20 20:00:00", updated_at: "2026-07-05T00:00:00Z", uploads: null }
          ]
        })
      }),
      loadCachedAssignments: async () => null,
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

    const published = publish.mock.calls
      .map(([input]) => input as { capability: string; data: { assignments: unknown[] } | null })
      .find((input) => input.capability === "learning.assignments@1");
    expect(published?.data?.assignments).toEqual([{
      sourceId: "501",
      title: "hw1",
      courseName: "短学期课程",
      dueAt: "2026-07-20T12:00:00.000Z",
      description: null,
      attachments: [],
      upstreamUpdatedAt: "2026-07-05T00:00:00Z"
    }]);
  });

  it("strips the description HTML with a real parser and keeps literal angle brackets", async () => {
    const publish = vi.fn(async (input: unknown) => {
      void input;
    });
    const connector = createZjuLearningConnector({
      loadAcademicProfileProof: async () => ({ studentId: "3240100001" }),
      fetchAssignments: async () => ({ ok: true, body: '{"todo_list":[]}' }),
      fetchSemesters: async () => ({ ok: true, body: '{"semesters":[]}' }),
      fetchCoursesPage: async () => ({
        ok: true,
        body: JSON.stringify({
          pages: 1,
          courses: [{ id: 99477, name: "短学期课程", academic_year_id: 12, semester_id: 34 }]
        })
      }),
      fetchCourseActivities: async () => ({
        ok: true,
        body: JSON.stringify({
          activities: [{
            id: 601,
            type: "homework",
            title: "hw1",
            end_time: "2026-07-20 20:00:00",
            description: "<p>第一行<br>第二行</p><p>比较 1 &lt; 2 &amp; 3 &gt; 2</p><script>alert(1)</script>",
            uploads: [
              { id: 1, name: "题面.pdf" },
              { id: 2, name: "模板.docx" },
              { id: 3, name: "" }
            ]
          }]
        })
      }),
      loadCachedAssignments: async () => null,
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

    const published = publish.mock.calls
      .map(([input]) => input as { capability: string; data: { assignments: Array<{ description: string | null; attachments: string[] }> } | null })
      .find((input) => input.capability === "learning.assignments@1");
    const assignment = published?.data?.assignments[0];

    // 标签被解析掉、块级元素与 <br> 变成换行；实体解码后字面量 < > 必须保留。
    expect(assignment?.description).toBe(
      "第一行\n第二行\n比较 1 < 2 & 3 > 2"
    );
    expect(assignment?.attachments).toEqual(["题面.pdf", "模板.docx"]);
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

  it("keeps the sanitized failing activity index when materials fall back to cache", async () => {
    const publish = vi.fn(async () => undefined);
    let refreshJob: (() => Promise<{
      status: string;
      message?: string;
    }>) | null = null;
    const connector = createZjuLearningConnector({
      loadAcademicProfileProof: async () => ({ studentId: "3240100001" }),
      fetchAssignments: async () => ({ ok: true, body: '{"todo_list":[]}' }),
      fetchSemesters: async () => ({
        ok: true,
        body: '{"semesters":[{"id":34,"name":"春夏学期"}]}'
      }),
      fetchCoursesPage: async () => ({
        ok: true,
        body: '{"courses":[{"id":71,"name":"私有课程甲","semester_id":34},{"id":72,"name":"私有课程乙","semester_id":34}],"pages":1}'
      }),
      fetchCourseActivities: async (courseId) => courseId === "71"
        ? { ok: true, body: '{"activities":[]}' }
        : { ok: false, message: "连接学习平台超时。" },
      loadCachedAssignments: async () => null,
      loadCachedMaterials: async () => ({ courses: [], materials: [] }),
      publish,
      registerRefreshJob: (_sourceId, job) => {
        refreshJob = job;
        return () => undefined;
      },
      now: () => new Date("2026-07-20T09:00:00.000Z")
    });

    await connector.activate({
      pluginId: connector.manifest.id,
      grantedPermissions: connector.manifest.permissions,
      bindings: {}
    });

    const materialPublication = (publish.mock.calls as unknown as Array<[{
      capability: string;
      state: string;
      message?: string;
    }]>)
      .map(([publication]) => publication)
      .find((publication) => publication.capability === "learning.materials@1");
    expect(materialPublication).toEqual(expect.objectContaining({
      state: "cache",
      message: expect.stringContaining("第 2 个课程课件请求失败：连接学习平台超时。")
    }));
    expect(materialPublication?.message).not.toContain("私有课程");
    expect(materialPublication?.message).not.toMatch(/\b7[12]\b/);
    expect(refreshJob).not.toBeNull();
    await expect(refreshJob!()).resolves.toEqual(expect.objectContaining({
      status: "cache",
      message: expect.stringContaining("第 2 个课程课件请求失败：连接学习平台超时。")
    }));
  });
});
