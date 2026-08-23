/**
 * Campus-feed AI extraction prompt and structured-output schema.
 *
 * Mirrors the daily-brief envelope pattern (system prompt + JSON Schema via the
 * shared AI provider adapter, ADR-0004 structured generation).
 */

export const CAMPUS_FEED_PROMPT_VERSION = "campus-feed-schedule-v1";

export const CAMPUS_FEED_SYSTEM_PROMPT = [
  "你是浙江大学校园通知的日程提取器。",
  "从给定的校园通知中提取可以安排进日程的事件：评选答辩、报名/材料截止、活动举办、讲座、考试、领奖等。",
  "只输出有明确时间信息的事件；通知里没有明确具体时间的不输出。",
  "时间一律使用 +08:00（北京时间）的 ISO 8601 格式，如 2026-09-20T14:00:00+08:00；通知只写了日期没写时刻时，报名截止类取当天 23:59，活动类取当天 09:00 开始、默认持续 2 小时。",
  "type 字段：报名/材料/评选材料提交等以截止为关键时间点的用 deadline（截止时刻填入 startAt，endAt 与 startAt 相同）；答辩、讲座、活动、演出等有具体时段或用时段的用 fixed。",
  "title 用通顺的中文短标题（去掉通知编号和“关于/开展”等套话，例如“尚德学子奖学金申报截止”），不超过 60 字。",
  "location 与 note 没有就填 null。"
].join("\n");

export const CAMPUS_FEED_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          itemId: { type: "string" },
          title: { type: "string" },
          startAt: { type: "string" },
          endAt: { type: ["string", "null"] },
          location: { type: ["string", "null"] },
          note: { type: ["string", "null"] },
          type: { type: "string", enum: ["deadline", "fixed"] }
        },
        required: ["itemId", "title", "startAt", "endAt", "type"]
      }
    }
  },
  required: ["candidates"]
};
