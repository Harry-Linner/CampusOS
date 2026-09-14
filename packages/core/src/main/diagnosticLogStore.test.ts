import { describe, expect, it } from "vitest";
import { sanitizeDiagnosticText } from "./diagnosticSanitizer";
import { buildSourceFailureSummary } from "./diagnosticLogStore";
import type { DiagnosticEntry } from "../shared/diagnosticBridge";

describe("diagnostic log sanitizer", () => {
  it("removes credentials, account identifiers and URL query values", () => {
    const sanitized = sanitizeDiagnosticText(
      "password=secret Cookie:SESSION=abc session=xyz ticket=ST-private " +
        "token=bearer https://zju.edu.cn/callback?ticket=ST-private&uid=3240100001 " +
        "account 3240100001"
    );

    for (const privateValue of [
      "secret",
      "SESSION=abc",
      "xyz",
      "ST-private",
      "bearer",
      "3240100001",
      "?ticket="
    ]) {
      expect(sanitized).not.toContain(privateValue);
    }
    expect(sanitized).toContain("https://zju.edu.cn/callback");
    expect(sanitized).toContain("<已隐藏>");
    expect(sanitized).toContain("<账号已隐藏>");
  });
});

describe("buildSourceFailureSummary（连接器健康台账汇总）", () => {
  const entry = (
    overrides: Partial<DiagnosticEntry>
  ): DiagnosticEntry => ({
    id: "id",
    timestamp: "2026-07-19T04:00:00.000Z",
    module: "zju-undergraduate",
    operation: "refresh",
    state: "live",
    durationMs: 100,
    errorCategory: null,
    message: null,
    requestFingerprint: null,
    retryClassification: null,
    upstreamChange: false,
    ...overrides
  });

  it("统计 retryable/fatal 失败与指纹变化", () => {
    const entries = [
      entry({ id: "a", state: "unavailable", retryClassification: "retryable", message: "timeout" }),
      entry({ id: "b", state: "unavailable", retryClassification: "fatal", message: "bad credentials" }),
      entry({ id: "c", state: "unavailable", retryClassification: "retryable", requestFingerprint: "fp-2", upstreamChange: true }),
      entry({ id: "d", state: "live", requestFingerprint: "fp-2" })
    ];

    const summary = buildSourceFailureSummary(entries);
    const source = summary["zju-undergraduate"];

    expect(source.totalRuns).toBe(4);
    expect(source.unavailableRuns).toBe(3);
    expect(source.liveRuns).toBe(1);
    expect(source.retryableFailures).toBe(2);
    expect(source.fatalFailures).toBe(1);
    expect(source.upstreamChangeCount).toBe(1);
    expect(source.lastFingerprint).toBe("fp-2");
    expect(source.lastStatus).toBe("live");
  });

  it("按 module 分组统计", () => {
    const entries = [
      entry({ module: "zju-undergraduate", state: "live" }),
      entry({ module: "zju-calendar-config", state: "unavailable", retryClassification: "fatal" })
    ];
    const summary = buildSourceFailureSummary(entries);
    expect(Object.keys(summary).sort()).toEqual([
      "zju-calendar-config",
      "zju-undergraduate"
    ]);
    expect(summary["zju-calendar-config"].fatalFailures).toBe(1);
  });
});
