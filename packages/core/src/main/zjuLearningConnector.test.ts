import { describe, expect, it, vi } from "vitest";
import {
  createZjuLearningConnector,
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
      loadCachedAssignments: async () => cached,
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
});
