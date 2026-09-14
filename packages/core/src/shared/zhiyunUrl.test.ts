import { describe, expect, it } from "vitest";
import { resolveZhiyunCourseUrl } from "@campusos/shared";

describe("resolveZhiyunCourseUrl", () => {
  it("returns user custom URL if provided and valid", () => {
    const custom = "https://interactivemeta.cmc.zju.edu.cn/#/replay?course_id=86110&sub_id=1966408&tenant_code=112";
    expect(resolveZhiyunCourseUrl({ customUrl: custom, courseName: "自动控制原理" })).toBe(custom);
  });

  it("returns Tier 1 direct replay URL when courseId and subId are provided", () => {
    expect(resolveZhiyunCourseUrl({ courseId: "86110", subId: "1966408", tenantCode: "112" })).toBe(
      "https://interactivemeta.cmc.zju.edu.cn/#/replay?course_id=86110&sub_id=1966408&tenant_code=112"
    );
  });

  it("returns Tier 2 course detail URL when only courseId is provided", () => {
    expect(resolveZhiyunCourseUrl({ courseId: "86110" })).toBe(
      "https://classroom.zju.edu.cn/coursedetail?course_id=86110&tenant_code=112"
    );
  });

  it("returns Tier 3 course keyword search URL when only courseName is provided (robust fallback)", () => {
    expect(resolveZhiyunCourseUrl({ courseName: "自动控制原理" })).toBe(
      `https://classroom.zju.edu.cn/v2/search?keyword=${encodeURIComponent("自动控制原理")}`
    );
  });

  it("falls back to Tier 4 home URL when no information is available", () => {
    expect(resolveZhiyunCourseUrl({})).toBe("https://classroom.zju.edu.cn/");
    expect(resolveZhiyunCourseUrl({ courseName: "   " })).toBe("https://classroom.zju.edu.cn/");
  });
});
