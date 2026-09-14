import { describe, expect, it } from "vitest";
import { normalizeCampusFeedAiInput } from "./campusFeedAi";
import { isCampusFeedScheduleCandidate } from "./campusFeedRules";

const allowed = new Set(["notice"]);
const text = "本科生请于2026年9月20日17:00前提交；研究生请于2026年9月21日17:00前提交。";
const valid = { itemId: "notice", title: "本科生提交材料", startAt: "2026-09-20T17:00:00+08:00", endAt: null, type: "deadline", evidence: "本科生请于2026年9月20日17:00前提交" };
describe("campus feed schedule evidence", () => {
  it("requires a real excerpt from the source body", () => {
    expect(isCampusFeedScheduleCandidate(valid, allowed, text)).toBe(true);
    expect(isCampusFeedScheduleCandidate({ ...valid, evidence: "学校要求明天交材料" }, allowed, text)).toBe(false);
    expect(isCampusFeedScheduleCandidate({ ...valid, evidence: undefined }, allowed, text)).toBe(false);
  });
  it("requires explicit timezones and chronological event boundaries", () => {
    expect(isCampusFeedScheduleCandidate({ ...valid, startAt: "2026-09-20" }, allowed, text)).toBe(false);
    expect(isCampusFeedScheduleCandidate({ ...valid, endAt: "2026-09-19T17:00:00+08:00" }, allowed, text)).toBe(false);
  });
  it("does not accept an unrelated notice id", () => {
    expect(isCampusFeedScheduleCandidate({ ...valid, itemId: "other" }, allowed, text)).toBe(false);
  });
  it("rejects unsafe or mismatched AI connection profiles before storing credentials", () => {
    expect(() => normalizeCampusFeedAiInput({ provider: "deepseek", protocol: "openai-chat-completions", baseUrl: "http://api.example.com/v1", model: "deepseek-chat", apiKey: "secret" })).toThrow(/HTTPS/);
    expect(() => normalizeCampusFeedAiInput({ provider: "deepseek", protocol: "gemini-generate-content", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: "secret" })).toThrow(/协议/);
  });
});
