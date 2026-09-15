/*
 * 「打开智云课堂」的解析与唤起。
 *
 * 教务课表只有课程名与教师，智云回放页要 `course_id` + `sub_id`。智云的节次级信息只有
 * 「按天」列表才给得出来（`get-my-course-day?day=YYYY-MM-DD` 返回那一天各次课的 `sub_id`），
 * 所以解析以**点击那天所属周的逐天查询**为主：目标当天优先，再按与目标的天数差扩散到整周，
 * 用条目自带的 `observedDay` 精确定位到用户点的那一节。
 *
 * 定位到节次之后还要问一次 `get-sub-info`：智云前端只在 `sub_status == 6`（回放已就绪）时
 * 才把用户送到 `#/replay`，否则回放页会显示「不在回放内」。这道判定必须有，否则点击一个
 * 还没有录像的节次只会看到一个放不出东西的页面。
 *
 * 为什么不拿月列表（`get-my-course-month`）猜节次：月列表不区分具体哪一天，同一门课多位教师、
 * 多个教学班时挑不出节次，硬挑会静默打开**同一门课别的周**的录像。月列表在本模块里只用于
 * 定位不到节次时确认 `course_id`，从而打开课程页（列出这门课的全部节次，由用户自己挑）。
 *
 * 查询结果按「查询键」缓存，避免连续点击重复打上游；失败不缓存，下次点击会重试。
 */
import { shell } from "electron";
import {
  buildZhiyunReplayUrl,
  isOpenableExternalUrl,
  resolveZhiyunCourse,
  resolveZhiyunCourseUrl,
  shanghaiDateKey,
  zhiyunDayQueryPlan,
  type ZhiyunClassroomOpenInput,
  type ZhiyunClassroomOpenResult,
  type ZhiyunCourseEntry
} from "@campusos/shared";
import { requestZjuZhiyunService } from "./academicCredentialStore";
import { parseZhiyunCourseListing, parseZhiyunSubInfo, type ZhiyunSubInfo } from "./zjuZhiyunApi";

const CACHE_TTL_MS = 10 * 60 * 1_000;
const MAX_COURSE_NAME_LENGTH = 200;
const MAX_TEACHER_LENGTH = 100;
const MAX_CUSTOM_URL_LENGTH = 2_000;

type ListingQuery = { kind: "day"; day: string } | { kind: "month"; month: string };

const listings = new Map<string, { fetchedAt: number; entries: ZhiyunCourseEntry[] }>();
const pendingListings = new Map<string, Promise<ZhiyunCourseEntry[]>>();
const subInfos = new Map<string, { fetchedAt: number; info: ZhiyunSubInfo }>();

const queryKey = (query: ListingQuery): string =>
  query.kind === "day" ? `day:${query.day}` : `month:${query.month}`;

export const parseZhiyunClassroomOpenInput = (value: unknown): ZhiyunClassroomOpenInput | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const courseName = typeof record.courseName === "string" ? record.courseName.trim() : "";
  if (!courseName || courseName.length > MAX_COURSE_NAME_LENGTH) return null;

  const teacher = typeof record.teacher === "string" && record.teacher.trim()
    ? record.teacher.trim().slice(0, MAX_TEACHER_LENGTH)
    : null;
  const startAt = typeof record.startAt === "string" && Number.isFinite(Date.parse(record.startAt))
    ? record.startAt
    : null;
  const customUrl = typeof record.customUrl === "string" && record.customUrl.trim()
    ? record.customUrl.trim().slice(0, MAX_CUSTOM_URL_LENGTH)
    : null;

  return { courseName, teacher, startAt, customUrl };
};

const loadListing = async (query: ListingQuery): Promise<ZhiyunCourseEntry[]> => {
  const key = queryKey(query);
  const cached = listings.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.entries;

  const inFlight = pendingListings.get(key);
  if (inFlight) return inFlight;

  const operation = requestZjuZhiyunService(
    query.kind === "day"
      ? { operation: "my-courses-day", day: query.day }
      : { operation: "my-courses-month", month: query.month }
  ).then((response) => {
    const entries = parseZhiyunCourseListing(response.body, query.kind === "day" ? query.day : null);
    listings.set(key, { fetchedAt: Date.now(), entries });
    return entries;
  });

  pendingListings.set(key, operation);
  try {
    return await operation;
  } finally {
    if (pendingListings.get(key) === operation) pendingListings.delete(key);
  }
};

/** 问一次节次的可播放性；回放页自己也是先问这个才决定跳不跳。 */
const loadSubInfo = async (entry: ZhiyunCourseEntry): Promise<ZhiyunSubInfo> => {
  const key = `${entry.courseId}:${entry.subId}`;
  const cached = subInfos.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.info;

  const response = await requestZjuZhiyunService({
    operation: "sub-info",
    courseId: entry.courseId,
    subId: entry.subId
  });
  const info = parseZhiyunSubInfo(response.body);
  subInfos.set(key, { fetchedAt: Date.now(), info });
  return info;
};

export const resolveZhiyunClassroomUrl = async (
  input: ZhiyunClassroomOpenInput
): Promise<{ url: string; matched: boolean; message?: string }> => {
  if (isOpenableExternalUrl(input.customUrl)) {
    return { url: input.customUrl.trim(), matched: true };
  }

  const courseName = input.courseName.trim();
  if (!courseName) {
    return {
      url: resolveZhiyunCourseUrl({}),
      matched: false,
      message: "该课程没有可用的名称，已打开智云课堂门户。"
    };
  }

  const matchInput = {
    courseName,
    teacher: input.teacher ?? null,
    startAt: input.startAt ?? null
  };

  let failure: string | null = null;
  let locatedCourseId: string | null = null;
  let locatedButUnplayable = false;

  // 第一步：按点击那天所属的上海周逐天查询，精确到节次，并确认这一节真的有回放。
  for (const day of input.startAt ? zhiyunDayQueryPlan(input.startAt) : []) {
    try {
      const entries = await loadListing({ kind: "day", day });
      const { entry } = resolveZhiyunCourse(entries, matchInput);
      if (!entry) continue;

      locatedCourseId = entry.courseId;
      const info = await loadSubInfo(entry);
      if (info.playable) {
        return { url: buildZhiyunReplayUrl(entry), matched: true };
      }

      // 节次认准了但这一节还没有回放：不再拿同一门课别的节次顶替，走课程页让用户自己挑。
      locatedButUnplayable = true;
      break;
    } catch (error) {
      failure = error instanceof Error ? error.message : "智云课堂查询失败。";
      break;
    }
  }

  // 第二步：节次定不下来时，用点击当月的列表确认课程自身的 course_id。
  // 这里**只取 course_id**，不采用月列表的 sub_id。
  if (!locatedCourseId && input.startAt) {
    const month = shanghaiDateKey(new Date(input.startAt)).slice(0, 7);
    try {
      const entries = await loadListing({ kind: "month", month });
      locatedCourseId = resolveZhiyunCourse(entries, matchInput).courseId;
    } catch (error) {
      failure ??= error instanceof Error ? error.message : "智云课堂查询失败。";
    }
  }

  if (locatedCourseId) {
    return {
      url: resolveZhiyunCourseUrl({ courseId: locatedCourseId }),
      matched: false,
      message: locatedButUnplayable
        ? "这一节还没有智云回放，已打开该课程页（列出全部节次，可换一节看）。"
        : "没有定位到这次课的智云节次，已打开该课程页（列出全部节次）。"
    };
  }

  return {
    url: resolveZhiyunCourseUrl({}),
    matched: false,
    message: failure
      ? `未能在智云课堂定位该课程（${failure}），已打开智云课堂门户。`
      : "未在智云课堂找到该课程，已打开智云课堂门户。"
  };
};

/** 解析并唤起系统默认浏览器；返回结果供界面如实提示。 */
export const openZhiyunClassroom = async (
  input: ZhiyunClassroomOpenInput
): Promise<ZhiyunClassroomOpenResult> => {
  const { url, matched, message } = await resolveZhiyunClassroomUrl(input);
  try {
    await shell.openExternal(url);
  } catch (error) {
    return {
      ok: false,
      matched,
      url,
      message: error instanceof Error ? error.message : "无法唤起系统默认浏览器。"
    };
  }
  return message ? { ok: true, matched, url, message } : { ok: true, matched, url };
};
