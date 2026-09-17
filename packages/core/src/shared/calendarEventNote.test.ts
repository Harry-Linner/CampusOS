import { describe, expect, it } from "vitest";
import { resolveCalendarEventNote, resolveCourseEventDetails, isCalendarEventComplete } from "@campusos/shared";

describe("calendar description", () => {
  it("marks ended classes complete without confusing overdue assignments with submitted work", () => {
    const now = Date.parse("2026-09-17T02:00:00Z");
    expect(isCalendarEventComplete({ kind: "course", endAt: "2026-09-17T01:59:00Z" }, now)).toBe(true);
    expect(isCalendarEventComplete({ kind: "course", endAt: "2026-09-17T02:01:00Z" }, now)).toBe(false);
    expect(isCalendarEventComplete({ kind: "assignment", endAt: "2026-09-17T01:59:00Z" }, now)).toBe(false);
    expect(isCalendarEventComplete({ kind: "assignment", status: "completed" }, now)).toBe(true);
  });
  const saved = { note: "", reminderLeadMinutes: null, updatedAt: "2026-09-17T00:00:00Z" };
  it("keeps source description when only reminder/completion defaults exist", () => {
    expect(resolveCalendarEventNote("教师：测试教师", saved)).toBe("教师：测试教师");
  });
  it("uses the same edited description after source refresh, including explicit clearing", () => {
    expect(resolveCalendarEventNote("new source", { ...saved, note: "My description" })).toBe("My description");
    expect(resolveCalendarEventNote("new source", { ...saved, noteEdited: true })).toBe("");
  });
  it("separates full teacher metadata in older snapshots without deleting personal description", () => {
    expect(resolveCourseEventDetails({ note: "教师：张三、李四\n携带教材" })).toEqual({ instructor: "张三、李四", note: "携带教材" });
    expect(resolveCourseEventDetails({ note: "教师：张三" }, { ...saved, note: "教师：张三\n我的简介", noteEdited: true })).toEqual({ instructor: "张三", note: "我的简介" });
    expect(resolveCourseEventDetails({ instructor: "李四", note: null }, { ...saved, note: "我的简介", noteEdited: true })).toEqual({ instructor: "李四", note: "我的简介" });
  });
});
