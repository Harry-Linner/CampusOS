import type {
  AcademicCalendarConfigData,
  AcademicCalendarQuarter,
  AcademicTimetableSeason,
  CapabilityPublication,
  CampusPermission,
  PeriodTimeRecord,
  PluginCapability,
  PluginCapabilityBinding
} from "@campusos/shared";
import { classifyRetryError } from "@campusos/shared";
import { manifest } from "./manifest";
import { ZJU_ACADEMIC_TERM_RULES } from "./termRules";

export { ZJU_ACADEMIC_TERM_RULES } from "./termRules";

/**
 * 浙江大学标准节次时间表（紫金港/玉泉/西溪/华家池/之江同表）。
 *
 * 来源：官方校历（本科与研究生同表），逐条核对见
 * `docs/references/zju-academic-calendar.md`。共 **13 节**：上午 1–5、下午 6–10、
 * 晚上 11–13，没有第 14、15 节。海宁国际校区院历另行制定，不在本表范围内。
 */
export const ZJU_STANDARD_PERIOD_TIMES: PeriodTimeRecord[] = [
  { period: 1,  start: "08:00", end: "08:45" },
  { period: 2,  start: "08:50", end: "09:35" },
  { period: 3,  start: "10:00", end: "10:45" },
  { period: 4,  start: "10:50", end: "11:35" },
  { period: 5,  start: "11:40", end: "12:25" },
  { period: 6,  start: "13:25", end: "14:10" },
  { period: 7,  start: "14:15", end: "15:00" },
  { period: 8,  start: "15:05", end: "15:50" },
  { period: 9,  start: "16:15", end: "17:00" },
  { period: 10, start: "17:05", end: "17:50" },
  { period: 11, start: "18:50", end: "19:35" },
  { period: 12, start: "19:40", end: "20:25" },
  { period: 13, start: "20:30", end: "21:15" }
];

interface ConnectorRefreshResult {
  sourceId: typeof manifest.id;
  status: "live" | "cache" | "unavailable";
  updatedAt: string;
  message?: string;
  /** 请求版本指纹（URL/方法/表单结构摘要，脱敏），供连接器健康台账与上游变化检测。 */
  requestFingerprint?: string | null;
  /** 失败分类（retryable/fatal），与主进程 retryPolicy 语义一致。 */
  retryClassification?: "retryable" | "fatal" | null;
}

export interface CalendarPageFetchResult {
  body: string;
  sourceUrl: string;
  requestFingerprint?: string;
}

export interface ZjuCalendarConfigConnectorDependencies {
  fetchCalendarPage: () => Promise<CalendarPageFetchResult>;
  loadCachedCalendar: () => Promise<AcademicCalendarConfigData | null>;
  publish: (
    publication: CapabilityPublication<AcademicCalendarConfigData>
  ) => Promise<void>;
  registerRefreshJob: (
    sourceId: string,
    job: () => Promise<ConnectorRefreshResult>
  ) => () => void;
  now?: () => Date;
}

interface ConnectorActivationContext {
  pluginId: string;
  grantedPermissions: readonly CampusPermission[];
  bindings: Readonly<Partial<Record<PluginCapability, PluginCapabilityBinding>>>;
}

const seasonByQuarter = {
  Autumn: "1|秋",
  Winter: "1|冬",
  Spring: "2|春",
  Summer: "2|夏"
} as const satisfies Record<string, AcademicTimetableSeason>;

const monthByName = new Map(
  [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ].map((month, index) => [month, index + 1] as const)
);

const decodeHtml = (value: string): string =>
  value
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&ndash;", "–")
    .replaceAll("&mdash;", "—")
    .replace(/\s+/g, " ")
    .trim();

const toDateString = (year: number, month: number, day: number): string | null => {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

interface ParsedEnglishDate {
  month: number;
  day: number;
  year: number | null;
}

const parseEnglishDates = (value: string): ParsedEnglishDate[] =>
  [...value.matchAll(/([A-Z][a-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?/g)]
    .flatMap((match) => {
      const month = monthByName.get(match[1]);
      const day = Number.parseInt(match[2], 10);
      if (!month || !Number.isInteger(day)) return [];
      return [{
        month,
        day,
        year: match[3] ? Number.parseInt(match[3], 10) : null
      }];
    });

const parseQuarter = (
  name: keyof typeof seasonByQuarter,
  titleYear: number,
  sectionHtml: string
): AcademicCalendarQuarter | null => {
  if (titleYear < 2000 || titleYear > 2100) return null;

  const rangeHtml = sectionHtml.match(/<th\b[^>]*>([\s\S]*?)<\/th>/i)?.[1];
  const classesBeginHtml = sectionHtml.match(
    /<tr\b[^>]*>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<td\b[^>]*>\s*Classes begin\s*<\/td>\s*<\/tr>/i
  )?.[1];
  if (!rangeHtml || !classesBeginHtml) return null;

  const range = parseEnglishDates(decodeHtml(rangeHtml));
  const classesBegin = parseEnglishDates(decodeHtml(classesBeginHtml))[0];
  if (range.length < 2 || !classesBegin) return null;

  const startYear = range[0].year ?? titleYear;
  const endYear =
    range[1].year ??
    (range[1].month < range[0].month ? startYear + 1 : startYear);
  const classesBeginYear =
    classesBegin.year ??
    (classesBegin.month < range[0].month ? startYear + 1 : startYear);
  const startDate = toDateString(startYear, range[0].month, range[0].day);
  const endDate = toDateString(endYear, range[1].month, range[1].day);
  const classesBeginDate = toDateString(
    classesBeginYear,
    classesBegin.month,
    classesBegin.day
  );
  if (!startDate || !endDate || !classesBeginDate) return null;
  if (
    Date.parse(`${startDate}T00:00:00Z`) >
      Date.parse(`${classesBeginDate}T00:00:00Z`) ||
    Date.parse(`${classesBeginDate}T00:00:00Z`) >
      Date.parse(`${endDate}T00:00:00Z`)
  ) {
    return null;
  }

  return {
    academicYearStart:
      name === "Spring" || name === "Summer" ? titleYear - 1 : titleYear,
    season: seasonByQuarter[name],
    startDate,
    classesBeginDate,
    endDate
  };
};

export const parseOfficialCalendarPage = (
  body: string,
  sourceUrl: string
): AcademicCalendarConfigData => {
  const quarters: AcademicCalendarQuarter[] = [];
  const sectionPattern =
    /<div\s+class="title">\s*(Autumn|Winter|Spring|Summer) Quarter (\d{4})\s*<\/div>([\s\S]*?)(?=<div\s+class="title">|$)/g;

  for (const match of body.matchAll(sectionPattern)) {
    const quarter = parseQuarter(
      match[1] as keyof typeof seasonByQuarter,
      Number.parseInt(match[2], 10),
      match[3]
    );
    if (quarter) quarters.push(quarter);
  }

  const uniqueQuarters = [...new Map(
    quarters.map((quarter) => [
      `${quarter.academicYearStart}:${quarter.season}`,
      quarter
    ])
  ).values()].sort(
    (left, right) => Date.parse(left.classesBeginDate) - Date.parse(right.classesBeginDate)
  );
  if (uniqueQuarters.length === 0) {
    throw new Error("浙江大学官网校历中没有可识别的学季边界。");
  }

  const source = new URL(sourceUrl);
  if (source.protocol !== "https:" || source.hostname !== "www.zju.edu.cn") {
    throw new Error("校历来源不是允许的浙江大学 HTTPS 地址。");
  }

  return {
    timezone: "Asia/Shanghai",
    sourceUrl: source.toString(),
    quarters: uniqueQuarters,
    periodTimes: ZJU_STANDARD_PERIOD_TIMES,
    termRules: ZJU_ACADEMIC_TERM_RULES
  };
};

export const createZjuCalendarConfigConnector = ({
  fetchCalendarPage,
  loadCachedCalendar,
  publish,
  registerRefreshJob,
  now = () => new Date()
}: ZjuCalendarConfigConnectorDependencies) => {
  const refresh = async (): Promise<ConnectorRefreshResult> => {
    const updatedAt = now().toISOString();
    try {
      const response = await fetchCalendarPage();
      const data = parseOfficialCalendarPage(response.body, response.sourceUrl);
      await publish({
        capability: "academic.calendar-config@1",
        accountId: null,
        state: "live",
        updatedAt,
        data
      });
      return {
        sourceId: manifest.id,
        status: "live",
        updatedAt,
        requestFingerprint: response.requestFingerprint ?? null
      };
    } catch (error) {
      const retryClassification = classifyRetryError(error);
      const cached = await loadCachedCalendar();
      if (cached) {
        await publish({
          capability: "academic.calendar-config@1",
          accountId: null,
          state: "cache",
          updatedAt,
          data: cached,
          message: "官网校历暂时不可用，继续使用上次成功数据。"
        });
        return {
          sourceId: manifest.id,
          status: "cache",
          updatedAt,
          message: "官网校历暂时不可用，已使用缓存。",
          retryClassification
        };
      }

      const message = error instanceof Error ? error.message : "官网校历请求失败。";
      // Deviation from Celechron 1.3.0 lib/http/time_config_service.dart:137-181,
      // which falls back to a safe default calendar generated from the last valid
      // configuration when both the online page and the exact-semester cache are
      // missing. CampusOS deliberately stops at "unavailable" instead of
      // inventing quarter boundaries from a previous term: fabricating start/end
      // dates for an unknown semester could silently misproject every timetable
      // event. The built-in ZJU_STANDARD_PERIOD_TIMES remain the static default
      // period table, but quarter boundaries are never guessed. Covered by
      // zjuCalendarConfigConnector.test.ts (cache branch) and the unavailable
      // branch below. Impact: when the official page and cache are both missing,
      // calendar-config is unavailable and event projection falls back to
      // "current term unknown" instead of a guessed term.
      await publish({
        capability: "academic.calendar-config@1",
        accountId: null,
        state: "unavailable",
        updatedAt,
        data: null,
        message
      });
      return {
        sourceId: manifest.id,
        status: "unavailable",
        updatedAt,
        message,
        retryClassification
      };
    }
  };

  return {
    manifest,
    activate: async (context: ConnectorActivationContext) => {
      if (context.pluginId !== manifest.id) {
        throw new Error("浙大校历连接器收到错误的插件身份。");
      }
      const missingPermission = manifest.permissions.find(
        (permission) => !context.grantedPermissions.includes(permission)
      );
      if (missingPermission) {
        throw new Error(`浙大校历连接器缺少权限：${missingPermission}`);
      }

      const unregister = registerRefreshJob(manifest.id, refresh);
      try {
        await refresh();
      } catch (error) {
        unregister();
        throw error;
      }
      return { deactivate: unregister };
    }
  };
};
