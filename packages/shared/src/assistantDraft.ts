/**
 * AI 助手草稿/提交边界共享逻辑（ADR-0004 §7）。
 *
 * 把"结构化抽取 envelope → 可编辑草稿 → 提交任务"的纯函数集中在这里，
 * 供 AI 助手视图与日程视图的"通知 → AI 提取进日程"共用同一 commit 边界：
 * source fingerprints 本地生成、原始文本不入库、重复创建由 Schedule 去重。
 */

import type {
  AiAssistantExtractionIntent,
  AiAssistantSettingsRecord,
  LocalTaskInput,
  LocalTaskRecord
} from "./pluginCapabilities";

export interface EditableIntent {
  id: string;
  intent: AiAssistantExtractionIntent["intent"];
  kind: AiAssistantExtractionIntent["kind"];
  title: string;
  description: string;
  deadlineAt: string;
  startAt: string;
  endAt: string;
  durationMinutes: string;
  location: string;
  courseName: string;
  fingerprint: string;
  needsConfirmation: boolean;
}

const shanghaiParts = (value: Date): Record<string, string> => Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
);

export const toDateTimeInput = (value: string | null): string => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = shanghaiParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

export const fromDateTimeInput = (value: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("请补充有效的日期和时间。");
  const parsed = new Date(`${value}:00+08:00`);
  if (!Number.isFinite(parsed.getTime())) throw new Error("请补充有效的日期和时间。");
  return parsed.toISOString();
};

export const toEditable = (intent: AiAssistantExtractionIntent): EditableIntent => ({
  id: intent.id,
  intent: intent.intent,
  kind: intent.kind,
  title: intent.title.value,
  description: intent.description.value,
  deadlineAt: toDateTimeInput(intent.deadlineAt.value),
  startAt: toDateTimeInput(intent.startAt.value),
  endAt: toDateTimeInput(intent.endAt.value),
  durationMinutes: intent.durationMinutes.value === null ? "" : String(intent.durationMinutes.value),
  location: intent.location.value ?? "",
  courseName: intent.courseName.value ?? "",
  fingerprint: intent.fingerprint,
  needsConfirmation: [intent.title, intent.description, intent.deadlineAt, intent.startAt, intent.endAt, intent.durationMinutes, intent.location, intent.courseName].some((field) => field.needsConfirmation)
});

const normalizeTitle = (value: string): string => value.trim().toLocaleLowerCase();

export const findUniqueTask = (tasks: LocalTaskRecord[], intent: EditableIntent): LocalTaskRecord => {
  const title = normalizeTitle(intent.title);
  const course = intent.courseName.trim();
  const candidates = tasks.filter((task) => {
    if (task.status === "deleted" || task.type === "fixedlegacy") return false;
    if (title && normalizeTitle(task.title) !== title) return false;
    if (course && task.courseName !== course) return false;
    return true;
  });
  if (candidates.length !== 1) throw new Error(candidates.length === 0 ? "没有找到可唯一匹配的已有任务。" : "找到多个可能的已有任务，请把标题或课程补充得更明确。");
  return candidates[0];
};

export const makeTaskInput = (editable: EditableIntent, settings: AiAssistantSettingsRecord): LocalTaskInput => {
  if (!editable.title.trim()) throw new Error("请填写事项标题。");
  const duration = editable.durationMinutes.trim() ? Number(editable.durationMinutes) : 60;
  if (!Number.isInteger(duration) || duration < 1 || duration > 10_080) throw new Error("预计耗时必须是 1 到 10080 分钟。");
  let startAt = editable.startAt ? fromDateTimeInput(editable.startAt) : "";
  let endAt = editable.endAt ? fromDateTimeInput(editable.endAt) : "";
  const deadline = editable.deadlineAt ? fromDateTimeInput(editable.deadlineAt) : "";
  if (editable.kind === "deadline" || editable.kind === "reminder") {
    endAt = deadline || endAt;
    if (!endAt) throw new Error("截止事项需要补充截止时间。");
    if (!startAt) startAt = new Date(Date.parse(endAt) - duration * 60_000).toISOString();
  } else {
    if (!startAt) throw new Error("固定安排需要补充开始时间。");
    if (!endAt) endAt = new Date(Date.parse(startAt) + duration * 60_000).toISOString();
  }
  if (!Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(endAt)) || Date.parse(endAt) <= Date.parse(startAt)) throw new Error("结束时间必须晚于开始时间。");
  return {
    title: editable.title.trim(),
    description: editable.description.trim(),
    timeSpentMinutes: 0,
    timeNeededMinutes: duration,
    startAt,
    endAt,
    location: editable.location.trim(),
    breakable: true,
    type: editable.kind === "event" ? "fixed" : "deadline",
    repeatType: "norepeat",
    repeatPeriod: 1,
    repeatEndsOn: endAt.slice(0, 10),
    blocksPlanning: true,
    courseName: editable.courseName.trim() || null,
    source: { kind: "ai-assistant", fingerprint: editable.fingerprint, provider: settings.provider, model: settings.model, importedAt: new Date().toISOString() }
  };
};
