import { describe, expect, it } from "vitest";
import { resolveZhiyunCourseUrl } from "@campusos/shared";

describe("resolveZhiyunCourseUrl", () => {
  it("returns user custom URL if provided and valid", () => {
    const custom = "https://interactivemeta.cmc.zju.edu.cn/#/replay?course_id=86110&sub_id=1966408&tenant_code=112";
    expect(resolveZhiyunCourseUrl({ customUrl: custom })).toBe(custom);
  });

  it("returns the direct replay URL when courseId and subId are provided", () => {
    expect(resolveZhiyunCourseUrl({ courseId: "86110", subId: "1966408", tenantCode: "112" })).toBe(
      "https://interactivemeta.cmc.zju.edu.cn/#/replay?course_id=86110&sub_id=1966408&tenant_code=112"
    );
  });

  it("returns the course detail URL when only courseId is provided", () => {
    expect(resolveZhiyunCourseUrl({ courseId: "86110" })).toBe(
      "https://classroom.zju.edu.cn/coursedetail?course_id=86110&tenant_code=112"
    );
  });

  it("falls back to the portal when no id is known", () => {
    expect(resolveZhiyunCourseUrl({})).toBe("https://classroom.zju.edu.cn/");
    expect(resolveZhiyunCourseUrl({ tenantCode: "112" })).toBe("https://classroom.zju.edu.cn/");
  });

  // 回归：智云平台级搜索在真实上游经常返回 0 条（社区实现 zju-scholar 的 CLI 帮助原文写着
  // 「全站搜索当前平台下可能为空」）。把用户送到一个 0 结果页既没有价值，又会掩盖真正的
  // 解析失败，所以任何输入都不允许再产出检索类地址。
  it("never produces a site-wide search URL", () => {
    const produced = [
      resolveZhiyunCourseUrl({}),
      resolveZhiyunCourseUrl({ tenantCode: "112" }),
      resolveZhiyunCourseUrl({ courseId: "86110" }),
      resolveZhiyunCourseUrl({ courseId: "86110", subId: "1966408" })
    ];
    for (const url of produced) {
      expect(url).not.toContain("searchContent");
      expect(url).not.toContain("globalSearch");
      expect(url).not.toContain("keyword=");
      expect(url).not.toContain("/v2/search");
    }
  });
});
