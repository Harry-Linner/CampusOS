import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItemRecord, LocalTaskInput } from "@campusos/shared";
import { createCampusFeedService, type CampusFeedService } from "./campusFeedService";
import {
  MVP_CAMPUS_FEED_SOURCES,
  feedSourceRequestFingerprint
} from "./campusFeedSources";
import type { AiProviderAdapter } from "./aiProviderAdapters";
import { createDatabaseService } from "./databaseService";

const temporaryDirectories: string[] = [];

let database: ReturnType<typeof createDatabaseService>;
let service: CampusFeedService;

const XGB_HTML = `
<ul class="news_list">
  <li class="news n1 clearfix"><span class="news_title"><a href="/2026/0526/c53397a3166736/page.htm" title="关于评选2024-2025学年浙江大学校友爱心励志奖学金的通知">关于评选…</a></span><span class="news_meta">2026-05-26</span></li>
  <li class="news n2 clearfix"><span class="news_title"><a href="/2026/0324/c53397a3143759/page.htm" title="关于做好浙江大学2026届优秀本科毕业生评选工作的通知">关于做好…</a></span><span class="news_meta">2026-03-24</span></li>
</ul>`;

const UG_HTML = `
<ul class="cg-news-list" id="arthd">
  <li><a href="/dwjlfwpt/2025/0925/c42976a3085718/page.htm" target="_blank" title="第四课堂修读方式">第四课堂修读方式</a><span class="art-date">2025-11-26</span></li>
</ul>`;

const createFetch = (htmlByUrl: Record<string, string>): typeof fetch =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (htmlByUrl[url] !== undefined) return new Response(htmlByUrl[url], { status: 200 });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

beforeEach(async () => {
  const root = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "campusos-feed-"));
  temporaryDirectories.push(root);
  database = createDatabaseService({ databasePath: join(root, "campusos.sqlite") });
});

afterEach(async () => {
  database.close();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("campusFeedService", () => {
  it("seeds the four MVP sources on first run and reports them in the snapshot", async () => {
    service = createCampusFeedService({ database, startScheduler: false });
    const snapshot = await service.getSnapshot();
    expect(snapshot.sources.map((source) => source.id)).toEqual([
      "xgb-pingjiang",
      "ugrs-dwjl",
      "zjutw-tzgg",
      "ckc-zxtz"
    ]);
    expect(snapshot.items).toEqual([]);
  });

  it("fetches a source, stores items, dedupes on refresh, and notifies once", async () => {
    const fetchFn = createFetch({
      "http://www.xgb.zju.edu.cn/53395/list.htm": XGB_HTML
    });
    const notify = vi.fn(async () => undefined);
    service = createCampusFeedService({ database, fetchFn, notify, startScheduler: false });

    const first = await service.refreshSource("xgb-pingjiang");
    expect(first).toHaveLength(2);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: "学工门户 · 评奖评优", actionTarget: "campus-feed" })
    );

    let snapshot = await service.getSnapshot();
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[0].state).toBe("new");
    expect(snapshot.lastRefresh["xgb-pingjiang"]).toBeTruthy();

    // Second refresh inserts nothing new and does not notify again.
    const second = await service.refreshSource("xgb-pingjiang");
    expect(second).toHaveLength(2);
    expect(notify).toHaveBeenCalledTimes(1);
    snapshot = await service.getSnapshot();
    expect(snapshot.items).toHaveLength(2);
  });

  it("marks items read through the snapshot", async () => {
    const fetchFn = createFetch({ "http://www.xgb.zju.edu.cn/53395/list.htm": XGB_HTML });
    service = createCampusFeedService({ database, fetchFn, startScheduler: false });
    await service.refreshSource("xgb-pingjiang");
    const ids = (await service.getSnapshot()).items.map((item) => item.id);
    await service.markRead(ids);
    const snapshot = await service.getSnapshot();
    expect(snapshot.items.every((item) => item.state === "read")).toBe(true);
  });

  it("validates item links against the owning source host and extraHosts", async () => {
    const fetchFn = createFetch({
      "https://ugrs.zju.edu.cn/dwjlfwpt/42976/list.htm": UG_HTML
    });
    service = createCampusFeedService({ database, fetchFn, startScheduler: false });
    await service.refreshSource("ugrs-dwjl");

    await expect(service.openExternal("https://ugrs.zju.edu.cn/dwjlfwpt/2025/0925/c42976a3085718/page.htm"))
      .resolves.toBeTruthy();
    await expect(service.openExternal("https://mp.weixin.qq.com/s/abc"))
      .resolves.toBeTruthy();
    await expect(service.openExternal("https://evil.example.com/x"))
      .rejects.toThrow(/不属于任何已订阅信息源/);
    await expect(service.openExternal("file:///etc/passwd"))
      .rejects.toThrow(/不属于任何已订阅信息源/);
  });

  it("updates interval and enabled state persistently", async () => {
    service = createCampusFeedService({ database, startScheduler: false });
    const updated = await service.updateSource("ckc-zxtz", { enabled: false, intervalMinutes: 180 });
    expect(updated.enabled).toBe(false);
    expect(updated.intervalMinutes).toBe(180);

    const second = createCampusFeedService({ database, startScheduler: false });
    const snapshot = await second.getSnapshot();
    const restored = snapshot.sources.find((source) => source.id === "ckc-zxtz");
    expect(restored?.enabled).toBe(false);
    expect(restored?.intervalMinutes).toBe(180);
  });

  it("clamps invalid intervals and rejects invalid patches", async () => {
    service = createCampusFeedService({ database, startScheduler: false });
    const clamped = await service.updateSource("ckc-zxtz", { intervalMinutes: 99999 });
    expect(clamped.intervalMinutes).toBe(1440);
    await expect(service.updateSource("ckc-zxtz", { intervalMinutes: -5 }))
      .resolves.toMatchObject({ intervalMinutes: 1 });
    await expect(service.updateSource("ckc-zxtz", { enabled: "yes" as unknown as boolean }))
      .rejects.toThrow(/订阅状态无效/);
    await expect(service.updateSource("missing", { enabled: false }))
      .rejects.toThrow(/订阅源不存在/);
  });

  it("removes a source and its stored items", async () => {
    const fetchFn = createFetch({ "http://www.xgb.zju.edu.cn/53395/list.htm": XGB_HTML });
    service = createCampusFeedService({ database, fetchFn, startScheduler: false });
    await service.refreshSource("xgb-pingjiang");
    await service.removeSource("xgb-pingjiang");
    const snapshot = await service.getSnapshot();
    expect(snapshot.sources.find((source) => source.id === "xgb-pingjiang")).toBeUndefined();
    expect(snapshot.items).toHaveLength(0);
  });

  it("refreshAll fetches every enabled source and tolerates failures", async () => {
    const fetchFn = createFetch({
      "http://www.xgb.zju.edu.cn/53395/list.htm": XGB_HTML,
      "https://ugrs.zju.edu.cn/dwjlfwpt/42976/list.htm": UG_HTML
    });
    service = createCampusFeedService({ database, fetchFn, startScheduler: false });
    await service.updateSource("zjutw-tzgg", { enabled: false });
    await service.refreshAll();
    const snapshot = await service.getSnapshot();
    expect(snapshot.items).toHaveLength(3);
    // ckc has no mock page -> 404, tolerated
    expect(snapshot.lastRefresh["ckc-zxtz"]).toBeUndefined();
  });

  it("propagates a fetch failure and schedules a retry without corrupting state", async () => {
    const failing = vi.fn(async () => new Response("boom", { status: 503 })) as unknown as typeof fetch;
    service = createCampusFeedService({ database, fetchFn: failing, startScheduler: false });
    await expect(service.refreshSource("ckc-zxtz")).rejects.toThrow(/503/);
    const snapshot = await service.getSnapshot();
    expect(snapshot.items).toHaveLength(0);
  });

  it("B4-1: writes a fingerprint ledger entry per refresh on success and failure", async () => {
    const xgb = MVP_CAMPUS_FEED_SOURCES.find((source) => source.id === "xgb-pingjiang")!;
    const fetchFn = createFetch({ "http://www.xgb.zju.edu.cn/53395/list.htm": XGB_HTML });
    const recordDiagnostic = vi.fn(async () => undefined);
    service = createCampusFeedService({ database, fetchFn, recordDiagnostic, startScheduler: false });
    await service.refreshSource("xgb-pingjiang");
    expect(recordDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        module: "xgb-pingjiang",
        operation: "refresh",
        state: "live",
        requestFingerprint: feedSourceRequestFingerprint(xgb)
      })
    );

    recordDiagnostic.mockClear();
    const failing = vi.fn(async () => new Response("boom", { status: 503 })) as unknown as typeof fetch;
    service = createCampusFeedService({ database, fetchFn: failing, recordDiagnostic, startScheduler: false });
    await expect(service.refreshSource("ckc-zxtz")).rejects.toThrow(/503/);
    const ckc = MVP_CAMPUS_FEED_SOURCES.find((source) => source.id === "ckc-zxtz")!;
    expect(recordDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        module: "ckc-zxtz",
        operation: "refresh",
        state: "unavailable",
        requestFingerprint: feedSourceRequestFingerprint(ckc),
        retryClassification: "retryable"
      })
    );
  });

  it("notifies subscribers after mutations", async () => {
    const fetchFn = createFetch({ "http://www.xgb.zju.edu.cn/53395/list.htm": XGB_HTML });
    service = createCampusFeedService({ database, fetchFn, startScheduler: false });
    const listener = vi.fn();
    service.subscribe(listener);
    await service.refreshSource("xgb-pingjiang");
    expect(listener).toHaveBeenCalledTimes(1);
    const snapshot = listener.mock.calls[0][0] as { items: unknown[] };
    expect(snapshot.items).toHaveLength(2);
  });

  describe("F0 data-layer fixes", () => {
    const makeItem = (
      seed: string,
      sourceId: string,
      title: string,
      publishedAt: string | null,
      fetchedAt: string
    ): FeedItemRecord => {
      const url = `https://test.local/${seed}/page.htm`;
      return {
        id: createHash("sha256").update(url).digest("hex"),
        sourceId,
        title,
        url,
        publishedAt,
        summary: null,
        contentHash: createHash("sha256").update(`${title}\n${url}`).digest("hex"),
        fetchedAt,
        state: "new" as const
      };
    };
    const hydrate = async (): Promise<void> => {
      await service.getSnapshot(); // seeds the four MVP sources
    };

    it("orders snapshot items by publishedAt desc with nulls last (F0-1)", async () => {
      service = createCampusFeedService({ database, startScheduler: false });
      await hydrate();
      const nowIso = new Date().toISOString();
      database.upsertCampusFeedItem(makeItem("a", "xgb-pingjiang", "旧通知", "2026-01-01T00:00:00.000Z", nowIso));
      database.upsertCampusFeedItem(makeItem("b", "xgb-pingjiang", "新通知", "2026-08-01T00:00:00.000Z", nowIso));
      database.upsertCampusFeedItem(makeItem("c", "xgb-pingjiang", "无日期", null, nowIso));
      const snapshot = await service.getSnapshot();
      expect(snapshot.items.map((item) => item.title)).toEqual(["新通知", "旧通知", "无日期"]);
    });

    it("resets an edited item to unread and notifies again (F0-3)", async () => {
      const listUrl = "http://www.xgb.zju.edu.cn/53395/list.htm";
      const edited = XGB_HTML.replace(
        "关于评选2024-2025学年浙江大学校友爱心励志奖学金的通知",
        "【已更新】关于评选2024-2025学年浙江大学校友爱心励志奖学金的通知"
      );
      let listCalls = 0;
      const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === listUrl) {
          listCalls += 1;
          return new Response(listCalls === 1 ? XGB_HTML : edited, { status: 200 });
        }
        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch;
      const notify = vi.fn(async () => undefined);
      service = createCampusFeedService({ database, fetchFn, notify, startScheduler: false });
      await service.refreshSource("xgb-pingjiang");
      await service.markRead((await service.getSnapshot()).items.map((item) => item.id));
      expect(notify).toHaveBeenCalledTimes(1);

      const again = await service.refreshSource("xgb-pingjiang");
      expect(again).toHaveLength(2);
      const snapshot = await service.getSnapshot();
      // The edited item is unread again; the unchanged one stays read.
      expect(snapshot.items.filter((item) => item.state === "new")).toHaveLength(1);
      expect(snapshot.items.filter((item) => item.title.includes("已更新"))[0].state).toBe("new");
      expect(notify).toHaveBeenCalledTimes(2);
    });

    it("caps the snapshot per source and drops items outside the time window (F0-2)", async () => {
      service = createCampusFeedService({ database, startScheduler: false });
      await hydrate();
      const recent = new Date().toISOString();
      const stale = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
      database.upsertCampusFeedItem(makeItem("stale", "xgb-pingjiang", "超窗老通知", "2026-01-01T00:00:00.000Z", stale));
      // exceed the per-source cap this source would return alone
      for (let i = 0; i < 205; i += 1) {
        database.upsertCampusFeedItem(makeItem(`cap-${i}`, "xgb-pingjiang", `窗口内通知 ${i}`, "2026-08-28T00:00:00.000Z", recent));
      }
      const snapshot = await service.getSnapshot();
      const titles = snapshot.items.map((item) => item.title);
      expect(titles).not.toContain("超窗老通知");
      expect(titles).toHaveLength(200); // per-source cap applies within the window
    });

    it("invokes onItemsRead when items are marked read (未读与通知中心打通)", async () => {
      const fetchFn = createFetch({ "http://www.xgb.zju.edu.cn/53395/list.htm": XGB_HTML });
      const onItemsRead = vi.fn(async () => undefined);
      service = createCampusFeedService({ database, fetchFn, onItemsRead, startScheduler: false });
      await service.refreshSource("xgb-pingjiang");
      const ids = (await service.getSnapshot()).items.map((item) => item.id);
      await service.markRead(ids);
      expect(onItemsRead).toHaveBeenCalledTimes(1);
    });
  });

  describe("AI schedule extraction", () => {
    const encrypt = (value: string): string => `enc:${value}`;
    const decrypt = (value: string): string => value.replace(/^enc:/, "");
    const adapter = (structured: unknown): AiProviderAdapter => ({
      profile: { provider: "deepseek", protocol: "openai-chat-completions", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
      supportsModelListing: true,
      listModels: vi.fn(async () => ["deepseek-chat", "deepseek-reasoner"]),
      generateStructured: vi.fn(async () => structured)
    });

    it("stores and loads the AI connection with an encrypted key", async () => {
      service = createCampusFeedService({ database, encryptSecret: encrypt, decryptSecret: decrypt, startScheduler: false });
      expect(await service.loadAiSettings()).toBeNull();
      const saved = await service.saveAiSettings({
        provider: "deepseek",
        protocol: "openai-chat-completions",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "sk-test"
      });
      expect(saved).toMatchObject({ provider: "deepseek", apiKeyConfigured: true });
      expect(await service.loadAiSettings()).toMatchObject({ model: "deepseek-chat", apiKeyConfigured: true });
      await expect(service.saveAiSettings(null)).resolves.toBeNull();
      expect(await service.loadAiSettings()).toBeNull();
    });

    it("tests the connection via model listing", async () => {
      const createAdapter = vi.fn(() => adapter({ candidates: [] }));
      service = createCampusFeedService({ database, createAdapter, startScheduler: false });
      const result = await service.testAiConnection({
        provider: "deepseek",
        protocol: "openai-chat-completions",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "sk-test"
      });
      expect(result.ok).toBe(true);
      expect(result.message).toContain("2");
    });

    it("extracts valid schedule candidates from stored items", async () => {
      const fetchFn = createFetch({ "http://www.xgb.zju.edu.cn/53395/list.htm": XGB_HTML });
      let targetItemId = "ANY";
      const adapterInstance = adapter({ candidates: [] });
      const createAdapter = vi.fn(() => adapterInstance);
      service = createCampusFeedService({ database, fetchFn, createAdapter, encryptSecret: encrypt, decryptSecret: decrypt, startScheduler: false });
      await service.saveAiSettings({ provider: "deepseek", protocol: "openai-chat-completions", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: "sk-test" });
      await service.refreshSource("xgb-pingjiang");
      targetItemId = (await service.getSnapshot()).items[0].id;
      (adapterInstance.generateStructured as ReturnType<typeof vi.fn>).mockResolvedValue({
        candidates: [
          {
            itemId: targetItemId,
            title: "尚德学子奖学金申报截止",
            startAt: "2026-09-20T23:59:00+08:00",
            endAt: "2026-09-20T23:59:00+08:00",
            location: null,
            note: null,
            type: "deadline"
          }
        ]
      });
      const candidates = await service.extractScheduleCandidates([targetItemId]);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        itemId: targetItemId,
        title: "尚德学子奖学金申报截止",
        type: "deadline"
      });
    });

    it("ignores candidates referencing unknown items", async () => {
      const fetchFn = createFetch({ "http://www.xgb.zju.edu.cn/53395/list.htm": XGB_HTML });
      const createAdapter = vi.fn(() => adapter({
        candidates: [{ itemId: "unknown", title: "x", startAt: "2026-09-20T23:59:00+08:00", endAt: null, type: "fixed" }]
      }));
      service = createCampusFeedService({ database, fetchFn, createAdapter, encryptSecret: encrypt, decryptSecret: decrypt, startScheduler: false });
      await service.saveAiSettings({ provider: "deepseek", protocol: "openai-chat-completions", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: "sk-test" });
      await service.refreshSource("xgb-pingjiang");
      const itemId = (await service.getSnapshot()).items[0].id;
      const candidates = await service.extractScheduleCandidates([itemId]);
      expect(candidates).toHaveLength(0);
    });

    it("throws when no AI connection is configured", async () => {
      service = createCampusFeedService({ database, startScheduler: false });
      await expect(service.extractScheduleCandidates(["a"])).rejects.toThrow(/AI 连接/);
    });

    it("imports candidates into the schedule store with dedupe fingerprints", async () => {
      const fetchFn = createFetch({ "http://www.xgb.zju.edu.cn/53395/list.htm": XGB_HTML });
      const savedInputs: LocalTaskInput[] = [];
      const saveTask = vi.fn(async (input: LocalTaskInput) => {
        savedInputs.push(input);
        return { created: 1, deduplicated: 0 };
      });
      service = createCampusFeedService({ database, fetchFn, saveTask, encryptSecret: encrypt, decryptSecret: decrypt, startScheduler: false });
      await service.saveAiSettings({ provider: "deepseek", protocol: "openai-chat-completions", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: "sk-test" });
      await service.refreshSource("xgb-pingjiang");
      const itemId = (await service.getSnapshot()).items[0].id;
      const result = await service.createScheduleTasks([
        { itemId, title: "奖学金申报截止", startAt: "2026-09-20T23:59:00+08:00", endAt: "2026-09-20T23:59:00+08:00", location: null, note: "材料交到学工办", type: "deadline" }
      ]);
      expect(result).toEqual({ created: 1, deduplicated: 0 });
      expect(savedInputs[0]).toMatchObject({
        title: "奖学金申报截止",
        description: "材料交到学工办",
        type: "deadline",
        source: { kind: "ai-assistant", fingerprint: `campus-feed:${itemId}` }
      });
    });
  });
});
