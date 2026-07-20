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
import { manifest } from "./manifest";

/**
 * ZJU 紫金港校区标准节次时间表。
 *
 * 这些时间来自公开的教务管理信息，作为默认参考值提供。
 * 若实际节次时间与此不同，用户可在设置中自行调整。
 * 不同校区（玉泉、西溪、之江等）的节次时间可能略有差异。
 */
export const ZJU_STANDARD_PERIOD_TIMES: PeriodTimeRecord[] = [
  { period: 1,  start: "08:00", end: "08:45" },
  { period: 2,  start: "08:50", end: "09:35" },
  { period: 3,  start: "09:50", end: "10:35" },
  { period: 4,  start: "10:40", end: "11:25" },
  { period: 5,  start: "11:30", end: "12:15" },
  { period: 6,  start: "13:15", end: "14:00" },
  { period: 7,  start: "14:05", end: "14:50" },
  { period: 8,  start: "14:55", end: "15:40" },
  { period: 9,  start: "15:55", end: "16:40" },
  { period: 10, start: "16:45", end: "17:30" },
  { period: 11, start: "18:30", end: "19:15" },
  { period: 12, start: "19:20", end: "20:05" },
  { period: 13, start: "20:10", end: "20:55" },
  { period: 14, start: "21:00", end: "21:45" }
];

interface ConnectorRefreshResult {
  sourceId: "zju-calendar-config";
  status: "live" | "cache" | "unavailable";
  updatedAt: string;
  message?: string;
}

export interface CalendarPageFetchResult {
  body: string;
  sourceUrl: string;
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
    periodTimes: ZJU_STANDARD_PERIOD_TIMES
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
      return { sourceId: "zju-calendar-config", status: "live", updatedAt };
    } catch (error) {
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
          sourceId: "zju-calendar-config",
          status: "cache",
          updatedAt,
          message: "官网校历暂时不可用，已使用缓存。"
        };
      }

      const message = error instanceof Error ? error.message : "官网校历请求失败。";
      await publish({
        capability: "academic.calendar-config@1",
        accountId: null,
        state: "unavailable",
        updatedAt,
        data: null,
        message
      });
      return {
        sourceId: "zju-calendar-config",
        status: "unavailable",
        updatedAt,
        message
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
