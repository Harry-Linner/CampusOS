import { describe, expect, it, vi } from "vitest";
import {
  combineRequestFingerprints,
  computeRequestFingerprint,
  createFingerprintCollector,
  trackRefreshResultFingerprint
} from "./requestFingerprint";

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

describe("combineRequestFingerprints", () => {
  it("去空去重排序后稳定，且与输入顺序无关", () => {
    const a = computeRequestFingerprint("GET", "https://zju.edu.cn/a");
    const b = computeRequestFingerprint("POST", "https://zju.edu.cn/b", ["x"]);
    expect(combineRequestFingerprints([a, b, null, undefined, "", a])).toBe(
      combineRequestFingerprints([b, a])
    );
    expect(combineRequestFingerprints([a, b])).toMatch(/^[a-f0-9]{16}$/);
    expect(combineRequestFingerprints([a, b])).not.toBe(a);
    expect(combineRequestFingerprints([a, b])).not.toBe(b);
  });

  it("任一请求结构变化会使聚合结果变化", () => {
    const baseline = combineRequestFingerprints([
      computeRequestFingerprint("GET", "https://zju.edu.cn/a"),
      computeRequestFingerprint("POST", "https://zju.edu.cn/b", ["x"])
    ]);
    const changed = combineRequestFingerprints([
      computeRequestFingerprint("GET", "https://zju.edu.cn/a"),
      computeRequestFingerprint("POST", "https://zju.edu.cn/b", ["x", "y"])
    ]);
    expect(changed).not.toBe(baseline);
  });

  it("空输入返回 null", () => {
    expect(combineRequestFingerprints([])).toBeNull();
    expect(combineRequestFingerprints([null, undefined, ""])).toBeNull();
  });
});

describe("createFingerprintCollector", () => {
  it("add 忽略空值，combined 聚合全部有效指纹", () => {
    const collector = createFingerprintCollector();
    expect(collector.combined()).toBeNull();
    collector.add(null);
    collector.add(undefined);
    collector.add("");
    expect(collector.combined()).toBeNull();
    const a = computeRequestFingerprint("GET", "https://zju.edu.cn/a");
    collector.add(a);
    collector.add(a);
    expect(collector.combined()).toBe(
      combineRequestFingerprints([a])
    );
  });

  it("reset 清空已收集指纹", () => {
    const collector = createFingerprintCollector();
    collector.add(computeRequestFingerprint("GET", "https://zju.edu.cn/a"));
    expect(collector.combined()).not.toBeNull();
    collector.reset();
    expect(collector.combined()).toBeNull();
  });
});

describe("trackRefreshResultFingerprint", () => {
  it("运行前清空采集器，运行后把聚合指纹写入结果", async () => {
    const collector = createFingerprintCollector();
    collector.add("stale-from-previous-run");
    const tracked = trackRefreshResultFingerprint(collector, async () => {
      collector.add(computeRequestFingerprint("GET", "https://zju.edu.cn/a"));
      collector.add(computeRequestFingerprint("POST", "https://zju.edu.cn/b", ["x"]));
      return { sourceId: "test-source", status: "live" as const, updatedAt: "t" };
    });
    const result = await tracked();
    expect(result.requestFingerprint).toBe(
      combineRequestFingerprints([
        computeRequestFingerprint("GET", "https://zju.edu.cn/a"),
        computeRequestFingerprint("POST", "https://zju.edu.cn/b", ["x"])
      ])
    );
  });

  it("刷新未发起任何请求时写入 null", async () => {
    const collector = createFingerprintCollector();
    const tracked = trackRefreshResultFingerprint(collector, async () => ({
      sourceId: "test-source",
      status: "unavailable" as const,
      updatedAt: "t"
    }));
    await expect(tracked()).resolves.toEqual({
      sourceId: "test-source",
      status: "unavailable",
      updatedAt: "t",
      requestFingerprint: null
    });
  });

  it("job 抛错时向上传播且不吞掉结果", async () => {
    const collector = createFingerprintCollector();
    const tracked = trackRefreshResultFingerprint(
      collector,
      vi.fn(async () => {
        throw new Error("boom");
      })
    );
    await expect(tracked()).rejects.toThrow("boom");
  });
});
