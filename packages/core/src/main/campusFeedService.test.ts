import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItemRecord, LocalTaskInput } from "@campusos/shared";
import { createCampusFeedService, type CampusFeedNotifyInput, type CampusFeedService } from "./campusFeedService";
import {
  feedSourceRequestFingerprint
} from "./campusFeedSources";
import { MVP_CAMPUS_FEED_SOURCES } from "./campusFeedSourceCatalog";
import type { AiProviderAdapter } from "./aiProviderAdapters";
import { createDatabaseService } from "./databaseService";
import { createTaskRecord } from "./scheduleDomain";

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
  <li><a href="/dwjlfwpt/2026/0123/c42921a3131212/page.htm" target="_blank" title="【选拔通知】2026-2027学年澳洲、美洲、亚洲高校交流项目">【选拔通知】2026-2027学年澳洲、美洲、亚洲高校交流项目</a><span class="art-date">2026-01-23</span></li>
</ul>`;
const EVIDENCE = "本科生请于2026年9月20日23:59前提交材料";
const DETAIL_TEXT = `${EVIDENCE}；研究生请于2026年9月21日23:59前提交材料。`;

const createFetch = (htmlByUrl: Record<string, string>): typeof fetch =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (htmlByUrl[url] !== undefined) return new Response(htmlByUrl[url], { status: 200 });
    if (url.startsWith("http://www.xgb.zju.edu.cn/2026/")) return new Response(`<div class="wp_articlecontent">${DETAIL_TEXT}</div>`);
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
  it("subscribes to xgb columns independently even when their article URLs are identical", async () => {
    service = createCampusFeedService({ database, startScheduler: false, fetchFn: createFetch({
      "http://www.xgb.zju.edu.cn/53018/list.htm": XGB_HTML,
      "http://www.xgb.zju.edu.cn/53395/list.htm": XGB_HTML,
      "http://www.xgb.zju.edu.cn/53396/list.htm": XGB_HTML
    }) });
    for (const id of ["xgb-zxtz", "xgb-pingjiang", "xgb-zizhu"]) {
      await service.addSource(id);
      await service.refreshSource(id);
    }
    const snapshot = await service.getSnapshot();
    expect(snapshot.items).toHaveLength(6);
    expect(new Set(snapshot.items.map(item => item.id)).size).toBe(6);
    const latest = snapshot.items.filter(item => item.sourceId === "xgb-zxtz");
    await service.markRead(latest.map(item => item.id));
    expect((await service.getSnapshot()).items.filter(item => item.sourceId !== "xgb-zxtz").every(item => item.state === "new")).toBe(true);
    await service.removeSource("xgb-zxtz");
    expect((await service.searchHistory({ query: "通知" })).total).toBe(4);
    await service.addSource("xgb-zxtz");
    expect((await service.getSnapshot()).items.filter(item => item.sourceId === "xgb-zxtz").every(item => item.state === "read")).toBe(true);
  });
  it("resumes historical pagination after restart and retries failures without notifying old entries", async () => {
    const list = "http://www.xgb.zju.edu.cn/53395/list.htm";
    const next = "http://www.xgb.zju.edu.cn/53395/list2.htm";
    let failHistory = true;
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === list) return new Response(`${XGB_HTML}<a href='/53395/list2.htm'>下一页</a>`);
      if (String(input) === next) {
        if (failHistory) throw new TypeError("offline");
        return new Response(XGB_HTML.replaceAll("2026", "2024").replaceAll("3166736", "1166736").replaceAll("3143759", "1143759"));
      }
      throw new Error("Unexpected non-list request");
    }) as typeof fetch;
    const notify = vi.fn(async () => undefined);
    const options = { database, fetchFn, notify, startScheduler: false, now: () => new Date("2026-09-13T00:00:00Z") };
    service = createCampusFeedService(options);
    await service.addSource("xgb-pingjiang");
    await service.refreshSource("xgb-pingjiang");
    expect(database.loadCampusFeedPreferences()).toMatchObject({ history: { "xgb-pingjiang": { nextUrl: next, complete: false } } });
    service = createCampusFeedService(options);
    await service.refreshSource("xgb-pingjiang");
    expect(database.loadCampusFeedPreferences()).toMatchObject({ history: { "xgb-pingjiang": { nextUrl: next, complete: false, pages: 1 } } });
    failHistory = false;
    await service.refreshSource("xgb-pingjiang");
    expect(database.loadCampusFeedPreferences()).toMatchObject({ history: { "xgb-pingjiang": { complete: true, pages: 2 } } });
    expect((await service.searchHistory({ query: "2024-03-24" })).total).toBe(1);
    expect(notify).not.toHaveBeenCalled();
  }, 15_000);

  it("uses the account-backed ITC transport for list and detail and persists real parsed results", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("anonymous transport must not receive ITC"); });
    const requestItcPage = vi.fn(async (url: string) => ({ status: 200, body: url.endsWith("list.psp") ? '<div class="col_news_list"><ul class="news_list"><li><span class="news_title"><a href="/2026/0901/c90618a1/page.htm">网络维护安排</a></span><span class="news_meta">2026-09</span></li></ul></div>' : '<div class="wp_articlecontent"><p>网络维护期间部分服务暂停，请提前保存工作。</p></div>' }));
    service = createCampusFeedService({ database, startScheduler: false, fetchFn, requestItcPage });
    await service.addSource("itc-tzgg");
    const items = await service.refreshSource("itc-tzgg");
    expect(items).toHaveLength(1);
    expect(items[0].publishedAt).toBeNull();
    expect(database.findCampusFeedItem(items[0].id)).toMatchObject({ title: "网络维护安排" });
    expect((await service.getItemDetail(items[0].id)).text).toContain("网络维护期间");
    expect(requestItcPage).toHaveBeenCalledWith(items[0].url);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reports ITC as restricted without stored account access instead of crawling login navigation", async () => {
    const fetchFn = vi.fn(async () => new Response("login navigation"));
    service = createCampusFeedService({ database, startScheduler: false, fetchFn });
    await service.addSource("itc-tzgg");
    await expect(service.refreshSource("itc-tzgg")).rejects.toMatchObject({ code: "restricted" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("shows the official catalog on first run without fetching before choosing subscriptions", async () => {
    service = createCampusFeedService({ database, startScheduler: false });
    const snapshot = await service.getSnapshot();
    // 原有 MVP 四源保留 + 新增默认源全部入库
    expect(snapshot.sources.map((source) => source.id)).toEqual(
      MVP_CAMPUS_FEED_SOURCES.map((source) => source.id)
    );
    expect(snapshot.sources.filter((source) => source.enabled)).toEqual([]);
    expect(snapshot.preferences?.onboarding).toBe("pending");
    expect(snapshot.catalog).toHaveLength(MVP_CAMPUS_FEED_SOURCES.length);
    expect(snapshot.items).toEqual([]);
  });

  it("clears legacy cache when a source id moves to a different semantic column", async () => {
    const current = MVP_CAMPUS_FEED_SOURCES.find((source) => source.id === "ugrs-dwjl")!;
    database.saveCampusFeedSource(current.id, {
      ...current,
      name: "本科生对外交流 · 通知",
      listUrl: "https://ugrs.zju.edu.cn/dwjlfwpt/42976/list.htm",
      enabled: true
    }, "2026-09-05T00:00:00.000Z");
    database.upsertCampusFeedItem({
      id: "legacy-faq",
      sourceId: current.id,
      title: "第四课堂修读方式",
      url: "https://ugrs.zju.edu.cn/dwjlfwpt/2025/0925/c42976a3085718/page.htm",
      publishedAt: "2025-11-26T00:00:00+08:00",
      summary: null,
      contentHash: "legacy",
      fetchedAt: "2026-09-05T00:00:00.000Z",
      state: "new"
    });
    service = createCampusFeedService({ database, startScheduler: false });
    expect((await service.getSnapshot()).items).toEqual([]);
    expect(database.findCampusFeedItem("legacy-faq")).toBeNull();
  });

  it("establishes a silent first-sync baseline and dedupes unchanged refreshes", async () => {
    const fetchFn = createFetch({
      "http://www.xgb.zju.edu.cn/53395/list.htm": XGB_HTML
    });
    const notify = vi.fn(async (input: CampusFeedNotifyInput) => { void input; });
    service = createCampusFeedService({ database, fetchFn, notify, startScheduler: false });

    const first = await service.refreshSource("xgb-pingjiang");
    expect(first).toHaveLength(2);
    expect(notify).not.toHaveBeenCalled();

    let snapshot = await service.getSnapshot();
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[0].state).toBe("new");
    expect(snapshot.lastRefresh["xgb-pingjiang"]).toBeTruthy();

    // Second refresh inserts nothing new and does not notify again.
    const second = await service.refreshSource("xgb-pingjiang");
    expect(second).toHaveLength(2);
    expect(notify).not.toHaveBeenCalled();
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

  it("syncs notification references whenever feed items are marked read", async () => {
    const fetchFn = createFetch({
      "http://www.xgb.zju.edu.cn/53395/list.htm": XGB_HTML,
      "https://ugrs.zju.edu.cn/dwjlfwpt/42921/list.htm": UG_HTML
    });
    const onItemsRead = vi.fn(async () => undefined);
    service = createCampusFeedService({ database, fetchFn, onItemsRead, startScheduler: false });
    await service.addSource("xgb-pingjiang");
    await service.addSource("ugrs-dwjl");
    await service.refreshSource("xgb-pingjiang");
    await service.refreshSource("ugrs-dwjl");
    const snapshot = await service.getSnapshot();
    const xgbIds = snapshot.items.filter((item) => item.sourceId === "xgb-pingjiang").map((item) => item.id);
    const ugrsIds = snapshot.items.filter((item) => item.sourceId === "ugrs-dwjl").map((item) => item.id);
    await service.markRead(xgbIds);
    expect(onItemsRead).toHaveBeenCalledWith(xgbIds);
    await service.markRead(ugrsIds);
    expect(onItemsRead).toHaveBeenCalledWith(ugrsIds);
    expect(onItemsRead).toHaveBeenCalledTimes(2);
  });

  it("marks more than 500 valid item ids without silently truncating the request", async () => {
    const mark = vi.spyOn(database, "markCampusFeedItemsRead");
    service = createCampusFeedService({ database, startScheduler: false });
    const ids = Array.from({ length: 501 }, (_, index) => `item-${index}`);
    await service.markRead(ids);
    expect(mark).toHaveBeenCalledWith(ids);
  });

  it("validates item links against the owning source host and extraHosts", async () => {
    const fetchFn = createFetch({
      "https://ugrs.zju.edu.cn/dwjlfwpt/42921/list.htm": UG_HTML
    });
    service = createCampusFeedService({ database, fetchFn, startScheduler: false });
    await service.refreshSource("ugrs-dwjl");

    await expect(service.openExternal("https://ugrs.zju.edu.cn/dwjlfwpt/2025/0925/c42976a3085718/page.htm"))
      .resolves.toBeTruthy();
    await expect(service.openExternal("https://mp.weixin.qq.com/s/abc"))
      .resolves.toBeTruthy();
    await expect(service.openExternal("https://evil.example.com/x"))
      .rejects.toThrow(/不属于任何校园信息源/);
    await expect(service.openExternal("file:///etc/passwd"))
      .rejects.toThrow(/不属于任何校园信息源/);
  });

  it("updates interval and enabled state persistently", async () => {
    service = createCampusFeedService({ database, startScheduler: false });
    const updated = await service.updateSource("ckc-zxtz", { enabled: false, intervalMinutes: 180, notificationEnabled: false });
    expect(updated.enabled).toBe(false);
    expect(updated.intervalMinutes).toBe(180);
    expect(updated.notificationEnabled).toBe(false);

    const second = createCampusFeedService({ database, startScheduler: false });
    const snapshot = await second.getSnapshot();
    const restored = snapshot.sources.find((source) => source.id === "ckc-zxtz");
    expect(restored?.enabled).toBe(false);
    expect(restored?.intervalMinutes).toBe(180);
    expect(restored?.notificationEnabled).toBe(false);
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

  it("hides a removed source, preserves read history, and restores it only on request", async () => {
    const fetchFn = createFetch({ "http://www.xgb.zju.edu.cn/53395/list.htm": XGB_HTML });
    service = createCampusFeedService({ database, fetchFn, startScheduler: false });
    await service.refreshSource("xgb-pingjiang");
    await service.markRead((await service.getSnapshot()).items.map((item) => item.id));
    await service.removeSource("xgb-pingjiang");
    const snapshot = await service.getSnapshot();
    expect(snapshot.sources.find((source) => source.id === "xgb-pingjiang")).toBeUndefined();
    expect(snapshot.items).toHaveLength(0);
    service = createCampusFeedService({ database, fetchFn, startScheduler: false });
    expect((await service.getSnapshot()).sources.some((source) => source.id === "xgb-pingjiang")).toBe(false);
    await service.addSource("xgb-pingjiang");
    expect((await service.getSnapshot()).items).toHaveLength(2);
    expect((await service.getSnapshot()).items.every((item) => item.state === "read")).toBe(true);
  });

  it("refreshAll keeps successful results and reports partial failures", async () => {
    const fetchFn = createFetch({
      "http://www.xgb.zju.edu.cn/53395/list.htm": XGB_HTML,
      "https://ugrs.zju.edu.cn/dwjlfwpt/42921/list.htm": UG_HTML
    });
    service = createCampusFeedService({ database, fetchFn, startScheduler: false });
    for (const id of ["xgb-pingjiang", "ugrs-dwjl", "ckc-zxtz"]) await service.addSource(id);
    await expect(service.refreshAll()).rejects.toThrow(/信息源刷新失败/);
    const snapshot = await service.getSnapshot();
    expect(snapshot.items).toHaveLength(3);
    // ckc has no mock page -> 404, tolerated
    expect(snapshot.lastRefresh["ckc-zxtz"]).toBeUndefined();
  });

  it("persists normalized global notification keywords", async () => {
    service = createCampusFeedService({ database, startScheduler: false });
    await expect(service.saveNotificationSettings({ keywords: [" Scholarship ", "scholarship", "讲座", ""] }))
      .resolves.toEqual({ keywords: ["Scholarship", "讲座"] });

    const restored = createCampusFeedService({ database, startScheduler: false });
    expect((await restored.getSnapshot()).notificationSettings).toEqual({ keywords: ["Scholarship", "讲座"] });
  });

  it("restores last refresh timestamps from the refresh-state table when preferences health is empty", async () => {
    database.saveCampusFeedRefreshState("xgb-pingjiang", "2026-09-10T08:00:00.000Z");
    service = createCampusFeedService({ database, startScheduler: false });

    await expect(service.getSnapshot()).resolves.toMatchObject({
      lastRefresh: { "xgb-pingjiang": "2026-09-10T08:00:00.000Z" }
    });
  });

  it("prunes removed sources from the visible last-refresh map while retaining their refresh baseline", async () => {
    database.saveCampusFeedRefreshState("xgb-pingjiang", "2026-09-10T08:00:00.000Z");
    service = createCampusFeedService({ database, startScheduler: false });
    await service.getSnapshot();

    const saved = await service.savePreferences({
      profile: { identity: null, college: null, interests: [] },
      selectedSourceIds: ["libweb-zy"]
    });
    expect(saved.lastRefresh["xgb-pingjiang"]).toBeUndefined();
    expect(database.loadCampusFeedRefreshState("xgb-pingjiang")).toBe("2026-09-10T08:00:00.000Z");
  });

  it("filters notifications by title or summary and honors each source notification switch", async () => {
    const listUrl = "http://www.xgb.zju.edu.cn/53395/list.htm";
    const matching = XGB_HTML.replace("关于评选2024-2025学年", "SCHOLARSHIP 关于评选2024-2025学年");
    const matchingAgain = matching.replace("SCHOLARSHIP 关于评选2024-2025学年", "Scholarship 更新 关于评选2024-2025学年");
    let listCalls = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== listUrl) return new Response("not found", { status: 404 });
      listCalls += 1;
      return new Response(listCalls === 1 ? XGB_HTML : listCalls === 2 ? matching : matchingAgain, { status: 200 });
    }) as unknown as typeof fetch;
    const notify = vi.fn(async (input: CampusFeedNotifyInput) => { void input; });
    service = createCampusFeedService({ database, fetchFn, notify, startScheduler: false });

    await service.refreshSource("xgb-pingjiang");
    await service.saveNotificationSettings({ keywords: ["scholarship"] });
    expect(notify).not.toHaveBeenCalled();
    await service.refreshSource("xgb-pingjiang");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].items).toHaveLength(1);

    await service.updateSource("xgb-pingjiang", { notificationEnabled: false });
    await service.refreshSource("xgb-pingjiang");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("emits one combined notification batch when refresh-all finds items in several sources", async () => {
    const xgbUrl = "http://www.xgb.zju.edu.cn/53395/list.htm";
    const ugrsUrl = "https://ugrs.zju.edu.cn/dwjlfwpt/42921/list.htm";
    let changed = false;
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === xgbUrl) return new Response(changed ? XGB_HTML.replace("关于评选2024-2025学年", "【更新】关于评选2024-2025学年") : XGB_HTML, { status: 200 });
      if (url === ugrsUrl) return new Response(changed ? UG_HTML.replace("【选拔通知】2026-2027学年澳洲、美洲、亚洲高校交流项目", "【更新】2026-2027学年澳洲、美洲、亚洲高校交流项目") : UG_HTML, { status: 200 });
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const notify = vi.fn(async (input: CampusFeedNotifyInput) => { void input; });
    service = createCampusFeedService({ database, fetchFn, notify, startScheduler: false });
    const snapshot = await service.getSnapshot();
    await service.updateSource("xgb-pingjiang", { enabled: true });
    await service.updateSource("ugrs-dwjl", { enabled: true });
    await Promise.all(snapshot.sources
      .filter((source) => source.id !== "xgb-pingjiang" && source.id !== "ugrs-dwjl" && source.enabled)
      .map((source) => service.updateSource(source.id, { enabled: false })));

    await service.refreshAll();
    expect(notify).not.toHaveBeenCalled();
    changed = true;
    await service.refreshAll();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].batchId).toContain("campus-feed:all:");
    expect(notify.mock.calls[0][0].items).toHaveLength(2);
    expect(new Set(notify.mock.calls[0][0].items.map((item) => item.sourceId))).toEqual(new Set(["xgb-pingjiang", "ugrs-dwjl"]));
  });

  it("records a sanitized diagnostic when notification dispatch rejects", async () => {
    const fetchFn = createFetch({ "http://www.xgb.zju.edu.cn/53395/list.htm": XGB_HTML });
    const notify = vi.fn(async () => { throw new Error("secret notification payload"); });
    const recordDiagnostic = vi.fn(async () => undefined);
    database.saveCampusFeedRefreshState("xgb-pingjiang", "2026-09-10T08:00:00.000Z");
    service = createCampusFeedService({ database, fetchFn, notify, recordDiagnostic, startScheduler: false });

    await service.refreshSource("xgb-pingjiang");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(recordDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      module: "campus-feed",
      operation: "notify",
      state: "unavailable",
      message: "校园资讯通知发送失败。"
    }));
    expect(recordDiagnostic).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("secret") }));
  });

  it("contains aggregate notification dispatch failures without rejecting refresh-all", async () => {
    const fetchFn = createFetch({ "http://www.xgb.zju.edu.cn/53395/list.htm": XGB_HTML });
    const notify = vi.fn(async () => { throw new Error("secret aggregate payload"); });
    const recordDiagnostic = vi.fn(async () => undefined);
    database.saveCampusFeedRefreshState("xgb-pingjiang", "2026-09-10T08:00:00.000Z");
    service = createCampusFeedService({ database, fetchFn, notify, recordDiagnostic, startScheduler: false });
    await service.updateSource("xgb-pingjiang", { enabled: true });

    await expect(service.refreshAll()).resolves.toBeUndefined();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(recordDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      module: "campus-feed",
      operation: "notify",
      state: "unavailable",
      message: "校园资讯通知发送失败。"
    }));
  });

  it("propagates a fetch failure and schedules a retry without corrupting state", async () => {
    const failing = vi.fn(async () => new Response("boom", { status: 503 })) as unknown as typeof fetch;
    service = createCampusFeedService({ database, fetchFn: failing, startScheduler: false });
    await expect(service.refreshSource("ckc-zxtz")).rejects.toThrow(/503/);
    const snapshot = await service.getSnapshot();
    expect(snapshot.items).toHaveLength(0);
  });

  it("persists a visible partial-success warning when a later list page fails", async () => {
    const page1 = `<li class="right-list-item"><a href="/2026/0101/c1a1/page.htm"><p>首页通知</p></a><div class="time"><span class="y">2026-01-01</span></div></li><a href="list2.htm">下一页</a>`;
    const fetchFn = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/tzgg/list.htm")
        ? new Response(page1, { status: 200 })
        : new Response("temporary failure", { status: 503 })
    ) as unknown as typeof fetch;
    service = createCampusFeedService({ database, fetchFn, startScheduler: false });
    await service.addSource("bksy-tzgg");
    await service.refreshSource("bksy-tzgg");
    expect((await service.getSnapshot()).health?.["bksy-tzgg"]).toMatchObject({
      status: "ok",
      itemCount: 1,
      message: expect.stringMatching(/第 2 页抓取失败.*保留前 1 页/)
    });
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

  it("persists onboarding atomically and keeps the previous selection after a failed write", async () => {
    service = createCampusFeedService({ database, startScheduler: false });
    await service.getSnapshot();
    const input = { profile: { identity: null, college: null, interests: ["图书资源"] }, selectedSourceIds: ["libweb-zy"] };
    const saved = await service.savePreferences(input);
    expect(saved.preferences).toMatchObject({ onboarding: "completed", profile: input.profile });
    expect(saved.sources.map((source) => source.id)).toEqual(["libweb-zy"]);
    const write = vi.spyOn(database, "saveCampusFeedPreferences").mockImplementationOnce(() => { throw new Error("disk full"); });
    await expect(service.savePreferences({ ...input, selectedSourceIds: [] })).rejects.toThrow("disk full");
    expect((await service.getSnapshot()).sources[0].enabled).toBe(true);
    write.mockRestore();
    service = createCampusFeedService({ database, startScheduler: false });
    expect((await service.getSnapshot()).sources.map((source) => source.id)).toEqual(["libweb-zy"]);
    await expect(service.openExternal("https://polymer.zju.edu.cn/tzgg/list.psp")).resolves.toBeTruthy();
  });

  it("refreshes only list metadata and preserves the explicitly fetched body offline", async () => {
    let mode: "original" | "changed" | "offline" = "original";
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      if (mode === "offline") throw new TypeError("offline");
      if (String(input).includes("53395/list")) return new Response(XGB_HTML);
      return new Response(`<div class="wp_articlecontent">${mode === "changed" ? "报名已延期至2026年9月22日17:00，请按新时间提交。" : DETAIL_TEXT}</div>`);
    }) as typeof fetch;
    const notify = vi.fn(async () => undefined);
    service = createCampusFeedService({ database, fetchFn, notify, startScheduler: false });
    await service.refreshSource("xgb-pingjiang");
    const id = (await service.getSnapshot()).items[0].id;
    await service.getItemDetail(id);
    await service.markRead([id]);
    mode = "changed";
    const callsBefore = vi.mocked(fetchFn).mock.calls.length;
    await service.refreshSource("xgb-pingjiang");
    expect(vi.mocked(fetchFn).mock.calls.slice(callsBefore).every(([url]) => String(url).includes("53395/list"))).toBe(true);
    expect((await service.getSnapshot()).items.find((item) => item.id === id)?.state).toBe("read");
    expect(notify).not.toHaveBeenCalled();
    mode = "offline";
    const detail = await service.getItemDetail(id);
    expect(detail).toMatchObject({ stale: true, text: DETAIL_TEXT });
    await expect(service.refreshSource("xgb-pingjiang")).rejects.toMatchObject({ code: "network-error" });
    expect((await service.getSnapshot()).health?.["xgb-pingjiang"]).toMatchObject({ status: "network-error", succeededAt: expect.any(String) });
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
      const notify = vi.fn(async (input: CampusFeedNotifyInput) => { void input; });
      service = createCampusFeedService({ database, fetchFn, notify, startScheduler: false });
      await service.refreshSource("xgb-pingjiang");
      await service.markRead((await service.getSnapshot()).items.map((item) => item.id));
      expect(notify).not.toHaveBeenCalled();

      const again = await service.refreshSource("xgb-pingjiang");
      expect(again).toHaveLength(2);
      const snapshot = await service.getSnapshot();
      // The edited item is unread again; the unchanged one stays read.
      expect(snapshot.items.filter((item) => item.state === "new")).toHaveLength(1);
      expect(snapshot.items.filter((item) => item.title.includes("已更新"))[0].state).toBe("new");
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({
        batchId: expect.stringContaining("campus-feed:xgb-pingjiang:"),
        items: [expect.objectContaining({
          sourceId: "xgb-pingjiang",
          sourceName: "学工门户 · 评奖评优",
          title: expect.stringContaining("已更新")
        })]
      }));
    });

    it("shows 50 rows per source while searching and loading the entire archive", async () => {
      service = createCampusFeedService({ database, startScheduler: false });
      await hydrate();
      const recent = new Date().toISOString();
      const stale = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
      const oldItem = makeItem("stale", "xgb-pingjiang", "超窗老通知", "2026-01-01T00:00:00.000Z", stale);
      database.upsertCampusFeedItem(oldItem);
      // exceed the per-source cap this source would return alone
      for (let i = 0; i < 205; i += 1) {
        database.upsertCampusFeedItem(makeItem(`cap-${i}`, "xgb-pingjiang", `窗口内通知 ${i}`, "2026-08-28T00:00:00.000Z", recent));
      }
      const snapshot = await service.getSnapshot();
      const titles = snapshot.items.map((item) => item.title);
      expect(titles).not.toContain("超窗老通知");
      expect(titles).toHaveLength(50);
      expect(await service.searchHistory({ query: "超窗老通知" })).toMatchObject({ total: 1, items: [{ id: oldItem.id }] });
      expect(await service.getItems([oldItem.id])).toMatchObject([{ id: oldItem.id }]);
      expect(await service.searchHistory({ query: "窗口内通知", offset: 200 })).toMatchObject({ total: 205, items: expect.any(Array) });
      expect((await service.searchHistory({ query: "窗口内通知", offset: 200 })).items).toHaveLength(5);
      database.saveCampusFeedDetail(oldItem.id, { text: "正文独有关键词" }, recent);
      expect((await service.searchHistory({ query: "正文独有关键词" })).total).toBe(0);
      expect((await service.searchHistory({ query: "学工门户" })).total).toBe(206);
      await service.updateSource("xgb-pingjiang", { enabled: false, notificationEnabled: false });
      expect((await service.searchHistory({ query: "超窗老通知" })).total).toBe(1);
      await service.removeSource("xgb-pingjiang");
      expect(await service.searchHistory({ query: "超窗老通知" })).toEqual({ items: [], total: 0 });
      expect(await service.getItems([oldItem.id])).toEqual([]);
      expect(database.findCampusFeedItem(oldItem.id)).toBeTruthy();
      await service.addSource("xgb-pingjiang");
      expect((await service.searchHistory({ query: "学工门户" })).total).toBe(206);
      await expect(service.searchHistory({ query: "test", offset: -1 })).rejects.toThrow();
      await expect(service.getItems(["x".repeat(201)])).rejects.toThrow();
    });

    it("invokes onItemsRead when items are marked read (未读与通知中心打通)", async () => {
      const fetchFn = createFetch({ "http://www.xgb.zju.edu.cn/53395/list.htm": XGB_HTML });
      const onItemsRead = vi.fn(async () => undefined);
      service = createCampusFeedService({ database, fetchFn, onItemsRead, startScheduler: false });
      await service.refreshSource("xgb-pingjiang");
      const ids = (await service.getSnapshot()).items.map((item) => item.id);
      await service.markRead(ids);
      expect(onItemsRead).toHaveBeenCalledWith(ids);
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

    it("does not reuse a saved API key after the provider endpoint scope changes", async () => {
      service = createCampusFeedService({ database, encryptSecret: encrypt, decryptSecret: decrypt, startScheduler: false });
      await service.saveAiSettings({
        provider: "deepseek",
        protocol: "openai-chat-completions",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "sk-old"
      });

      await expect(service.saveAiSettings({
        provider: "openai-compatible",
        protocol: "openai-chat-completions",
        baseUrl: "https://new-provider.example/v1",
        model: "new-model"
      })).resolves.toMatchObject({ apiKeyConfigured: false });
      await expect(service.loadAiSettings()).resolves.toMatchObject({
        baseUrl: "https://new-provider.example/v1",
        apiKeyConfigured: false
      });
    });

    it("keeps the saved API key when only the model changes within the same scope", async () => {
      service = createCampusFeedService({ database, encryptSecret: encrypt, decryptSecret: decrypt, startScheduler: false });
      await service.saveAiSettings({
        provider: "deepseek",
        protocol: "openai-chat-completions",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "sk-existing"
      });
      await expect(service.saveAiSettings({
        provider: "deepseek",
        protocol: "openai-chat-completions",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-reasoner"
      })).resolves.toMatchObject({ model: "deepseek-reasoner", apiKeyConfigured: true });
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
            evidence: EVIDENCE,
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
      expect(adapterInstance.generateStructured).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ items: [expect.objectContaining({ content: DETAIL_TEXT })] }) }));
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
        createTaskRecord(input);
        savedInputs.push(input);
        return { created: 1, deduplicated: 0 };
      });
      service = createCampusFeedService({ database, fetchFn, saveTask, encryptSecret: encrypt, decryptSecret: decrypt, startScheduler: false });
      await service.saveAiSettings({ provider: "deepseek", protocol: "openai-chat-completions", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: "sk-test" });
      await service.refreshSource("xgb-pingjiang");
      const itemId = (await service.getSnapshot()).items[0].id;
      await service.getItemDetail(itemId);
      vi.spyOn(database, "listCampusFeedItems").mockReturnValue([]);
      const result = await service.createScheduleTasks([
        { itemId, title: "奖学金申报截止", startAt: "2026-09-20T23:59:00+08:00", endAt: "2026-09-20T23:59:00+08:00", location: null, note: "材料交到学工办", type: "deadline", evidence: EVIDENCE },
        { itemId, title: "研究生申报截止", startAt: "2026-09-21T23:59:00+08:00", endAt: null, location: null, note: null, type: "deadline", evidence: "研究生请于2026年9月21日23:59前提交材料" }
      ]);
      expect(result).toEqual({ created: 2, deduplicated: 0 });
      expect(savedInputs[0]).toMatchObject({
        title: "奖学金申报截止",
        description: expect.stringContaining("材料交到学工办"),
        type: "deadline",
        source: { kind: "ai-assistant", fingerprint: expect.stringContaining(`campus-feed:${itemId}:`) }
      });
      expect(Date.parse(savedInputs[0].startAt)).toBeLessThan(Date.parse(savedInputs[0].endAt));
      expect(Date.parse(savedInputs[1].startAt)).toBeLessThan(Date.parse(savedInputs[1].endAt));
      expect(savedInputs[0].source?.fingerprint).not.toBe(savedInputs[1].source?.fingerprint);
    });
  });
});
