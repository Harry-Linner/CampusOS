import { describe, expect, it, vi } from "vitest";
import {
  createTimetableQueries,
  createZjuUndergraduateConnector,
  type TimetableQuery
} from "@campusos/plugin-zju-undergraduate/main";

describe("zju undergraduate connector", () => {
  it("publishes verified profile, timetable, exams and grades through one refresh job", async () => {
    let refreshJob: (() => Promise<unknown>) | undefined;
    let registeredSourceId: string | null = null;
    const unregister = vi.fn();
    const publish = vi.fn(async () => undefined);
    const connector = createZjuUndergraduateConnector({
      loadAcademicProfileProof: vi.fn(async () => ({
        studentId: "3240100001",
        verifiedAt: "2026-07-18T08:00:00.000Z",
        verifiedService: "undergraduate-academic-affairs"
      })),
      fetchTimetableTerms: vi.fn(async (queries: readonly TimetableQuery[]) =>
        queries.map((query: TimetableQuery, index: number) => ({
          query,
          ok: true as const,
          body:
            index === 0
              ? JSON.stringify({
                  kbList: [
                    {
                      kcb: "真实课程<br>教学班<br>真实教师<br>真实教室zwf",
                      sfqd: "1",
                      xqj: 2,
                      dsz: "2",
                      xxq: "春",
                      djj: 3,
                      skcd: 2
                    },
                    { kcb: "损坏条目", djj: null, skcd: 0 }
                  ]
                })
              : "null"
        }))
      ),
      loadCachedTimetable: vi.fn(async () => null),
      fetchExams: vi.fn(async () => ({
        ok: true as const,
        body: JSON.stringify({
          items: [
            {
              xkkh: "(2025-2026-2)-TEST-1",
              kcmc: "真实课程",
              kssj: "2026年7月20日 09:00-11:00",
              jsmc: "紫金港东1A-101",
              zwxh: "18"
            },
            {
              xkkh: "(2025-2026-2)-TEST-2",
              kcmc: "待定课程",
              qzkssj: "考试周第 3 天（14:00-16:00）",
              qzjsmc: "待定教室"
            },
            { kcmc: "损坏考试", kssj: "not-a-date" }
          ]
        })
      })),
      loadCachedExams: vi.fn(async () => null),
      fetchGrades: vi.fn(async () => ({
        ok: true as const,
        body: JSON.stringify({
          items: [
            {
              xkkh: "(2025-2026-2)-SE1001-001-1",
              kch: "SE1001",
              kcmc: "软件工程(甲)",
              xf: "3.5",
              cj: "优秀",
              jd: 4.5
            },
            { kcmc: "损坏成绩", cj: "95" }
          ]
        })
      })),
      loadCachedGrades: vi.fn(async () => null),
      publish,
      registerRefreshJob: (sourceId, job) => {
        registeredSourceId = sourceId;
        refreshJob = job;
        return unregister;
      },
      now: () => new Date("2026-07-19T04:00:00.000Z")
    });

    const activation = await connector.activate({
      pluginId: connector.manifest.id,
      grantedPermissions: connector.manifest.permissions,
      bindings: {}
    });

    expect(publish).toHaveBeenCalledWith({
      capability: "academic.profile@1",
      accountId: "3240100001",
      state: "cache",
      updatedAt: "2026-07-19T04:00:00.000Z",
      data: {
        studentId: "3240100001",
        educationLevel: "undergraduate",
        verifiedAt: "2026-07-18T08:00:00.000Z",
        verifiedService: "undergraduate-academic-affairs"
      }
    });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "academic.exams@1",
        accountId: "3240100001",
        state: "live",
        data: {
          exams: [
            expect.objectContaining({
              courseName: "真实课程",
              kind: "final",
              startAt: "2026-07-20T09:00:00+08:00",
              endAt: "2026-07-20T11:00:00+08:00",
              location: "紫金港东1A-101",
              seat: "18"
            }),
            expect.objectContaining({
              courseName: "待定课程",
              kind: "midterm",
              startAt: null,
              endAt: null,
              dateLabel: "考试周第 3 天"
            })
          ]
        }
      })
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "academic.grades@1",
        accountId: "3240100001",
        state: "live",
        data: {
          grades: [
            {
              sourceId: "(2025-2026-2)-SE1001-001-1",
              courseCode: "SE1001",
              courseName: "软件工程（甲）",
              credit: 3.5,
              originalScore: "优秀",
              gradePoint: 4.5,
              academicYearStart: 2025,
              termNumber: 2,
              isMajorCourse: true,
              courseCategory: null
            }
          ]
        }
      })
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "academic.timetable@1",
        accountId: "3240100001",
        state: "live",
        data: expect.objectContaining({
          terms: expect.arrayContaining([
            expect.objectContaining({
              academicYearStart: 2025,
              state: "live",
              sessions: [
                expect.objectContaining({
                  courseName: "真实课程",
                  dayOfWeek: 2,
                  periods: [3, 4],
                  weekPattern: "all"
                })
              ]
            })
          ])
        })
      })
    );
    await expect(refreshJob?.()).resolves.toEqual(
      expect.objectContaining({
        sourceId: "org.campusos.zju-undergraduate",
        status: "live"
      })
    );
    expect(registeredSourceId).toBe("org.campusos.zju-undergraduate");

    await activation.deactivate();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("derives current and next academic years from the runtime clock", () => {
    const queries = createTimetableQueries(
      new Date("2026-07-19T04:00:00.000Z")
    );

    expect(queries).toHaveLength(8);
    expect([...new Set(queries.map(({ academicYearStart }) => academicYearStart))])
      .toEqual([2025, 2026]);
  });

  it("keeps the last successful timetable when every live term fails", async () => {
    const cached = {
      terms: [
        {
          academicYearStart: 2025,
          season: "2|夏" as const,
          state: "live" as const,
          sessions: []
        }
      ]
    };
    const publish = vi.fn(async () => undefined);
    const connector = createZjuUndergraduateConnector({
      loadAcademicProfileProof: async () => ({
        studentId: "3240100001",
        verifiedAt: "2026-07-18T08:00:00.000Z",
        verifiedService: "undergraduate-academic-affairs"
      }),
      fetchTimetableTerms: async (queries) =>
        queries.map((query) => ({
          query,
          ok: false as const,
          message: "临时网络错误"
        })),
      loadCachedTimetable: async () => cached,
      fetchExams: async () => ({
        ok: true,
        body: JSON.stringify({ items: [] })
      }),
      loadCachedExams: async () => null,
      fetchGrades: async () => ({
        ok: true,
        body: JSON.stringify({ items: [] })
      }),
      loadCachedGrades: async () => null,
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
        capability: "academic.timetable@1",
        state: "cache",
        data: cached
      })
    );
  });

  it("retains per-term failure reasons when no timetable cache exists", async () => {
    const publish = vi.fn(async () => undefined);
    const connector = createZjuUndergraduateConnector({
      loadAcademicProfileProof: async () => ({
        studentId: "3240100001",
        verifiedAt: "2026-07-18T08:00:00.000Z",
        verifiedService: "undergraduate-academic-affairs"
      }),
      fetchTimetableTerms: async (queries) => queries.map((query) => ({
        query,
        ok: false as const,
        message: "本科教务请求失败（service-unavailable，HTTP 500）：统一认证服务暂时不可用。"
      })),
      loadCachedTimetable: async () => null,
      fetchExams: async () => ({ ok: true, body: JSON.stringify({ items: [] }) }),
      loadCachedExams: async () => null,
      fetchGrades: async () => ({ ok: true, body: JSON.stringify({ items: [] }) }),
      loadCachedGrades: async () => null,
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
      capability: "academic.timetable@1",
      state: "unavailable",
      message: expect.stringContaining("2025 1|秋")
    }));
  });
});
