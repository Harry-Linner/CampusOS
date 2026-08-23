import { describe, expect, it, vi } from "vitest";
import type { FeedSourceDescriptor } from "@campusos/shared";
import { MVP_CAMPUS_FEED_SOURCES, fetchSourceList } from "./campusFeedSources";

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
  it("defines the four MVP sources with selectors", () => {
    expect(MVP_CAMPUS_FEED_SOURCES.map((source) => source.id)).toEqual([
      "xgb-pingjiang",
      "ugrs-dwjl",
      "zjutw-tzgg",
      "ckc-zxtz"
    ]);
    for (const source of MVP_CAMPUS_FEED_SOURCES) {
      expect(source.selectors?.container).toBeTruthy();
      expect(source.selectors?.title).toBeTruthy();
      expect(source.selectors?.link).toBeTruthy();
      expect(source.intervalMinutes).toBe(60);
      expect(source.enabled).toBe(true);
    }
  });

  it("parses an xgb-style list, preferring full titles from the title attribute", async () => {
    const items = await fetchSourceList(descriptor("xgb-pingjiang"), {
      fetchFn: mockFetch(XGB_HTML),
      now: () => new Date("2026-08-23T00:00:00Z")
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      sourceId: "xgb-pingjiang",
      title: "关于评选2024-2025学年浙江大学校友爱心励志奖学金的通知",
      url: "http://www.xgb.zju.edu.cn/2026/0526/c53397a3166736/page.htm",
      publishedAt: "2026-05-26T00:00:00+08:00"
    });
    expect(items[0].id).toMatch(/^[a-f0-9]{64}$/);
    expect(items[1].url).toBe("https://ygb.zju.edu.cn/2026/0324/c31582a3143759/page.htm");
  });

  it("parses an ugrs-style list with its own wrapper", async () => {
    const html = `
    <ul class="cg-news-list" id="arthd">
      <li><a href="/dwjlfwpt/2025/0925/c42976a3085718/page.htm" target="_blank" title="第四课堂修读方式">第四课堂修读方式</a><span class="art-date">2025-11-26</span></li>
    </ul>`;
    const items = await fetchSourceList(descriptor("ugrs-dwjl"), { fetchFn: mockFetch(html) });
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("https://ugrs.zju.edu.cn/dwjlfwpt/2025/0925/c42976a3085718/page.htm");
    expect(items[0].publishedAt).toBe("2025-11-26T00:00:00+08:00");
  });

  it("parses a zjutw-style list with div.a anchors and div.time dates", async () => {
    const html = `
    <ul>
      <li class="clear"><i class="left icon icon-dot"></i><div class="a left el"><a href="/2026/0709/c32290a3187204/page.htm">校团委2026暑期值班安排表</a></div><div class="time right">2026-07-09</div></li>
    </ul>`;
    const items = await fetchSourceList(descriptor("zjutw-tzgg"), { fetchFn: mockFetch(html) });
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
    const items = await fetchSourceList(descriptor("ckc-zxtz"), { fetchFn: mockFetch(html) });
    expect(items).toHaveLength(1);
  });

  it("throws when the list page returns a non-200 status", async () => {
    const failing = vi.fn(async () => new Response("gone", { status: 500 })) as unknown as typeof fetch;
    await expect(
      fetchSourceList(descriptor("xgb-pingjiang"), { fetchFn: failing })
    ).rejects.toThrow(/500/);
  });
});
