import { describe, expect, it, vi } from "vitest";
import type { FeedSourceDescriptor } from "@campusos/shared";
import {
  MVP_CAMPUS_FEED_SOURCES,
  feedSourceRequestFingerprint,
  fetchSourceList
} from "./campusFeedSources";

const descriptor = (id: string): FeedSourceDescriptor => {
  const found = MVP_CAMPUS_FEED_SOURCES.find((source) => source.id === id);
  if (!found) throw new Error(`missing source ${id}`);
  return found;
};

const mockFetch = (html: string): typeof fetch =>
  vi.fn(async () => new Response(html, { status: 200 })) as unknown as typeof fetch;

const XGB_HTML = `
<html><body>
<ul class="news_list">
  <li class="news n1 clearfix">
    <span class="news_title"><a href="/2026/0526/c53397a3166736/page.htm" target="_blank" title="关于评选2024-2025学年浙江大学校友爱心励志奖学金的通知">关于评选2024-2025学年…</a></span>
    <span class="news_meta">2026-05-26</span>
  </li>
  <li class="news n2 clearfix">
    <span class="news_title"><a href="https://ygb.zju.edu.cn/2026/0324/c31582a3143759/page.htm" target="_blank" title="关于做好浙江大学2026届优秀本科毕业生评选工作的通知">关于做好…</a></span>
    <span class="news_meta">2026-03-24</span>
  </li>
</ul>
</body></html>`;

describe("campusFeedSources", () => {
  it("defines default sources: enabled ones carry selectors or an adapter, candidates are disabled", () => {
    const ids = MVP_CAMPUS_FEED_SOURCES.map((source) => source.id);
    // 原有 MVP 四源保留
    for (const id of ["xgb-pingjiang", "ugrs-dwjl", "zjutw-tzgg", "ckc-zxtz"]) {
      expect(ids).toContain(id);
    }
    // 唯一 id
    expect(new Set(ids).size).toBe(ids.length);
    // 默认启用源：声明式选择器（或 rss adapter）+ 合法间隔
    const enabled = MVP_CAMPUS_FEED_SOURCES.filter((source) => source.enabled);
    expect(enabled.length).toBeGreaterThan(10);
    for (const source of enabled) {
      expect(source.selectors?.container || source.adapterId === "rss").toBeTruthy();
      expect(source.intervalMinutes).toBeGreaterThanOrEqual(1);
    }
    // 候选源（默认关闭，开发期待核验 selectors）也必须带选择器
    for (const source of MVP_CAMPUS_FEED_SOURCES.filter((candidate) => !candidate.enabled)) {
      expect(source.selectors?.container).toBeTruthy();
      expect(source.selectors?.title).toBeTruthy();
      expect(source.selectors?.link).toBeTruthy();
    }
  });

  it("parses an xgb-style list, preferring full titles from the title attribute", async () => {
    const outcome = await fetchSourceList(descriptor("xgb-pingjiang"), {
      fetchFn: mockFetch(XGB_HTML),
      now: () => new Date("2026-08-23T00:00:00Z")
    });
    const items = outcome.items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      sourceId: "xgb-pingjiang",
      title: "关于评选2024-2025学年浙江大学校友爱心励志奖学金的通知",
      url: "http://www.xgb.zju.edu.cn/2026/0526/c53397a3166736/page.htm",
      publishedAt: "2026-05-26T00:00:00+08:00"
    });
    expect(items[0].id).toMatch(/^[a-f0-9]{64}$/);
    expect(items[1].url).toBe("https://ygb.zju.edu.cn/2026/0324/c31582a3143759/page.htm");
    // B4-1：抓取层返回请求版本指纹（脱敏 16 hex，与来源 URL 结构对应）。
    expect(outcome.requestFingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(outcome.requestFingerprint).toBe(
      feedSourceRequestFingerprint(descriptor("xgb-pingjiang"))
    );
  });

  it("parses an ugrs-style list with its own wrapper", async () => {
    const html = `
    <ul class="cg-news-list" id="arthd">
      <li><a href="/dwjlfwpt/2025/0925/c42976a3085718/page.htm" target="_blank" title="第四课堂修读方式">第四课堂修读方式</a><span class="art-date">2025-11-26</span></li>
    </ul>`;
    const { items } = await fetchSourceList(descriptor("ugrs-dwjl"), { fetchFn: mockFetch(html) });
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("https://ugrs.zju.edu.cn/dwjlfwpt/2025/0925/c42976a3085718/page.htm");
    expect(items[0].publishedAt).toBe("2025-11-26T00:00:00+08:00");
  });

  it("parses a zjutw-style list with div.a anchors and div.time dates", async () => {
    const html = `
    <ul>
      <li class="clear"><i class="left icon icon-dot"></i><div class="a left el"><a href="/2026/0709/c32290a3187204/page.htm">校团委2026暑期值班安排表</a></div><div class="time right">2026-07-09</div></li>
    </ul>`;
    const { items } = await fetchSourceList(descriptor("zjutw-tzgg"), { fetchFn: mockFetch(html) });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("校团委2026暑期值班安排表");
    expect(items[0].publishedAt).toBe("2026-07-09T00:00:00+08:00");
  });

  it("deduplicates repeated URLs within one page", async () => {
    const html = `
    <ul class="news_list">
      <li class="news n1 clearfix"><span class="news_title"><a href="/2026/0526/c53397a3166736/page.htm" title="相同标题">相同标题</a></span><span class="news_meta">2026-05-26</span></li>
      <li class="news n2 clearfix"><span class="news_title"><a href="/2026/0526/c53397a3166736/page.htm" title="相同标题">相同标题</a></span><span class="news_meta">2026-05-26</span></li>
    </ul>`;
    const { items } = await fetchSourceList(descriptor("ckc-zxtz"), { fetchFn: mockFetch(html) });
    expect(items).toHaveLength(1);
  });

  it("throws when the list page returns a non-200 status", async () => {
    const failing = vi.fn(async () => new Response("gone", { status: 500 })) as unknown as typeof fetch;
    await expect(
      fetchSourceList(descriptor("xgb-pingjiang"), { fetchFn: failing })
    ).rejects.toThrow(/500/);
  });

  it("parses a Drupal RSS feed via the rss adapter", async () => {
    const rss = `
    <rss version="2.0"><channel><title>Intl Campus</title>
      <item><title>Opening of the new library wing</title><link>https://www.intl.zju.edu.cn/news/opening</link><pubDate>Wed, 20 Aug 2026 08:00:00 +0000</pubDate><description>Grand opening ceremony.</description></item>
      <item><title>No-link item skipped</title></item>
    </channel></rss>`;
    const { items } = await fetchSourceList(descriptor("intl-rss"), { fetchFn: mockFetch(rss) });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceId: "intl-rss",
      title: "Opening of the new library wing",
      url: "https://www.intl.zju.edu.cn/news/opening",
      summary: "Grand opening ceremony."
    });
    expect(items[0].publishedAt).not.toBeNull();
  });

  it("decodes GBK-encoded list pages when encoding is set", async () => {
    const ascii = (value: string): number[] => [...new TextEncoder().encode(value)];
    // “中文”的 GBK 字节：D6 D0 CE C4
    const gbkHtml = new Uint8Array([
      ...ascii('<li class="news"><span class="news_title"><a href="/2026/0101/c1a1/page.htm" title="'),
      0xd6, 0xd0, 0xce, 0xc4,
      ...ascii('">x</a></span><span class="news_meta">2026-01-01</span></li>')
    ]);
    const fetchGbk = vi.fn(async () => new Response(gbkHtml, { status: 200 })) as unknown as typeof fetch;
    const { items } = await fetchSourceList(descriptor("tyys-tzgg"), { fetchFn: fetchGbk });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("中文");
  });

  it("fetches additional sudic pages when maxPages is set", async () => {
    const page1 = `<li class="news"><span class="news_title"><a href="/2026/0101/c1a1/page.htm" title="一">一</a></span><span class="news_meta">2026-01-01</span></li>`;
    const page2 = `<li class="news"><span class="news_title"><a href="/2026/0102/c1a2/page.htm" title="二">二</a></span><span class="news_meta">2026-01-02</span></li>`;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("list.htm")) return new Response(page1, { status: 200 });
      if (url.endsWith("list2.htm")) return new Response(page2, { status: 200 });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const { items } = await fetchSourceList(descriptor("bksy-tzgg"), { fetchFn: fetcher });
    expect(items.map((item) => item.title)).toEqual(["一", "二"]);
  });
});
