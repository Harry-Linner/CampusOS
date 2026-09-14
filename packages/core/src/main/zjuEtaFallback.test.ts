import { describe, expect, it, vi } from "vitest";
import type {
  AcademicTimetableData,
  AcademicTimetableSession
} from "@campusos/shared";
import {
  createZjuUndergraduateConnector,
  type TimetableTermFetchResult,
  type TimetableQuery,
  type ZjuUndergraduateConnectorDependencies
} from "@campusos/plugin-zju-undergraduate/main";

type EtaTimetableFetcher = (
  academicYearStart: number,
  semester: 1 | 2
) => Promise<AcademicTimetableSession[]>;

const liveSession = (sourceId: string, courseName: string): AcademicTimetableSession => ({
  sourceId,
  courseName,
  teacher: "教师",
  location: "教室",
  dayOfWeek: 2,
  periods: [3],
  firstHalf: true,
  secondHalf: false,
  weekPattern: "all",
  confirmed: true
});

const zdbkBody = JSON.stringify({
  kbList: [{
    kcb: "ZDBK课程<br>教学班<br>教师<br>教室zwf",
    xqj: 2,
    djj: 3,
    skcd: 1,
    xxq: "秋",
    dsz: "0",
    sfqd: "1"
  }]
});

const emptyResult = (query: TimetableQuery) => ({
  query,
  ok: false as const,
  message: "ZDBK 暂时不可用"
});

const createConnector = ({
  fetchTimetableTerms,
  fetchEtaTimetable,
  cachedTimetable,
  publish = vi.fn(async () => undefined)
}: {
  fetchTimetableTerms: (
    queries: readonly TimetableQuery[]
  ) => Promise<TimetableTermFetchResult[]>;
  fetchEtaTimetable: EtaTimetableFetcher;
  cachedTimetable: AcademicTimetableData | null;
  publish?: ReturnType<typeof vi.fn>;
}) => {
  const dependencies: ZjuUndergraduateConnectorDependencies = {
    loadAcademicProfileProof: async () => ({
      studentId: "3240100001",
      verifiedAt: "2026-07-18T08:00:00.000Z",
      verifiedService: "undergraduate-academic-affairs"
    }),
    fetchTimetableTerms,
    fetchEtaTimetable,
    loadCachedTimetable: async () => cachedTimetable,
    fetchExams: async () => ({
      ok: true as const,
      body: JSON.stringify({ items: [] })
    }),
    loadCachedExams: async () => null,
    fetchGrades: async () => ({
      ok: true as const,
      body: JSON.stringify({ items: [] }),
      majorBody: JSON.stringify({ items: [] })
    }),
    loadCachedGrades: async () => null,
    publish,
    registerRefreshJob: () => () => undefined,
    now: () => new Date("2026-07-19T04:00:00.000Z")
  };

  return {
    connector: createZjuUndergraduateConnector(dependencies),
    publish
  };
};

const timetablePublication = (publish: ReturnType<typeof vi.fn>): {
  state?: string;
  message?: string;
  data?: { terms?: Array<Record<string, unknown>> };
} | undefined =>
  publish.mock.calls
    .map(([publication]) => publication as {
      capability?: string;
      state?: string;
      message?: string;
      data?: { terms?: Array<Record<string, unknown>> };
    })
    .filter(({ capability }) => capability === "academic.timetable@1")
    .at(-1);

const activate = async (
  connector: ReturnType<typeof createZjuUndergraduateConnector>
): Promise<void> => {
  await connector.activate({
    pluginId: connector.manifest.id,
    grantedPermissions: connector.manifest.permissions,
    bindings: {}
  });
};

describe("zju undergraduate ETA timetable fallback", () => {
  it("does not access ETA when every ZDBK term returns sessions", async () => {
    const fetchEtaTimetable = vi.fn<EtaTimetableFetcher>(async () => {
      throw new Error("ETA must not be called");
    });
    const fetchTimetableTerms = vi.fn(async (queries: readonly TimetableQuery[]) =>
      queries.map((query) => ({
        query,
        ok: true as const,
        body: zdbkBody
      }))
    );
    const { connector } = createConnector({
      fetchTimetableTerms,
      fetchEtaTimetable,
      cachedTimetable: null
    });

    await activate(connector);

    expect(fetchEtaTimetable).not.toHaveBeenCalled();
  });

  it("prefers ETA over cache and shares one request per academic year and semester", async () => {
    const etaSession = liveSession("eta-session", "ETA课程");
    const cachedSession = liveSession("cached-session", "缓存课程");
    const fetchEtaTimetable = vi.fn<EtaTimetableFetcher>(
      async (academicYearStart, semester) =>
        academicYearStart === 2025 && semester === 2 ? [etaSession] : []
    );
    const fetchTimetableTerms = vi.fn(async (queries: readonly TimetableQuery[]) =>
      queries.map(emptyResult)
    );
    const { connector, publish } = createConnector({
      fetchTimetableTerms,
      fetchEtaTimetable,
      cachedTimetable: {
        terms: [{
          academicYearStart: 2025,
          season: "2|春",
          state: "live",
          sessions: [cachedSession]
        }]
      }
    });

    await activate(connector);

    const calls = fetchEtaTimetable.mock.calls.map(([academicYearStart, semester]) =>
      `${academicYearStart}:${semester}`
    );
    expect(new Set(calls).size).toBe(calls.length);
    expect(fetchEtaTimetable).toHaveBeenCalledWith(2025, 2);
    expect(calls.some(key => key.startsWith("2026:"))).toBe(false);

    const timetable = timetablePublication(publish);
    const targetTerm = timetable?.data?.terms?.find((term) =>
      term.academicYearStart === 2025 && term.season === "2|春"
    );
    expect(targetTerm).toEqual(expect.objectContaining({
      state: "live",
      source: "eta",
      sessions: [etaSession]
    }));
    expect(timetable?.message).toContain("ETA");
    expect(timetable?.state).toBe("fallback");
    expect(JSON.stringify(targetTerm)).not.toContain("cached-session");
  });

  it("keeps same-term cache and reports ETA failure when ETA is empty or throws", async () => {
    const cachedSession = liveSession("cached-session", "缓存课程");
    const emptyEtaCachedSession = liveSession("empty-eta-cache", "空响应缓存课程");
    const fetchEtaTimetable = vi.fn<EtaTimetableFetcher>(
      async (academicYearStart, semester) => {
        if (academicYearStart === 2025 && semester === 2) {
          throw new Error("ETA 服务暂时不可用");
        }
        return [];
      }
    );
    const fetchTimetableTerms = vi.fn(async (queries: readonly TimetableQuery[]) =>
      queries.map(emptyResult)
    );
    const { connector, publish } = createConnector({
      fetchTimetableTerms,
      fetchEtaTimetable,
      cachedTimetable: {
        terms: [
          {
            academicYearStart: 2025,
            season: "2|春",
            state: "live",
            sessions: [cachedSession]
          },
          {
            academicYearStart: 2025,
            season: "1|秋",
            state: "live",
            sessions: [emptyEtaCachedSession]
          }
        ]
      }
    });

    await activate(connector);

    const timetable = timetablePublication(publish);
    const targetTerm = timetable?.data?.terms?.find((term) =>
      term.academicYearStart === 2025 && term.season === "2|春"
    );
    expect(targetTerm).toEqual(expect.objectContaining({
      state: "cache",
      sessions: [cachedSession]
    }));
    expect(timetable?.data?.terms?.find((term) =>
      term.academicYearStart === 2025 && term.season === "1|秋"
    )).toEqual(expect.objectContaining({
      state: "cache",
      sessions: [emptyEtaCachedSession]
    }));
    expect(timetable?.message).toContain("ETA");
    expect(timetable?.message).toContain("ETA 请求失败");
  });
});
