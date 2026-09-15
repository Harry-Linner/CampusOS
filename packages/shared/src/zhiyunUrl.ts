/**
 * 智云课堂 (Zhiyun Classroom) URL 构造工具。
 *
 * 浙大教务课表与智云是两套异构 ID：教务只有课程名与教师，智云要 `course_id` +
 * `sub_id` 才能直达某一次课的回放。本模块只负责**已经拿到 ID 之后**的地址拼接：
 * Tier 1: 用户自定义地址，或 (course_id + sub_id) 直达回放
 *         (interactivemeta.cmc.zju.edu.cn/#/replay?course_id=...&sub_id=...&tenant_code=112)
 * Tier 2: 仅有 course_id 时直达课程专页 (classroom.zju.edu.cn/coursedetail?course_id=...)
 *         ——该页列出这门课的全部节次，用户可自行挑，不会指错到别的课。
 * Tier 3: 什么都没有时回智云课堂门户 (classroom.zju.edu.cn/)
 *
 * **刻意不做「课程名全站搜索」兜底**：智云的 `/searchContent` 是平台级搜索，上游经常
 * 返回 0 条（社区实现 zju-scholar 的 CLI 帮助里明确写着"全站搜索当前平台下可能为空"）。
 * 把用户送进一个 0 结果的检索页既没有价值，又会掩盖真正的解析失败——课名对应不上时
 * 应当暴露出来，而不是假装打开了什么。
 */

export interface ZhiyunCourseParams {
  customUrl?: string | null;
  courseId?: string | number | null;
  subId?: string | number | null;
  tenantCode?: string | number | null;
}

/**
 * 只有完整的 http(s) 绝对地址才允许作为外跳地址。
 * 早期的 `startsWith("http")` 会放过 `httpevil://...` 这类自定义协议。
 */
export const isOpenableExternalUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.length > 0;
  } catch {
    return false;
  }
};

export const resolveZhiyunCourseUrl = (params: ZhiyunCourseParams = {}): string => {
  if (isOpenableExternalUrl(params.customUrl)) {
    return params.customUrl.trim();
  }

  const tenantCode = params.tenantCode ? String(params.tenantCode).trim() : "112";
  const courseId = params.courseId ? String(params.courseId).trim() : "";
  const subId = params.subId ? String(params.subId).trim() : "";

  // Tier 1: 具有 course_id 与 sub_id 时直达录播回放
  if (courseId && subId) {
    return `https://interactivemeta.cmc.zju.edu.cn/#/replay?course_id=${encodeURIComponent(courseId)}&sub_id=${encodeURIComponent(subId)}&tenant_code=${encodeURIComponent(tenantCode)}`;
  }

  // Tier 2: 仅有 course_id 时直达课程专页（列出该课程的全部节次）
  if (courseId) {
    return `https://classroom.zju.edu.cn/coursedetail?course_id=${encodeURIComponent(courseId)}&tenant_code=${encodeURIComponent(tenantCode)}`;
  }

  // Tier 3: 没有任何可用 ID 时回门户
  return "https://classroom.zju.edu.cn/";
};
