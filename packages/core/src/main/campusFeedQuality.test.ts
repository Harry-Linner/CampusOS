import { describe, expect, it, vi } from "vitest";
import { fetchSourceDetail, fetchSourceList } from "./campusFeedSources";
import { MVP_CAMPUS_FEED_SOURCES } from "./campusFeedSourceCatalog";
import type { FeedItemRecord } from "@campusos/shared";
import { campusFeedRecommendationReasons } from "@campusos/shared";
import { CAMPUS_FEED_CATALOG } from "./campusFeedCatalog";

const source = (id: string) => MVP_CAMPUS_FEED_SOURCES.find((entry) => entry.id === id)!;
const respond = (html: string): typeof fetch => vi.fn(async () => new Response(html)) as typeof fetch;

describe("campus feed observed-site regressions", () => {
  it("follows the real next link using a verified Webplus HTTPS endpoint", async () => {
    const requested: string[] = [];
    const result = await fetchSourceList(source("yunfeng-awards"), { fetchFn: vi.fn(async (url) => {
      requested.push(String(url));
      const second = String(url).includes("list2.psp");
      return new Response(`<li class="news"><span class="news_title"><a href="/on/2026/0901/c53709a${second ? 2 : 1}/page.htm">公示</a></span><span class="news_meta">2026-09-01</span></li>${second ? "" : '<a href="list2.htm">下一页</a>'}`);
    }) as typeof fetch });
    expect(requested).toEqual(["https://yunfeng.zju.edu.cn/on/53709/list.psp", "https://yunfeng.zju.edu.cn/on/53709/list2.psp"]);
    expect(result.items).toHaveLength(2);
    expect(result.partialWarning).toBeUndefined();
  });

  it("recommends every own-college column before audience and topic restrictions", () => {
    const reasons = (id: string, identity: "undergraduate" | "master" | null, college: string | null, interests: string[] = []) =>
      campusFeedRecommendationReasons(CAMPUS_FEED_CATALOG.find(entry => entry.id === id)!, { identity, college, interests });
    expect(reasons("cs-csen", "master", "计算机学院", ["就业实习"])).toContain("来自你的学院：计算机学院");
    for (const id of ["ls-tzgg", "mse-undergraduate", "ccea-tzgg", "ccea-awards"]) {
      expect(reasons(id, "master", "计算机学院", ["就业实习", "奖助评优"])).toEqual([]);
    }
    expect(reasons("mse-undergraduate", "master", "材料学院", ["教务考试"])).toContain("来自你的学院：材料学院");
    expect(reasons("mse-graduate", "master", "材料学院")).toContain("来自你的学院：材料学院");
    for (const entry of CAMPUS_FEED_CATALOG.filter(source => source.college === "材料学院")) {
      expect(reasons(entry.id, null, "材料学院")).toContain("来自你的学院：材料学院");
    }
    expect(reasons("xgb-pingjiang", "undergraduate", null)).toEqual([]);
    expect(reasons("xgb-pingjiang", "undergraduate", null, ["奖助评优"])).toEqual(["你关注奖助评优"]);
    expect(reasons("xgb-zxtz", "master", null, ["奖助评优"])).toEqual([]);
    expect(reasons("grs-all", "master", null)).toContain("来自研究生院");
    expect(reasons("grs-yjszs", "master", null)).toContain("来自研究生院");
    expect(reasons("mse-tzgg", "undergraduate", "材料学院", ["教务考试"])).toContain("来自你的学院：材料学院");
  });

  it("includes all bound academic-office columns for each student identity", () => {
    for (const identity of ["undergraduate", "master", "doctor"] as const) {
      const office = identity === "undergraduate" ? "undergraduate" : "graduate";
      const entries = CAMPUS_FEED_CATALOG.filter(source => source.academicOffice === office);
      expect(entries.length).toBeGreaterThan(1);
      for (const entry of entries) {
        expect(campusFeedRecommendationReasons(entry, { identity, college: null, interests: [] }).length).toBeGreaterThan(0);
      }
    }
  });

  it("unions optional-identity interests and never loses recommendations when adding interests", () => {
    const select = (interests: string[]) => CAMPUS_FEED_CATALOG.filter(source =>
      campusFeedRecommendationReasons(source, { identity: null, college: null, interests }).length).map(source => source.id);
    const teaching = select(["教务考试"]);
    const aid = select(["奖助评优"]);
    expect(teaching).toContain("bksy-tzgg");
    expect(aid).toContain("xgb-pingjiang");
    expect(new Set(select(["教务考试", "奖助评优"]))).toEqual(new Set([...teaching, ...aid]));
    for (const college of [null, "材料学院", "计算机学院"]) {
      for (const identity of [null, "undergraduate", "master", "doctor"] as const) {
        for (const source of CAMPUS_FEED_CATALOG) {
          const before = campusFeedRecommendationReasons(source, { identity, college, interests: [] });
          if (before.length) expect(campusFeedRecommendationReasons(source, { identity, college, interests: ["教务考试", "奖助评优"] }).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("keeps the same article in independent website columns", async () => {
    const html = '<li class="news"><span class="news_title"><a href="/2026/0901/c19119a1/page.htm">奖学金通知</a></span><span class="news_meta">2026-09-01</span></li>';
    const [all, awards] = await Promise.all(["ccea-student-affairs", "ccea-awards"].map(id => fetchSourceList(source(id), { fetchFn: respond(html) })));
    expect(all.items).toHaveLength(1);
    expect(awards.items).toHaveLength(1);
    expect(all.items[0].url).toBe(awards.items[0].url);
    expect(all.items[0].id).not.toBe(awards.items[0].id);
  });

  it("reads the graduate school's actual short-year date format", async () => {
    const result = await fetchSourceList(source("grs-all"), { fetchFn: respond('<ul class="list-article"><li class="list-item"><a href="/2026/0710/c1a2/page.htm"><h3>选课安排</h3><span class="date">26-07-10</span></a></li></ul>') });
    expect(result.items[0]).toMatchObject({ title: "选课安排", publishedAt: "2026-07-10T00:00:00+08:00" });
  });

  it("does not recommend unrelated colleges or undergraduate admissions from identity alone", () => {
    for (const id of ["ls-tzgg", "polymer-tzgg", "zdzsc-zxgg"]) {
      const entry = CAMPUS_FEED_CATALOG.find((item) => item.id === id)!;
      for (const identity of ["master", "undergraduate"] as const) {
        expect(campusFeedRecommendationReasons(entry, { identity, college: null, interests: [] })).toEqual([]);
      }
    }
    const history = CAMPUS_FEED_CATALOG.find((item) => item.id === "ls-tzgg")!;
    expect(campusFeedRecommendationReasons(history, { identity: "master", college: "历史学院", interests: [] })).toContain("来自你的学院：历史学院");
  });

  it("reads admissions articles without column navigation or date text in titles", async () => {
    const { items } = await fetchSourceList(source("zdzsc-zxgg"), { fetchFn: respond(`
      <nav><li><a href="/zxgg/list.htm">最新公告</a></li></nav>
      <ul><li><a href="/2026/0901/c87333a1/page.htm"><div class="time"><div>09-01</div><div>2026</div></div><div class="des">录取通知</div></a></li></ul>`) });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "录取通知", publishedAt: "2026-09-01T00:00:00+08:00" });
  });

  it("separates psychology titles from excerpts and month-day/year dates", async () => {
    const { items } = await fetchSourceList(source("xlzx-zdts"), { fetchFn: respond(`
      <ul class="list"><li class="list-item"><a href="/2026/0901/c55627a1/page.htm"><div class="date"><p class="md">09-01</p><p class="year">2026</p></div><div class="content"><h3>咨询安排</h3><p>摘要不应成为标题</p></div></a></li></ul>`) });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "咨询安排", publishedAt: "2026-09-01T00:00:00+08:00" });
  });

  it("normalizes only the verified library host's RSS links to HTTPS", async () => {
    const { items } = await fetchSourceList(source("libintl-rss"), { fetchFn: respond('<rss><channel><item><title>开馆通知</title><link>http://lib.intl.zju.edu.cn/node/1</link><pubDate>Tue, 01 Sep 2026 00:00:00 GMT</pubDate><description>&lt;p&gt;开馆安排&lt;/p&gt;</description></item></channel></rss>') });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ url: "https://lib.intl.zju.edu.cn/node/1", summary: "开馆安排" });
  });

  it("reports RSS entries rejected by URL rules instead of reporting an empty feed", async () => {
    await expect(fetchSourceList(source("libintl-rss"), { fetchFn: respond('<rss><channel><item><title>通知</title><link>https://other.example/article</link></item></channel></rss>') })).rejects.toMatchObject({ code: "layout-changed" });
  });

  it("fetches hospital notices and their matching body through the public embed API", async () => {
    const record = { id: 7, articleTitle: "门诊时间调整", articleContent: "<p>下周门诊时间调整，请按公告安排就诊。</p>", createTime: "2026-09-01 09:00:00", isOuterChain: 1 };
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      if (String(input).endsWith("/listType")) {
        expect(JSON.parse(String(init?.body))).toEqual({ articleTypeId: 107, pageNum: 1, pageSize: 20 });
        return new Response(JSON.stringify({ code: 200, data: [record] }));
      }
      expect(String(input)).toBe("https://xyszyl.zju.edu.cn/medical/health/article/getDetail");
      expect(JSON.parse(String(init?.body))).toEqual({ id: "7" });
      return new Response(JSON.stringify({ code: 200, data: record }));
    }) as typeof fetch;
    const { items } = await fetchSourceList(source("zdyy-tzgg"), { fetchFn });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "门诊时间调整", url: "https://xyszyl.zju.edu.cn/medical/embed/index.html#/detail?artilceId=7", publishedAt: "2026-09-01T00:00:00+08:00" });
    const detail = await fetchSourceDetail(source("zdyy-tzgg"), items[0], { fetchFn });
    expect(detail.text).toBe("下周门诊时间调整，请按公告安排就诊。");
  });

  it("does not turn a hospital API failure into empty success", async () => {
    await expect(fetchSourceList(source("zdyy-tzgg"), { fetchFn: respond('{"code":500,"data":[]}') })).rejects.toThrow("未成功");
  });
  it("uses the current first page and the actual exchange opportunities column", () => {
    expect(source("ls-tzgg").listUrl).toBe("https://ls.zju.edu.cn/tzgg/list.htm");
    expect(source("ugrs-dwjl").listUrl).toContain("/42921/list.htm");
  });

  it("ignores library navigation and reads the notice date", async () => {
    const { items } = await fetchSourceList(source("libweb-xw"), { fetchFn: respond(`
      <nav><li><a href="/about/list.htm">本馆介绍</a></li></nav>
      <ul><li class="news"><span class="news_title"><a href="/2026/0901/c55989a1/page.htm">开馆通知</a></span><span class="news_meta">2026-09-01</span></li></ul>`) });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "开馆通知", publishedAt: "2026-09-01T00:00:00+08:00" });
  });

  it("extracts logistics titles and split year-month/day without navigation", async () => {
    const { items } = await fetchSourceList(source("zulg-tzgg"), { fetchFn: respond(`
      <li><a href="/notice.htm">通知公告</a></li>
      <li><a class="a flex" href="../../info/1036/101907.htm"><div class="time"><h3>02</h3><h6>2026.09</h6></div><h4>停水安排</h4></a></li>`) });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "停水安排", publishedAt: "2026-09-02T00:00:00+08:00", url: "https://zulg.zju.edu.cn/info/1036/101907.htm" });
  });

  it("rejects a 200 campus-only prompt as restricted rather than a successful empty feed", async () => {
    await expect(fetchSourceList(source("mse-tzgg"), { fetchFn: respond("<title>提示信息</title>您当前ip并非校内地址，该信息仅允许校内地址访问") }))
      .rejects.toMatchObject({ code: "restricted" });
  });

  it("distinguishes real empty lists from an unrecognised layout", async () => {
    await expect(fetchSourceList(source("libweb-xw"), { fetchFn: respond("<h1>全新网站</h1>") })).rejects.toMatchObject({ code: "layout-changed" });
    await expect(fetchSourceList(source("libweb-xw"), { fetchFn: respond("<p>总共 0 记录</p>") })).resolves.toMatchObject({ items: [] });
  });

  it("skips malformed and empty links while preserving a valid row", async () => {
    const html = ["http://[invalid", "", "/2026/0901/c55989a2/page.htm"].map((href) => `<li class="news"><span class="news_title"><a href="${href}">标题</a></span><span class="news_meta">2026.09.01</span></li>`).join("");
    const { items } = await fetchSourceList(source("libweb-xw"), { fetchFn: respond(html) });
    expect(items).toHaveLength(1);
    expect(items[0].publishedAt).toBe("2026-09-01T00:00:00+08:00");
  });

  it("does not confuse a login/help link with an access gate", async () => {
    const { items } = await fetchSourceList(source("libweb-xw"), { fetchFn: respond('<nav><a>统一身份认证平台</a><a>验证码帮助</a></nav><li class="news"><span class="news_title"><a href="/article.htm">开馆通知</a></span><span class="news_meta">2026-09-01</span></li>') });
    expect(items).toHaveLength(1);
  });

  it("refuses an off-site redirect before requesting the other host", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://other.example/collect" } })) as typeof fetch;
    await expect(fetchSourceList(source("libweb-xw"), { fetchFn })).rejects.toMatchObject({ code: "restricted" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("reads the actual article body and safe attachments without navigation or scripts", async () => {
    const item = { id: "test", sourceId: "libweb-xw", title: "活动报名", url: "https://libweb.zju.edu.cn/2026/0901/c55989a1/page.htm" } as FeedItemRecord;
    const result = await fetchSourceDetail(source("libweb-xw"), item, { fetchFn: respond('<nav>不应传给 AI 的导航</nav><div class="wp_articlecontent"><p>报名截至2026年9月20日17:00，请按时提交。</p><script>恶意脚本</script><a href="/files/form.pdf">报名表</a></div>') });
    expect(result.text).toContain("报名截至2026年9月20日17:00");
    expect(result.text).not.toMatch(/导航|恶意脚本/);
    expect(result.attachments).toEqual([{ name: "报名表", url: "https://libweb.zju.edu.cn/files/form.pdf" }]);
    expect(result.contentHash).toHaveLength(64);
  });

  it("uses polymer's first page, full title and explicit two-digit-year format, and deduplicates column aliases", async () => {
    expect(source("polymer-tzgg").listUrl).toBe("https://polymer.zju.edu.cn/tzgg/list.psp");
    const html = ["38014", "54783"].map((column) => `<li class="list-item"><a href="/2026/0806/c${column}a3193622/page.htm"><div class="date"><p class="md">08-06</p><p class="year">26</p></div><div class="content"><h3>推免报名通知</h3><p>冗长的报名细则摘要不应并入标题</p></div></a></li>`).join("");
    const { items } = await fetchSourceList(source("polymer-tzgg"), { fetchFn: respond(html) });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "推免报名通知", publishedAt: "2026-08-06T00:00:00+08:00" });
  });
});
