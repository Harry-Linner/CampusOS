import { describe, expect, it } from "vitest";
import { extractMeetingNumber } from "@campusos/shared";

describe("extractMeetingNumber", () => {
  it("extracts from prefix with colon and hyphens", () => {
    expect(extractMeetingNumber("讲座线上链接，腾讯会议：123-456-789，请准时参加")).toBe("123456789");
  });

  it("extracts from prefix with spaces", () => {
    expect(extractMeetingNumber("腾讯会议ID: 987 654 3210")).toBe("9876543210");
  });

  it("extracts from formatted number without prefix", () => {
    expect(extractMeetingNumber("线上参加：456-789-012")).toBe("456789012");
  });

  it("returns null when no meeting number is present", () => {
    expect(extractMeetingNumber("线下地点：紫金港校区海纳苑1幢101")).toBeNull();
    expect(extractMeetingNumber(null)).toBeNull();
  });
});
