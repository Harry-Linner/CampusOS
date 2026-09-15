import { Solar } from "lunar-typescript";

/**
 * Desk-calendar date, lunar and grouping helpers.
 *
 * These were inlined in `desk-calendar.tsx`, where they were only reachable
 * through the 800-line window component and its end-to-end test. They are pure
 * functions over plain values, so the module interface is now the test surface:
 * every rule below is covered by `deskCalendarDates.test.ts`.
 */

export const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export const getShanghaiDateParts = (value: Date): Record<string, string> => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(value);
  return Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
};

export const fromShanghaiParts = (y: number, mo: number, d: number, h = 0, mi = 0): Date =>
  new Date(Date.UTC(y, mo - 1, d, h, mi) - SHANGHAI_OFFSET_MS);

export const toDateInput = (value: Date): string => {
  const p = getShanghaiDateParts(value);
  return `${p.year}-${p.month}-${p.day}`;
};

export const startOfDay = (value: Date): Date => {
  const p = getShanghaiDateParts(value);
  return fromShanghaiParts(Number(p.year), Number(p.month), Number(p.day));
};

export const addDays = (value: Date, n: number): Date => new Date(value.getTime() + n * 86400000);

export const getShanghaiWeekday = (value: Date): number => {
  const w = new Intl.DateTimeFormat("en-US", { timeZone: SHANGHAI_TIME_ZONE, weekday: "short" }).format(value);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(w);
};

export const startOfWeek = (value: Date): Date => {
  const day = getShanghaiWeekday(value);
  return addDays(startOfDay(value), day === 0 ? -6 : 1 - day);
};

export const dayKey = (value: Date | string): string => toDateInput(typeof value === "string" ? new Date(value) : value);

export const monthKey = (value: Date | string): string => dayKey(value).slice(0, 7);

// 农历/节气/节日/宜忌：用 lunar-typescript(6tail,MIT) 计算，供显示项开关展示。
export const lunarOf = (y: number, m: number, d: number): { day: string; jieqi: string; festivals: string[]; yi: string[]; ji: string[] } => {
  const lunar = Solar.fromYmd(y, m, d).getLunar();
  return {
    day: lunar.getDayInChinese(),
    jieqi: lunar.getJieQi() ?? "",
    festivals: [...lunar.getFestivals(), ...lunar.getOtherFestivals()],
    yi: lunar.getDayYi(),
    ji: lunar.getDayJi()
  };
};

export const naturalWeekNumber = (value: Date): number => {
  const p = getShanghaiDateParts(value);
  const target = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  const weekday = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - weekday + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
};

export const getShanghaiDayNumber = (value: Date): number => Number(getShanghaiDateParts(value).day);

export const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export const buildMonthDays = (month: Date): Date[] => {
  const p = getShanghaiDateParts(month);
  const first = startOfWeek(fromShanghaiParts(Number(p.year), Number(p.month), 1));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
};

export const formatTimeRange = (startAt: string, endAt: string): string => {
  const sp = getShanghaiDateParts(new Date(startAt));
  const ep = getShanghaiDateParts(new Date(endAt));
  const f = (q: Record<string, string>): string => `${Number(q.hour)}:${q.minute}`;
  if (toDateInput(new Date(startAt)) === toDateInput(new Date(endAt))) return `${f(sp)} - ${f(ep)}`;
  return `${Number(sp.month)}/${Number(sp.day)} ${f(sp)} - ${Number(ep.month)}/${Number(ep.day)} ${f(ep)}`;
};

export const formatDateTime = (value: string): string => {
  const p = getShanghaiDateParts(new Date(value));
  return `${Number(p.month)}月${Number(p.day)}日 ${Number(p.hour)}:${p.minute}`;
};

export interface Range { start: Date; end: Date }

/** 把跨天事件按天展开，并按开始时间排序；只保留与区间相交的事件。 */
export const groupEventsByDay = <T extends { startAt: string; endAt: string }>(
  events: T[],
  range: Range
): Map<string, T[]> => {
  const result = new Map<string, T[]>();
  for (const event of events) {
    if (Date.parse(event.endAt) <= range.start.getTime() || Date.parse(event.startAt) >= range.end.getTime()) continue;
    const es = Math.max(Date.parse(event.startAt), range.start.getTime());
    const ee = Math.min(Date.parse(event.endAt), range.end.getTime());
    for (let c = startOfDay(new Date(es)); c.getTime() < ee; c = addDays(c, 1)) {
      const k = dayKey(c);
      result.set(k, [...(result.get(k) ?? []), event]);
    }
  }
  for (const items of result.values()) items.sort((l, r) => Date.parse(l.startAt) - Date.parse(r.startAt));
  return result;
};
