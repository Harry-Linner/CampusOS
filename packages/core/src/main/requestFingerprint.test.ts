import { describe, expect, it } from "vitest";
import { computeRequestFingerprint } from "./requestFingerprint";

describe("computeRequestFingerprint", () => {
  it("是稳定的：同一方法 + URL 产生相同指纹", () => {
    const url = "https://www.zju.edu.cn/english/19600/list.htm";
    expect(computeRequestFingerprint("GET", url)).toBe(
      computeRequestFingerprint("GET", url)
    );
  });

  it("方法或 URL 结构变化时指纹变化", () => {
    const url = "https://www.zju.edu.cn/english/19600/list.htm";
    const methodChanged = computeRequestFingerprint("POST", url);
    const urlChanged = computeRequestFingerprint(
      "GET",
      "https://www.zju.edu.cn/english/19700/list.htm"
    );
    const baseline = computeRequestFingerprint("GET", url);
    expect(methodChanged).not.toBe(baseline);
    expect(urlChanged).not.toBe(baseline);
  });

  it("表单字段名排序后参与指纹，字段值不参与", () => {
    const url = "https://zju.edu.cn/api/login";
    const withValues = computeRequestFingerprint("POST", url, [
      "username",
      "password"
    ]);
    const otherValues = computeRequestFingerprint("POST", url, [
      "password",
      "username"
    ]);
    const reordered = computeRequestFingerprint("POST", url, [
      "password",
      "username"
    ]);
    expect(withValues).toBe(reordered);
    expect(otherValues).toBe(reordered);
    // 字段名集合不同 → 指纹不同
    expect(
      computeRequestFingerprint("POST", url, ["username"])
    ).not.toBe(withValues);
  });

  it("输出不含任何 URL 参数值（脱敏）", () => {
    const fingerprint = computeRequestFingerprint(
      "GET",
      "https://zju.edu.cn/callback?ticket=ST-private&uid=3240100001"
    );
    expect(fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(fingerprint).not.toContain("ST-private");
    expect(fingerprint).not.toContain("3240100001");
  });

  it("非法 URL 时退化为方法 + 原始串", () => {
    const fingerprint = computeRequestFingerprint("GET", "not a url");
    expect(fingerprint).toMatch(/^[a-f0-9]{16}$/);
  });
});
