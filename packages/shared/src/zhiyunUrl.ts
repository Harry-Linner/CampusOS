/**
 * 智云课堂 (Zhiyun Classroom) URL 解析工具。
 *
 * 浙大教务课表中的课程代码与智云内部课程 ID / 录播 sub_id 存在异构性。
 * 本工具提供四级鲁棒回退策略，确保用户点击后永不报 404 或白屏：
 * Tier 1: 用户自定义 / 显式回放地址 (interactivemeta.cmc.zju.edu.cn/#/replay?course_id=...&sub_id=...&tenant_code=112)
 * Tier 2: 课程专页 (classroom.zju.edu.cn/coursedetail?course_id=...&tenant_code=112)
 * Tier 3: 智云全局课程检索 (classroom.zju.edu.cn/v2/search?keyword=...) 100% 鲁棒兜底
 * Tier 4: 智云课堂主页 (classroom.zju.edu.cn/)
 */

export interface ZhiyunCourseParams {
  customUrl?: string | null;
  courseId?: string | number | null;
  subId?: string | number | null;
  courseName?: string | null;
  tenantCode?: string | number | null;
}

export const resolveZhiyunCourseUrl = (params: ZhiyunCourseParams = {}): string => {
  if (params.customUrl && typeof params.customUrl === "string" && params.customUrl.trim().startsWith("http")) {
    return params.customUrl.trim();
  }

  const tenantCode = params.tenantCode ? String(params.tenantCode).trim() : "112";
  const courseId = params.courseId ? String(params.courseId).trim() : "";
  const subId = params.subId ? String(params.subId).trim() : "";

  // Tier 1: 具有 course_id 与 sub_id 时直达录播回放
  if (courseId && subId) {
    return `https://interactivemeta.cmc.zju.edu.cn/#/replay?course_id=${encodeURIComponent(courseId)}&sub_id=${encodeURIComponent(subId)}&tenant_code=${encodeURIComponent(tenantCode)}`;
  }

  // Tier 2: 仅有 course_id 时直达课程专页
  if (courseId) {
    return `https://classroom.zju.edu.cn/coursedetail?course_id=${encodeURIComponent(courseId)}&tenant_code=${encodeURIComponent(tenantCode)}`;
  }

  // Tier 3: 仅有课程名称时，直达智云全局课程检索（列出所有班级录播，100% 可用）
  const courseName = params.courseName ? params.courseName.trim() : "";
  if (courseName) {
    return `https://classroom.zju.edu.cn/v2/search?keyword=${encodeURIComponent(courseName)}`;
  }

  // Tier 4: 首页兜底
  return "https://classroom.zju.edu.cn/";
};
