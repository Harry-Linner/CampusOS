import { describe, expect, it } from "vitest";
import {
  invariantFailures,
  invariantsPass,
  registerInvariant,
  runInvariants
} from "./invariants";

describe("不变式注册表", () => {
  it("注册与运行：通过/失败/异常三类结果", async () => {
    registerInvariant("test-ok", "critical", () => null);
    registerInvariant("test-fail", "warning", () => "磁盘空间不足");
    registerInvariant("test-throw", "critical", () => {
      throw new Error("boom");
    });

    const results = await runInvariants();
    const byName = new Map(results.map((result) => [result.name, result]));

    expect(byName.get("test-ok")?.ok).toBe(true);
    expect(byName.get("test-fail")).toMatchObject({
      ok: false,
      severity: "warning",
      message: "磁盘空间不足"
    });
    expect(byName.get("test-throw")).toMatchObject({
      ok: false,
      message: "boom"
    });
    expect(invariantsPass(results)).toBe(false);
    expect(invariantFailures(results).map((result) => result.name).sort()).toEqual([
      "test-fail",
      "test-throw"
    ]);
  });

  it("全部通过时 invariantsPass 为 true", async () => {
    registerInvariant("test-all-ok", "critical", () => null);
    const results = await runInvariants();
    expect(invariantsPass(results.filter((result) => result.name === "test-all-ok"))).toBe(true);
  });

  it("拒绝重复注册与非法名称", () => {
    expect(() => registerInvariant("test-ok", "critical", () => null)).toThrow(
      "重复注册"
    );
    expect(() =>
      registerInvariant("Bad Name", "critical", () => null)
    ).toThrow("合法标识符");
  });
});
