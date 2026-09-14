import { describe, expect, it } from "vitest";
import type { FeedSourceDescriptor } from "@campusos/shared";
import { createFeedPreferences, readFeedPreferences, visibleFeedSources, validateFeedPreferences } from "./campusFeedStore";

const current: FeedSourceDescriptor = { id: "one", name: "新栏目", category: "general", tags: [], baseUrl: "https://official.example", listUrl: "https://official.example/current/list.htm", intervalMinutes: 60, enabled: true, ruleVersion: 2 };

describe("feed preferences independent from the official catalog", () => {
  it.each(["staff", "other"])("migrates removed identity %s without losing subscriptions", identity => {
    const state = createFeedPreferences([current], [current]);
    const restored = readFeedPreferences({ ...state, profile: { identity, college: "材料学院", interests: ["教务考试"] } }, [current]);
    expect(restored?.profile).toEqual({ identity: null, college: "材料学院", interests: ["教务考试"] });
    expect(restored?.subscriptions).toEqual(state.subscriptions);
    expect(restored?.onboarding).toBe(state.onboarding);
    expect(() => validateFeedPreferences({ profile: { identity, college: null, interests: [] }, selectedSourceIds: [] }, [current])).toThrow();
  });
  it("migrates corrected college names in persisted preferences without changing a user's nickname", () => {
    const catalog = [{ ...current, id: "lsi-tzgg", name: "生命科学研究院 · 科研通知" }, { ...current, id: "cmm-tzgg", name: "医学院 · 本科生通知" }];
    const state = createFeedPreferences(catalog, []);
    state.subscriptions["lsi-tzgg"].name = "生命科学学院 · 通知";
    state.subscriptions["cmm-tzgg"].name = "我关注的医学公告";
    const restored = readFeedPreferences(JSON.parse(JSON.stringify(state)), catalog)!;
    expect(visibleFeedSources(catalog, restored).map(s=>s.name)).toEqual(["生命科学研究院 · 科研通知", "我关注的医学公告"]);
  });
  it("starts unsubscribed with a pending introduction", () => {
    const state = createFeedPreferences([current], []);
    expect(state.onboarding).toBe("pending");
    expect(visibleFeedSources([current], state)[0].enabled).toBe(false);
  });
  it("migrates user choices but replaces outdated source rules", () => {
    const old = { ...current, enabled: false, intervalMinutes: 180, listUrl: "https://official.example/wrong" };
    const state = createFeedPreferences([current], [old], new Set([current.id]));
    expect(state.onboarding).toBe("existing");
    expect(visibleFeedSources([current], state)).toEqual([
      expect.objectContaining({ id: "one", enabled: false, intervalMinutes: 180, listUrl: current.listUrl })
    ]);
    expect(visibleFeedSources([current], createFeedPreferences([current], [old]))).toEqual([]);
  });
  it("keeps a removed source removed after serialization and allows restoring it", () => {
    const state = createFeedPreferences([current], []);
    state.subscriptions.one = { enabled: false, removed: true };
    const restored = JSON.parse(JSON.stringify(state));
    expect(visibleFeedSources([current], restored)).toEqual([]);
    restored.subscriptions.one = { enabled: true, removed: false };
    expect(visibleFeedSources([current], restored)[0].enabled).toBe(true);
  });
  it("rejects unknown source ids and invalid identity before anything is saved", () => {
    expect(() => validateFeedPreferences({ profile: { identity: "admin", college: null, interests: [] }, selectedSourceIds: [] }, [current])).toThrow();
    expect(() => validateFeedPreferences({ profile: { identity: null, college: null, interests: [] }, selectedSourceIds: ["foreign"] }, [current])).toThrow();
    expect(validateFeedPreferences({ profile: { identity: null, college: null, interests: [] }, selectedSourceIds: [], skip: true }, [current])).toMatchObject({ skip: true });
    expect(() => validateFeedPreferences({ profile: { identity: null, college: null, interests: [] }, selectedSourceIds: ["one"], disabledSourceIds: ["foreign"] }, [current])).toThrow();
  });
  it("rejects corrupt persisted health instead of showing a false success", () => {
    const state = createFeedPreferences([current], []);
    expect(readFeedPreferences({ ...state, health: { one: { status: "ok", attemptedAt: "not-a-date" } } }, [current])).toBeNull();
  });
  it("keeps newly introduced catalog sources in discovery until the user subscribes", () => {
    const state = createFeedPreferences([current], []);
    state.onboarding = "completed";
    const added = { ...current, id: "two", name: "新增栏目" };
    const restored = readFeedPreferences(state, [current, added]);
    expect(restored).not.toBeNull();
    expect(visibleFeedSources([current, added], restored!).map((source) => source.id)).toEqual(["one"]);
  });
  it("replaces exact obsolete built-in names while preserving genuine nicknames", () => {
    const renamed = [
      { ...current, id: "ugrs-dwjl", name: "本科生对外交流 · 国际项目" },
      { ...current, id: "mse-tzgg", name: "材料学院 · 党建通知" },
      { ...current, id: "zulg-tzgg", name: "后勤集团 · 日常通知" },
      { ...current, id: "physics-tzgg", name: "物理学院 · 科研动态" }
    ];
    const legacy = [
      { ...renamed[0], name: "本科生对外交流 · 通知", enabled: true },
      { ...renamed[1], name: "材料学院 · 通知公告", enabled: true },
      { ...renamed[2], name: "后勤集团 · 通知公告", enabled: true },
      { ...renamed[3], name: "我关注的物理消息", enabled: true }
    ];
    const state = createFeedPreferences(renamed, legacy, new Set(renamed.map((source) => source.id)));
    expect(visibleFeedSources(renamed, state).map((source) => source.name)).toEqual([
      "本科生对外交流 · 国际项目",
      "材料学院 · 党建通知",
      "后勤集团 · 日常通知",
      "我关注的物理消息"
    ]);
  });
});
