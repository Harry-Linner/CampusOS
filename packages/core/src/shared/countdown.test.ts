import { describe, expect, it } from "vitest";
import { formatCountdown } from "@campusos/shared";

describe("formatCountdown", () => {
  const baseTime = 1770000000000;

  it("returns 已完成 when completed is true", () => {
    expect(formatCountdown(new Date(baseTime + 100000).toISOString(), true, baseTime)).toBe("已完成");
  });

  it("returns 已截止 when time is in the past", () => {
    expect(formatCountdown(new Date(baseTime - 1000).toISOString(), false, baseTime)).toBe("已截止");
  });

  it("formats days and hours", () => {
    const target = new Date(baseTime + (2 * 24 + 3) * 3600 * 1000).toISOString();
    expect(formatCountdown(target, false, baseTime)).toBe("剩 2天3小时");
  });

  it("formats hours and minutes", () => {
    const target = new Date(baseTime + (3 * 3600 + 45 * 60) * 1000).toISOString();
    expect(formatCountdown(target, false, baseTime)).toBe("剩 3小时45分");
  });

  it("formats minutes only when under an hour", () => {
    const target = new Date(baseTime + 25 * 60 * 1000).toISOString();
    expect(formatCountdown(target, false, baseTime)).toBe("仅剩 25分钟");
  });
});
