import { describe, expect, it, vi } from "vitest";
import {
  buildCourseCatalog,
  calculatePracticeSummary,
  createTimetableQueries,
  createZjuUndergraduateConnector,
  parseGradesResponse,
  parseMajorCourseIdsResponse,
  parsePracticeData,
  parsePracticeRecordsResponse,
  parsePracticeSummaryResponse,
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
        }),
        majorBody: JSON.stringify({
          items: [{ xkkh: "(2025-2026-2)-SE1001-001-1" }]
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
              realId: "(2025-2026-2)-SE1001",
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
        body: JSON.stringify({ items: [] }),
        majorBody: JSON.stringify({ items: [] })
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
      fetchGrades: async () => ({
        ok: true,
        body: JSON.stringify({ items: [] }),
        majorBody: JSON.stringify({ items: [] })
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

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      capability: "academic.timetable@1",
      state: "unavailable",
      message: expect.stringContaining("2025 1|秋")
    }));
  });
});

describe("undergraduate major-grade projection", () => {
  it("marks only transcript records returned by the dedicated major endpoint", () => {
    const majorIds = parseMajorCourseIdsResponse(JSON.stringify({
      items: [{ xkkh: "(2025-2026-1)-MAJOR-001-1" }]
    }));
    const result = parseGradesResponse(JSON.stringify({
      items: [
        { xkkh: "(2025-2026-1)-MAJOR-001-1", kcmc: "major", xf: 3, cj: "90", jd: 4 },
        { xkkh: "(2025-2026-1)-OTHER-001-1", kcmc: "other", xf: 2, cj: "88", jd: 3.9 }
      ]
    }), majorIds);

    expect(result.grades.map((grade) => grade.isMajorCourse)).toEqual([true, false]);
  });

  it("uses Celechron's zero point when the transcript omits jd", () => {
    const result = parseGradesResponse(JSON.stringify({
      items: [{ xkkh: "(2025-2026-1)-MISSING-001-1", kcmc: "missing", xf: 2, cj: "不及格" }]
    }));

    expect(result.grades[0]?.gradePoint).toBe(0);
  });
});

describe("undergraduate practice and course catalog projections", () => {
  it("keeps the first valid practice item, rejects invalid item fields, and parses dates strictly", () => {
    const body = JSON.stringify({
      data: [
        {
          id: 7,
          xm: { mc: "first", xmfl: { id: 1, mc: "category" } },
          cyrshzt: { value: 5, label: "approved" },
          jd: "1.5",
          hdsj: "20260801",
          hdjssj: "2026-08-02T12:00:00+08:00",
          gxsj: "not-a-date"
        },
        {
          id: 7,
          xm: { mc: "second", xmfl: { id: 1, mc: "category" } },
          cyrshzt: { value: 5 },
          jd: "99"
        },
        {
          id: 8,
          xm: { mc: "deleted", xmfl: { id: 2, mc: "category" } },
          cyrshzt: { value: 5 },
          jd: 3,
          sfsc: true
        },
        {
          id: 9,
          xm: { mc: "broken", xmfl: { id: 3, mc: "category" } },
          cyrshzt: { value: 5 },
          jd: "not-a-number"
        }
      ]
    });

    expect(parsePracticeRecordsResponse(body)).toEqual([
      expect.objectContaining({
        sourceId: "7",
        projectName: "first",
        score: 1.5,
        activityStart: "2026-08-01T00:00:00.000Z",
        updatedAt: null
      })
    ]);
  });

  it("follows the Celechron summary priority and strict passed mapping", () => {
    const updatedAt = "2026-08-04T00:00:00.000Z";
    const summary = parsePracticeSummaryResponse(JSON.stringify({
      extend: { myInfo: { dektJf: "1.5", dsktJf: null, dsiktJf: 2, myTg: "yes", lyTg: "0.0" } }
    }), updatedAt);
    expect(summary).toMatchObject({
      secondClassPoints: 1.5,
      thirdClassPoints: 0,
      fourthClassPoints: 2,
      totalPoints: 3.5,
      myPassed: true,
      lastYearPassed: false,
      source: "networkMyInfo",
      updatedAt
    });
    expect(() => parsePracticeSummaryResponse(JSON.stringify({ dektJf: "bad" }), updatedAt)).toThrow();

    const data = parsePracticeData(JSON.stringify({
      data: [{
        id: 1,
        xm: { mc: "approved", xmfl: { id: 1, mc: "category" } },
        cyrshzt: { value: 5 },
        jd: 2
      }]
    }), undefined, updatedAt);
    expect(data.summary).toMatchObject({
      secondClassPoints: 2,
      totalPoints: 2,
      source: "calculatedFromRecords"
    });
    expect(calculatePracticeSummary(data.records, updatedAt, false).totalPoints).toBe(2);
  });

  it("publishes a fallback when practice details succeed but the summary fails", async () => {
    const publish = vi.fn(async () => undefined);
    const connector = createZjuUndergraduateConnector({
      loadAcademicProfileProof: async () => ({
        studentId: "3240100001",
        verifiedAt: "2026-07-18T08:00:00.000Z",
        verifiedService: "undergraduate-academic-affairs"
      }),
      fetchTimetableTerms: async (queries) => queries.map((query) => ({ query, ok: true as const, body: "null" })),
      loadCachedTimetable: async () => null,
      fetchExams: async () => ({ ok: true as const, body: JSON.stringify({ items: [] }) }),
      loadCachedExams: async () => null,
      fetchGrades: async () => ({ ok: true as const, body: JSON.stringify({ items: [] }), majorBody: JSON.stringify({ items: [] }) }),
      loadCachedGrades: async () => null,
      fetchPractice: async () => ({
        ok: true as const,
        body: JSON.stringify({ data: [{
          id: 11,
          xm: { mc: "approved", xmfl: { id: 1, mc: "category" } },
          cyrshzt: { value: 5 },
          jd: 2
        }] }),
        summaryBody: "not-json"
      }),
      loadCachedPractice: async () => null,
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
      capability: "practice.records@1",
      accountId: "3240100001",
      state: "fallback",
      data: expect.objectContaining({
        detailsAvailable: true,
        summary: expect.objectContaining({
          source: "calculatedFromRecords",
          totalPoints: 2
        })
      })
    }));
  });

  it("joins timetable sessions and exams into one course record using Celechron merge rules", () => {
    const sessionBase = {
      sourceId: "session-1",
      courseName: "catalog-course",
      teacher: "teacher",
      location: "room",
      dayOfWeek: 1,
      firstHalf: true,
      secondHalf: false,
      weekPattern: "all" as const,
      confirmed: true
    };
    const catalog = buildCourseCatalog({
      terms: [{
        academicYearStart: 2025,
        season: "1|秋",
        state: "live",
        sessions: [
          { ...sessionBase, periods: [1] },
          { ...sessionBase, sourceId: "session-2", periods: [2], firstHalf: false, secondHalf: true },
          { ...sessionBase, sourceId: "session-3", periods: [1], firstHalf: false, secondHalf: true }
        ]
      }],
      exams: [{
        sourceId: "exam-1",
        courseId: "(2025-2026-1)-CAT-001-1",
        courseName: "catalog-course",
        kind: "final",
        scheduleText: "exam",
        startAt: null,
        endAt: null,
        dateLabel: null,
        location: null,
        seat: null
      }],
      grades: []
    });

    expect(catalog.courses).toHaveLength(1);
    expect(catalog.courses[0]?.sessions).toHaveLength(1);
    expect(catalog.courses[0]?.sessions[0]).toMatchObject({ periods: [1, 2], firstHalf: true, secondHalf: true });
    expect(catalog.courses[0]?.examSourceIds).toEqual(["exam-1"]);
  });

  it("keeps same-name repeated courses separate when their xkkh differs", () => {
    const catalog = buildCourseCatalog({
      terms: [],
      exams: [
        {
          sourceId: "exam-a",
          courseId: "(2025-2026-1)-REPEAT-A-1",
          courseName: "重复课程",
          kind: "final",
          scheduleText: "exam",
          startAt: null,
          endAt: null,
          dateLabel: null,
          location: null,
          seat: null
        },
        {
          sourceId: "exam-b",
          courseId: "(2025-2026-1)-REPEAT-B-1",
          courseName: "重复课程",
          kind: "final",
          scheduleText: "exam",
          startAt: null,
          endAt: null,
          dateLabel: null,
          location: null,
          seat: null
        }
      ],
      grades: [
        {
          sourceId: "(2025-2026-1)-REPEAT-A-1",
          realId: "(2025-2026-1)-REPEAT-A",
          courseCode: "REPEAT-A",
          courseName: "重复课程",
          credit: 2,
          originalScore: "90",
          gradePoint: 4,
          academicYearStart: 2025,
          termNumber: 1,
          isMajorCourse: false,
          courseCategory: null
        },
        {
          sourceId: "(2025-2026-1)-REPEAT-B-1",
          realId: "(2025-2026-1)-REPEAT-B",
          courseCode: "REPEAT-B",
          courseName: "重复课程",
          credit: 3,
          originalScore: "80",
          gradePoint: 3,
          academicYearStart: 2025,
          termNumber: 1,
          isMajorCourse: false,
          courseCategory: null
        }
      ]
    });

    expect(catalog.courses).toHaveLength(2);
    expect(catalog.courses.map((course) => course.gradeSourceId)).toEqual([
      "(2025-2026-1)-REPEAT-A-1",
      "(2025-2026-1)-REPEAT-B-1"
    ]);
    expect(catalog.courses[0]?.examSourceIds).toEqual(["exam-a"]);
    expect(catalog.courses[1]?.examSourceIds).toEqual(["exam-b"]);
  });
});
describe("undergraduate cached timetable projection", () => {
  it("merges cached timetable terms into the course catalog when only some terms fail", async () => {
    const publish = vi.fn(async () => undefined);
    const cached = {
      terms: [{
        academicYearStart: 2026,
        season: createTimetableQueries(new Date("2026-07-19T04:00:00.000Z")).find((query) => query.academicYearStart === 2026 && query.season.startsWith("1|"))!.season,
        state: "live" as const,
        sessions: [{
          sourceId: "cached-session",
          courseName: "cached-course",
          teacher: "cached-teacher",
          location: "cached-room",
          dayOfWeek: 2,
          periods: [3],
          firstHalf: true,
          secondHalf: false,
          weekPattern: "all" as const,
          confirmed: true
        }]
      }]
    };
    const connector = createZjuUndergraduateConnector({
      loadAcademicProfileProof: async () => ({
        studentId: "3240100001",
        verifiedAt: "2026-07-18T08:00:00.000Z",
        verifiedService: "undergraduate-academic-affairs"
      }),
      fetchTimetableTerms: async (queries) => queries.map((query, index) => index === 0
        ? { query, ok: true as const, body: "null" }
        : { query, ok: false as const, message: "term unavailable" }),
      loadCachedTimetable: async () => cached,
      fetchExams: async () => ({ ok: true as const, body: JSON.stringify({ items: [] }) }),
      loadCachedExams: async () => null,
      fetchGrades: async () => ({ ok: true as const, body: JSON.stringify({ items: [] }), majorBody: JSON.stringify({ items: [] }) }),
      loadCachedGrades: async () => null,
      loadCachedCourseCatalog: async () => null,
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
      state: "fallback",
      data: expect.objectContaining({
        terms: expect.arrayContaining([
          expect.objectContaining({ academicYearStart: 2026, state: "cache", sessions: expect.any(Array) })
        ])
      })
    }));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      capability: "academic.course-catalog@1",
      state: "fallback",
      data: expect.objectContaining({
        courses: expect.arrayContaining([expect.objectContaining({ courseName: "cached-course" })])
      })
    }));
  });
});
