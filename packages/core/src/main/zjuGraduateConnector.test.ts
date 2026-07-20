import { describe, expect, it, vi } from "vitest";
import {
  createZjuGraduateConnector,
  parseGraduateExamsResponse,
  parseGraduateGradesResponse,
  parseGraduateTimetableResponse,
  type GraduateTermQuery
} from "@campusos/plugin-zju-graduate/main";

const timetableBody = JSON.stringify({
  success: true,
  result: {
    kcbMap: {
      "1": {
        "1": {
          pyKcbjSjddVOList: [
            {
              bjbh: "GRS1001-01",
              kcmc: "研究方法",
              xm: "教师甲",
              cdmc: "紫金港研究生楼101",
              pkxq: 13,
              zc: "1-8周（单）",
              xkzt: "1"
            }
          ]
        },
        "2": {
          pyKcbjSjddVOList: [
            {
              bjbh: "GRS1001-01",
              kcmc: "研究方法",
              xm: "教师甲",
              cdmc: "紫金港研究生楼101",
              pkxq: 13,
              zc: "1-8周（单）",
              xkzt: "1"
            }
          ]
        }
      }
    }
  }
});

const examsBody = JSON.stringify({
  success: true,
  result: {
    records: [
      {
        id: "graduate-exam-1",
        kcbh: "GRS1001",
        kcmc: "研究方法",
        rq: "20260720",
        ksTime: "09:00-11:00",
        xn: "2025",
        ksdd: "研究生楼201",
        zwh: "18"
      },
      {
        id: "graduate-exam-undated",
        kcbh: "GRS1002",
        kcmc: "学术写作",
        rq: "考试周待定",
        ksTime: "待定",
        xn: "2025"
      },
      { id: "broken", xn: "2025" }
    ]
  }
});

const gradesBody = JSON.stringify({
  success: true,
  result: {
    xxjhnList: [
      {
        sjddBz: "2025-2026-1-GRS1001",
        kcbh: "GRS1001",
        kcmc: "研究方法",
        xf: "2.5",
        zf: "优秀",
        jd: null,
        xkztMc: "已处理"
      },
      {
        sjddBz: "pending",
        kcmc: "未处理课程",
        xkztMc: "未处理"
      }
    ]
  }
});

describe("zju graduate connector", () => {
  it("parses timetable weeks and never invents missing exam times or grade points", () => {
    const query: GraduateTermQuery = {
      academicYearStart: 2025,
      term: 13,
      season: "1|秋"
    };

    expect(parseGraduateTimetableResponse(query, timetableBody)).toEqual([
      expect.objectContaining({
        courseName: "研究方法",
        dayOfWeek: 1,
        periods: [1, 2],
        weeks: [1, 3, 5, 7],
        weekPattern: "odd",
        firstHalf: true,
        secondHalf: false
      })
    ]);
    expect(parseGraduateExamsResponse(2025, examsBody)).toEqual([
      expect.objectContaining({
        sourceId: "graduate-exam-1",
        startAt: "2026-07-20T09:00:00+08:00",
        endAt: "2026-07-20T11:00:00+08:00"
      }),
      expect.objectContaining({
        sourceId: "graduate-exam-undated",
        startAt: null,
        endAt: null
      })
    ]);
    expect(parseGraduateGradesResponse(gradesBody)).toEqual({
      grades: [
        {
          sourceId: "2025-2026-1-GRS1001",
          courseCode: "GRS1001",
          courseName: "研究方法",
          credit: 2.5,
          originalScore: "优秀",
          gradePoint: null,
          academicYearStart: 2025,
          termNumber: 1,
          isMajorCourse: true,
          courseCategory: null
        }
      ]
    });
  });

  it("publishes graduate capabilities only after a live business response", async () => {
    const publish = vi.fn(async () => undefined);
    const unregister = vi.fn();
    let registeredSourceId: string | null = null;
    const connector = createZjuGraduateConnector({
      loadAcademicProfileProof: async () => ({
        studentId: "2240100001",
        verifiedAt: "2026-07-19T04:00:00.000Z",
        verifiedService: "zju-unified-auth"
      }),
      fetchTimetableTerms: async (queries) =>
        queries.map((query) => ({ query, ok: true as const, body: timetableBody })),
      loadCachedTimetable: async () => null,
      fetchExams: async (queries) =>
        queries.map((query) => ({ ...query, ok: true as const, body: examsBody })),
      loadCachedExams: async () => null,
      fetchGrades: async () => ({ ok: true as const, body: gradesBody }),
      loadCachedGrades: async () => null,
      publish,
      registerRefreshJob: (sourceId) => {
        registeredSourceId = sourceId;
        return unregister;
      },
      now: () => new Date("2026-07-19T04:00:00.000Z")
    });

    const activation = await connector.activate({
      pluginId: connector.manifest.id,
      grantedPermissions: connector.manifest.permissions,
      bindings: {}
    });

    expect(registeredSourceId).toBe("org.campusos.zju-graduate");
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      capability: "academic.profile@1",
      accountId: "2240100001",
      state: "live",
      data: expect.objectContaining({ educationLevel: "graduate" })
    }));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      capability: "academic.grades@1",
      state: "live",
      data: parseGraduateGradesResponse(gradesBody)
    }));
    await activation.deactivate();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("merges cached exams when only part of the live query set is usable", async () => {
    const publish = vi.fn(async () => undefined);
    const connector = createZjuGraduateConnector({
      loadAcademicProfileProof: async () => ({
        studentId: "2240100001",
        verifiedAt: "2026-07-19T04:00:00.000Z",
        verifiedService: "zju-unified-auth"
      }),
      fetchTimetableTerms: async (queries) =>
        queries.map((query) => ({ query, ok: true as const, body: timetableBody })),
      loadCachedTimetable: async () => null,
      fetchExams: async (queries) =>
        queries.map((query, index) => index === 0
          ? { ...query, ok: true as const, body: examsBody }
          : { ...query, ok: false as const, message: "temporary failure" }),
      loadCachedExams: async () => ({
        exams: [
          {
            sourceId: "cached-exam",
            courseId: "GRS-CACHED",
            courseName: "缓存考试",
            kind: "final",
            scheduleText: "时间待确认",
            startAt: null,
            endAt: null,
            dateLabel: null,
            location: null,
            seat: null
          }
        ]
      }),
      fetchGrades: async () => ({ ok: true as const, body: gradesBody }),
      loadCachedGrades: async () => null,
      publish,
      registerRefreshJob: () => vi.fn(),
      now: () => new Date("2026-07-19T04:00:00.000Z")
    });

    await connector.activate({
      pluginId: connector.manifest.id,
      grantedPermissions: connector.manifest.permissions,
      bindings: {}
    });

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      capability: "academic.exams@1",
      state: "fallback",
      data: {
        exams: expect.arrayContaining([
          expect.objectContaining({ sourceId: "cached-exam" }),
          expect.objectContaining({ sourceId: "graduate-exam-1" })
        ])
      }
    }));
  });
});
