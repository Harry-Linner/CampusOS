import { describe, expect, it } from "vitest";
import { parseAssistantMessage } from "../../../../../plugins/official/ai-assistant/src/assistantParser";

const now = new Date("2026-08-05T02:00:00.000Z");

describe("parseAssistantMessage", () => {
  it("parses absolute Chinese dates, time, location, and course evidence", () => {
    const result = parseAssistantMessage({
      now,
      courseNames: ["绩效管理", "管理学"],
      text: "绩效管理作业请于 2026年8月10日晚上八点前提交，地点：管理学院"
    });
    expect(result.type).toBe("deadline");
    expect(result.courseName).toBe("绩效管理");
    expect(result.location).toBe("管理学院");
    expect(result.missingFields).toEqual([]);
    expect(result.endAt).toBe("2026-08-10T12:00:00.000Z");
  });

  it("resolves relative dates and fixed arrangements", () => {
    const result = parseAssistantMessage({
      now,
      text: "明天晚上八点参加班会，会议室：A201"
    });
    expect(result.type).toBe("fixed");
    expect(result.startAt).toBe("2026-08-06T12:00:00.000Z");
    expect(result.endAt).toBe("2026-08-06T13:00:00.000Z");
  });

  it("resolves 本周 weekday and reports missing dates", () => {
    const weekly = parseAssistantMessage({ now, text: "本周五提交读书报告" });
    expect(weekly.endAt).toBe("2026-08-07T01:00:00.000Z");
    expect(weekly.warnings).toHaveLength(1);

    const incomplete = parseAssistantMessage({ now, text: "请完成课程作业" });
    expect(incomplete.missingFields).toContain("日期");
    expect(incomplete.startAt).toBeNull();
  });
});
