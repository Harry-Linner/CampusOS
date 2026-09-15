/**
 * 智云课堂（classroom.zju.edu.cn）课程条目匹配与「打开智云课堂」契约。
 *
 * 教务课表与智云课堂是两套异构 ID：教务只有课程名 + 教师，智云需要 `course_id` +
 * `sub_id` 才能直达回放页。本模块只做纯函数：把「智云课程条目」按课程名（可选教师）
 * 匹配成一条，再交给 `resolveZhiyunCourseUrl` 拼 Tier 1 回放地址。
 *
 * 匹配纪律：**只接受规范化后完全同名的课程**。智云里存在「操作系统」与「操作系统实验」
 * 这类前缀相同的课程，靠包含/前缀匹配会把学生送进错误的班；宁可判定未命中、回退到
 * 智云检索页，也不允许静默打开不相关的课堂。
 */
import { resolveZhiyunCourseUrl } from "./zhiyunUrl";

/** 浙大本科生智云租户，与智云登录桥、检索接口使用的 tenant_code 一致。 */
export const ZHIYUN_TENANT_CODE = "112";

export interface ZhiyunCourseEntry {
  courseId: string;
  subId: string;
  /** 智云课程标题（`get-my-course-*` 的 title）。 */
  courseName: string;
  /** 智云班级/课次标题（sub_title）。 */
  subTitle?: string | null;
  /** 智云任课教师（realname）。 */
  teacher?: string | null;
  /** 该课程所属租户；缺省按 `ZHIYUN_TENANT_CODE` 处理。 */
  tenantCode?: string | null;
  /**
   * 该条目来自哪一天的课表查询（`YYYY-MM-DD`）；月查询为 null。
   * 只在同日同名候选择近时使用。
   */
  observedDay?: string | null;
}

export interface ZhiyunCourseMatchInput {
  courseName: string;
  teacher?: string | null;
  /** 触发解析的课程开始时间（ISO）；用于并列候选择近。 */
  startAt?: string | null;
}

/**
 * 匹配结果。`entry` 是唯一确定的节次（可以直达回放页）；只有 `courseId` 时说明课程认准了、
 * 但节次定不下来，调用方应打开课程页让用户自己挑。
 */
export interface ZhiyunCourseResolution {
  entry: ZhiyunCourseEntry | null;
  courseId: string | null;
}

export interface ZhiyunClassroomOpenInput {
  courseName: string;
  teacher?: string | null;
  startAt?: string | null;
  /** 用户在个性化设置里配置的回放链接，优先级最高。 */
  customUrl?: string | null;
}

export interface ZhiyunClassroomOpenResult {
  ok: boolean;
  /** true 表示命中了该课程对应的智云班级（或用户自定义链接），false 表示回退。 */
  matched: boolean;
  url: string | null;
  /** 未命中或失败时给用户看的原因（不含账号等私有信息）。 */
  message?: string;
}

const normalizeName = (value: string): string =>
  value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

const normalizeTeacher = (value: string): string =>
  value.normalize("NFKC").replace(/[\s,，、;；]/g, "").toLowerCase();

const teacherMatches = (
  entry: ZhiyunCourseEntry,
  teacher: string | null | undefined
): boolean => {
  const expected = teacher ? normalizeTeacher(teacher) : "";
  const actual = entry.teacher ? normalizeTeacher(entry.teacher) : "";
  if (!expected || !actual) return false;
  return actual === expected || actual.includes(expected) || expected.includes(actual);
};

const dayDistance = (observedDay: string | null | undefined, startAt: string | null | undefined): number => {
  if (!observedDay || !startAt) return Number.POSITIVE_INFINITY;
  const observed = Date.parse(`${observedDay}T00:00:00+08:00`);
  const target = Date.parse(startAt);
  if (!Number.isFinite(observed) || !Number.isFinite(target)) return Number.POSITIVE_INFINITY;
  return Math.abs(observed - target);
};

/**
 * 在智云课程条目中找出与教务课程对应的那一条。
 *
 * 顺序：规范同名（唯一即命中）→ 教师消歧 → 观测日期择近；仍不唯一时不猜节次，
 * 只把同名候选共用的 `courseId` 交出去（调用方据此打开课程页，让用户自己挑）。
 *
 * 绝不"随便挑一条"：智云同一门课有多位教师、多个教学班，也有「操作系统」与
 * 「操作系统实验」这类前缀相同的课程，猜错会把学生送进别人的课堂。
 */
export const resolveZhiyunCourse = (
  entries: readonly ZhiyunCourseEntry[],
  input: ZhiyunCourseMatchInput
): ZhiyunCourseResolution => {
  const expected = normalizeName(input.courseName ?? "");
  if (!expected) return { entry: null, courseId: null };

  const sameName = entries.filter((entry) => normalizeName(entry.courseName ?? "") === expected);
  if (sameName.length === 0) return { entry: null, courseId: null };
  if (sameName.length === 1) return { entry: sameName[0], courseId: sameName[0].courseId };

  const byTeacher = sameName.filter((entry) => teacherMatches(entry, input.teacher));
  const candidates = byTeacher.length > 0 ? byTeacher : sameName;
  if (candidates.length === 1) return { entry: candidates[0], courseId: candidates[0].courseId };

  const dated = candidates
    .map((entry) => ({ entry, distance: dayDistance(entry.observedDay, input.startAt) }))
    .filter((candidate) => Number.isFinite(candidate.distance))
    .sort((left, right) => left.distance - right.distance);
  if (dated.length > 0 && (dated.length === 1 || dated[0].distance !== dated[1].distance)) {
    return { entry: dated[0].entry, courseId: dated[0].entry.courseId };
  }

  // 节次定不下来：只有同名候选共用同一个 course_id 时才交出它——同一个 course_id 意味着
  // 「就是这门课，只是不知道是哪一节」，打开课程页让学生自己挑是诚实的；多个 course_id
  // 说明连课程都没认准，不能给。
  const courseIds = new Set(sameName.map((entry) => entry.courseId));
  return { entry: null, courseId: courseIds.size === 1 ? sameName[0].courseId : null };
};

const SHANGHAI_DATE_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const UTC_DAY_KEY = (value: number): string => new Date(value).toISOString().slice(0, 10);

/** 某个时刻在上海时区下的日期键（`YYYY-MM-DD`）。 */
export const shanghaiDateKey = (value: Date): string => SHANGHAI_DATE_KEY.format(value);

/**
 * 点击那一节课所属上海周的逐天查询顺序：目标当天在最前，其余按与目标的天数差升序。
 *
 * 逐天查询是社区实现的既有做法（zju-learning-assistant 的 `get_range_subs`）。只有按天
 * 返回的条目才带得出「这一天」的 `sub_id`；月列表给不出节次精度，拿它猜 sub_id 会静默
 * 打开同一门课**别的周**的录像。
 */
export const zhiyunDayQueryPlan = (startAt: string): string[] => {
  const target = new Date(startAt);
  if (!Number.isFinite(target.getTime())) return [];

  // 取上海时区下的年月日，再放到 UTC 正午做周内偏移运算，避开本地时区与夏令时。
  const [year, month, day] = shanghaiDateKey(target).split("-").map(Number);
  const base = Date.UTC(year, month - 1, day, 12);
  const mondayIndex = (new Date(base).getUTCDay() + 6) % 7;
  const weekStart = base - mondayIndex * 86_400_000;
  const targetIndex = mondayIndex;

  return Array.from({ length: 7 }, (_, offset) => offset)
    .map((offset) => ({ offset, key: UTC_DAY_KEY(weekStart + offset * 86_400_000) }))
    .sort((left, right) => Math.abs(left.offset - targetIndex) - Math.abs(right.offset - targetIndex))
    .map((item) => item.key);
};

/** 智云回放页（Tier 1）地址；`tenant_code` 缺省用本科生租户。 */
export const buildZhiyunReplayUrl = (entry: ZhiyunCourseEntry): string =>
  resolveZhiyunCourseUrl({
    courseId: entry.courseId,
    subId: entry.subId,
    tenantCode: entry.tenantCode?.trim() || ZHIYUN_TENANT_CODE
  });

export { isOpenableExternalUrl, resolveZhiyunCourseUrl } from "./zhiyunUrl";

/**
 * 从上游课表事件的备注里取出教师名。
 *
 * 教务投影把教师塞在备注文本里（`教师：张三`），结构化字段并不承载教师；这里按
 * `extractMeetingNumber` 同款做法在消费端解析。只应传入**上游原始备注**：用户自定义
 * 备注会覆盖显示用 note，不应参与教师消歧。
 */
const TEACHER_NOTE_PATTERN = /教师\s*[：:]\s*([^\s,，;；、]+)/;

export const extractTeacherFromScheduleNote = (note?: string | null): string | null => {
  if (!note) return null;
  const teacher = TEACHER_NOTE_PATTERN.exec(note)?.[1]?.trim();
  return teacher ? teacher : null;
};
