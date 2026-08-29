/**
 * Campus-feed (校园资讯) source definitions and list-page fetcher (Core, main).
 *
 * Sources are declared with RSSHub-style selectors that match the 博达 (sudy)
 * CMS list pages used by ZJU official sites. Fetching happens only in the main
 * process; the renderer and plugin sandboxes never receive a network handle.
 */
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type {
  FeedItemRecord,
  FeedSourceDescriptor
} from "@campusos/shared";
import { computeRequestFingerprint } from "./requestFingerprint";

/**
 * MVP 4 sources: 学工门户评奖评优 / 本科生对外交流(出国境) / 校团委通知公告 /
 * 竺可桢学院最新通知. All are static list pages verified reachable (HTTP 200)
 * with the selectors below (2026-08-23 baseline, see
 * docs/ideas/campus-notice-aggregator/source-sites.md).
 */
export const MVP_CAMPUS_FEED_SOURCES: readonly FeedSourceDescriptor[] = [
  {
    id: "xgb-pingjiang",
    name: "学工门户 · 评奖评优",
    category: "general",
    tags: ["评奖评优"],
    baseUrl: "http://www.xgb.zju.edu.cn",
    listUrl: "http://www.xgb.zju.edu.cn/53395/list.htm",
    selectors: {
      container: "li.news",
      title: "span.news_title a",
      link: "span.news_title a",
      time: "span.news_meta",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 60,
    enabled: true
  },
  {
    id: "ugrs-dwjl",
    name: "本科生对外交流 · 通知",
    category: "general",
    tags: ["出国境"],
    baseUrl: "https://ugrs.zju.edu.cn",
    extraHosts: ["mp.weixin.qq.com"],
    listUrl: "https://ugrs.zju.edu.cn/dwjlfwpt/42976/list.htm",
    selectors: {
      container: "ul.cg-news-list li",
      title: "a",
      link: "a",
      time: "span.art-date",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 60,
    enabled: true
  },
  {
    id: "zjutw-tzgg",
    name: "校团委 · 通知公告",
    category: "general",
    tags: ["活动", "通知"],
    baseUrl: "https://zjutw.zju.edu.cn",
    extraHosts: ["dwzzb.zju.edu.cn"],
    listUrl: "https://zjutw.zju.edu.cn/tzgg/list.htm",
    selectors: {
      container: "li.clear",
      title: "div.a a",
      link: "div.a a",
      time: "div.time",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 60,
    enabled: true
  },
  {
    id: "ckc-zxtz",
    name: "竺可桢学院 · 最新通知",
    category: "college",
    tags: ["学院通知"],
    baseUrl: "http://office.ckc.zju.edu.cn",
    listUrl: "http://office.ckc.zju.edu.cn/zxtz/list.htm",
    selectors: {
      container: "li.news",
      title: "span.news_title a",
      link: "span.news_title a",
      time: "span.news_meta",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 60,
    enabled: true
  }
];

export const isFeedSourceUrl = (
  descriptor: FeedSourceDescriptor,
  value: string
): boolean => {
  try {
    const url = new URL(value);
    if (!url.username && !url.password && (url.protocol === "https:" || url.protocol === "http:")) {
      const base = new URL(descriptor.baseUrl);
      const allowed = new Set([
        base.hostname.toLowerCase(),
        ...(descriptor.extraHosts ?? []).map((host) => host.toLowerCase())
      ]);
      return allowed.has(url.hostname.toLowerCase());
    }
  } catch {
    return false;
  }
  return false;
};

const canonicalUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
};

const normalizePublishedAt = (
  value: string | null | undefined
): string | null => {
  if (!value) return null;
  const match = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00+08:00`;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

export interface FetchSourceListOptions {
  fetchFn?: typeof fetch;
  now?: () => Date;
  fetchTimeoutMs?: number;
}

/**
 * 该订阅源列表请求的版本指纹（方法+主机+路径，脱敏），供上游兼容雷达。
 * 成功与失败路径共用同一来源，保证台账中指纹一致。
 */
export const feedSourceRequestFingerprint = (
  descriptor: FeedSourceDescriptor
): string => computeRequestFingerprint("GET", descriptor.listUrl);

export interface FeedSourceListResult {
  items: FeedItemRecord[];
  requestFingerprint: string;
}

/**
 * Fetches one source's list page and normalizes its items. Titles prefer the
 * anchor's title attribute (full titles) over its text (often truncated).
 */
export const fetchSourceList = async (
  descriptor: FeedSourceDescriptor,
  options: FetchSourceListOptions = {}
): Promise<FeedSourceListResult> => {
  const { fetchFn = fetch, now = () => new Date(), fetchTimeoutMs = 20_000 } = options;
  if (!descriptor.selectors) {
    throw new Error(`${descriptor.name} 没有可用的抓取规则。`);
  }
  // B4-1：请求版本指纹在发起 HTTP 处构造，随结果穿透到刷新台账。
  const requestFingerprint = feedSourceRequestFingerprint(descriptor);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
  let response: Response;
  try {
    response = await fetchFn(descriptor.listUrl, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
      },
      redirect: "follow"
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    // 附带 status 供 classifyRetryError 按 408/429/5xx 判定为可重试。
    throw Object.assign(new Error(`${descriptor.name} 返回 ${response.status}。`), {
      status: response.status
    });
  }
  const html = await response.text();
  const $ = cheerio.load(html);
  const selectors = descriptor.selectors;
  const items: FeedItemRecord[] = [];
  const seen = new Set<string>();

  $(selectors.container).each((_index, element) => {
    const $container = $(element);
    const $title = $container.find(selectors.title).first();
    const $link = $container.find(selectors.link).first();
    if ($title.length === 0 || $link.length === 0) return;

    const rawTitle = ($link.attr("title") ?? "").trim() || $title.text().trim();
    if (!rawTitle) return;

    const rawHref = $link.attr("href") ?? "";
    const resolved = canonicalUrl(new URL(rawHref, descriptor.baseUrl).toString());
    if (!resolved) return;
    if (seen.has(resolved)) return;
    seen.add(resolved);

    const id = createHash("sha256").update(resolved, "utf8").digest("hex");
    let publishedAt: string | null = null;
    if (selectors.time) {
      const $time = $container.find(selectors.time).first();
      const rawTime = selectors.timeAttr
        ? $time.attr(selectors.timeAttr) ?? ""
        : $time.text();
      const pattern = selectors.timePattern ?? "\\d{4}-\\d{2}-\\d{2}";
      const match = new RegExp(pattern).exec(rawTime.replace(/\s+/g, " ").trim());
      publishedAt = normalizePublishedAt(match?.[0] ?? rawTime);
    }

    items.push({
      id,
      sourceId: descriptor.id,
      title: rawTitle.slice(0, 300),
      url: resolved,
      publishedAt,
      summary: null,
      contentHash: createHash("sha256")
        .update(`${rawTitle}\n${resolved}`, "utf8")
        .digest("hex"),
      fetchedAt: now().toISOString(),
      state: "new"
    });
  });

  return { items, requestFingerprint };
};
