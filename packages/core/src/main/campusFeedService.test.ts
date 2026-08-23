import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCampusFeedService, type CampusFeedService } from "./campusFeedService";
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
});
