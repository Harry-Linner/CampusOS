export type AssistantTaskType = "deadline" | "fixed";

export interface AssistantParseInput {
  text: string;
  now?: Date;
  courseNames?: readonly string[];
}

export interface AssistantDraft {
  sourceText: string;
  title: string;
  description: string;
  type: AssistantTaskType;
  startAt: string | null;
  endAt: string | null;
  timeNeededMinutes: number;
  location: string;
  courseName: string;
  confidence: "high" | "medium" | "low";
  missingFields: string[];
  warnings: string[];
  evidence: string[];
}

const SHANGHAI = "Asia/Shanghai";
const WEEKDAYS: Record<string, number> = {
  "日": 0, "天": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6
};

const partsInShanghai = (value: Date): Record<string, string> => Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value])
);

const shanghaiDate = (year: number, month: number, day: number, hour: number, minute: number): Date => {
  const iso = `${year.toString().padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`;
  const value = new Date(iso);
  return Number.isFinite(value.getTime()) ? value : new Date(Number.NaN);
};

const dateOnlyFromParts = (value: Date): Date => {
  const parts = partsInShanghai(value);
  return shanghaiDate(Number(parts.year), Number(parts.month), Number(parts.day), 0, 0);
};

const weekdayInShanghai = (value: Date): number => {
  const label = new Intl.DateTimeFormat("zh-CN", { timeZone: SHANGHAI, weekday: "short" }).format(value);
  return WEEKDAYS[label.replace("周", "")] ?? 0;
};

const addDays = (value: Date, days: number): Date => new Date(value.getTime() + days * 86400000);

const parseChineseNumber = (value: string): number => {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (value === "十") return 10;
  if (value.startsWith("十")) return 10 + (digits[value.slice(1)] ?? 0);
  if (value.endsWith("十")) return (digits[value[0]] ?? 0) * 10;
  if (value.includes("十")) return (digits[value[0]] ?? 0) * 10 + (digits[value[2]] ?? 0);
  return digits[value] ?? Number.NaN;
};

const parseTime = (text: string): { hour: number; minute: number; evidence: string } | null => {
  const clock = /(上午|早上|中午|下午|晚上|晚间)?\s*(\d{1,2})(?::|：)(\d{2})/.exec(text);
  if (clock) {
    let hour = Number(clock[2]);
    const meridiem = clock[1];
    if (meridiem && /下午|晚上|晚间/.test(meridiem) && hour < 12) hour += 12;
    if (meridiem === "中午" && hour < 11) hour += 12;
    return hour <= 23 && Number(clock[3]) <= 59
      ? { hour, minute: Number(clock[3]), evidence: clock[0] }
      : null;
  }
  const chinese = /(上午|早上|中午|下午|晚上|晚间)?\s*([零一二两三四五六七八九十\d]{1,3})\s*点(?:半|([零一二两三四五六七八九十\d]{1,2})分?)?/.exec(text);
  if (!chinese) return null;
  let hour = parseChineseNumber(chinese[2]);
  const minute = chinese[3] === "半" ? 30 : chinese[3] ? parseChineseNumber(chinese[3]) : 0;
  if (/下午|晚上|晚间/.test(chinese[1] ?? "") && hour < 12) hour += 12;
  if (chinese[1] === "中午" && hour < 11) hour += 12;
  return hour <= 23 && minute <= 59 ? { hour, minute, evidence: chinese[0] } : null;
};

const parseDate = (text: string, now: Date): { date: Date; evidence: string } | null => {
  const absolute = /(20\d{2})\s*[年/-]\s*(\d{1,2})\s*[月/-]\s*(\d{1,2})\s*日?/.exec(text);
  const current = partsInShanghai(now);
  if (absolute) {
    const date = shanghaiDate(Number(absolute[1]), Number(absolute[2]), Number(absolute[3]), 0, 0);
    return Number.isFinite(date.getTime()) ? { date, evidence: absolute[0] } : null;
  }
  const monthDay = /(?<!\d)(\d{1,2})\s*[月/-]\s*(\d{1,2})\s*日?/.exec(text);
  if (monthDay) {
    const date = shanghaiDate(Number(current.year), Number(monthDay[1]), Number(monthDay[2]), 0, 0);
    return Number.isFinite(date.getTime()) ? { date, evidence: monthDay[0] } : null;
  }
  const relative = /(今天|明天|后天)/.exec(text);
  if (relative) {
    const offset = relative[1] === "今天" ? 0 : relative[1] === "明天" ? 1 : 2;
    return { date: addDays(dateOnlyFromParts(now), offset), evidence: relative[0] };
  }
  const weekday = /(本周|这周|下周)\s*([一二三四五六日天])/.exec(text);
  if (weekday) {
    const today = dateOnlyFromParts(now);
    const normalizedToday = weekdayInShanghai(now);
    const target = WEEKDAYS[weekday[2]];
    const mondayDelta = normalizedToday === 0 ? -6 : 1 - normalizedToday;
    const weekOffset = weekday[1] === "下周" ? 7 : 0;
    const targetOffset = target === 0 ? 6 : target - 1;
    return { date: addDays(today, mondayDelta + targetOffset + weekOffset), evidence: weekday[0] };
  }
  return null;
};

const inferTitle = (text: string): string => {
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "新任务";
  return firstLine
    .replace(/^(通知|提醒|任务|作业)\s*[:：-]?\s*/i, "")
    .replace(/(截止|ddl|请于|完成于).*$/i, "")
    .trim() || "新任务";
};

export const parseAssistantMessage = ({ text, now = new Date(), courseNames = [] }: AssistantParseInput): AssistantDraft => {
  const sourceText = text.trim();
  const evidence: string[] = [];
  const warnings: string[] = [];
  const missingFields: string[] = [];
  const type: AssistantTaskType = /(会议|参加|开始|上课|签到|活动)/i.test(sourceText) && !/(提交|截止|完成|DDL|交作业)/i.test(sourceText) ? "fixed" : "deadline";
  const parsedDate = parseDate(sourceText, now);
  const parsedTime = parseTime(sourceText);
  if (parsedDate) evidence.push(parsedDate.evidence);
  if (parsedTime) evidence.push(parsedTime.evidence);
  const locationMatch = /(?:地点|教室|位置|会议室)\s*[:：]\s*([^，,。\n]+)/.exec(sourceText);
  const location = locationMatch?.[1]?.trim() ?? "";
  if (locationMatch) evidence.push(locationMatch[0]);
  const normalizedCourseNames = [...courseNames].filter(Boolean).sort((a, b) => b.length - a.length);
  const courseName = normalizedCourseNames.find((name) => sourceText.includes(name)) ?? "";
  if (courseName) evidence.push(courseName);
  const durationMatch = /(?:耗时|用时|预计)\s*(\d{1,3})\s*(分钟|分|小时|时)/.exec(sourceText);
  const timeNeededMinutes = durationMatch ? Number(durationMatch[1]) * (/小时|时/.test(durationMatch[2]) ? 60 : 1) : 60;
  if (durationMatch) evidence.push(durationMatch[0]);
  if (!parsedDate) missingFields.push("日期");
  if (!sourceText) missingFields.push("消息内容");
  if (parsedDate && !parsedTime) warnings.push("未识别到具体时间，已使用 09:00 作为暂定时间。");
  let startAt: string | null = null;
  let endAt: string | null = null;
  if (parsedDate) {
    const dateParts = partsInShanghai(parsedDate.date);
    const end = shanghaiDate(Number(dateParts.year), Number(dateParts.month), Number(dateParts.day), parsedTime?.hour ?? 9, parsedTime?.minute ?? 0);
    const start = type === "deadline" ? new Date(end.getTime() - timeNeededMinutes * 60000) : end;
    startAt = start.toISOString();
    endAt = type === "fixed" ? new Date(end.getTime() + timeNeededMinutes * 60000).toISOString() : end.toISOString();
  }
  const confidence = missingFields.length > 0 ? "low" : parsedTime && (courseName || location) ? "high" : "medium";
  return {
    sourceText,
    title: inferTitle(sourceText),
    description: sourceText,
    type,
    startAt,
    endAt,
    timeNeededMinutes: Number.isFinite(timeNeededMinutes) && timeNeededMinutes > 0 ? timeNeededMinutes : 60,
    location,
    courseName,
    confidence,
    missingFields,
    warnings,
    evidence
  };
};
