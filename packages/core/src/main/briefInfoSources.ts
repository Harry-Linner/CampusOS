/**
 * Daily Brief external-info connector (Core).
 *
 * Fetches whitelisted RSS/Atom feeds in the main process, normalizes items,
 * deduplicates by canonical-URL fingerprint, and degrades per source. The
 * renderer and plugin sandboxes never receive a network handle.
 */
import { createHash } from "node:crypto";
import type Parser from "rss-parser";
import type { BriefCachedItem } from "@campusos/shared";
import { BRIEF_MAX_RAW_SUMMARY, BRIEF_MAX_RAW_TITLE } from "@campusos/shared";
import { createRetryState, withRetry } from "./retryPolicy";
import { computeRequestFingerprint } from "./requestFingerprint";

export interface BriefSourceDefinition {
  id: string;
  label: string;
  feedUrl: string;
  interestHint: string;
  allowedHosts: readonly string[];
}

export const BRIEF_SOURCE_DEFINITIONS: BriefSourceDefinition[] = [
  {
    id: "arxiv",
    label: "arXiv",
    feedUrl: "https://rss.arxiv.org/rss/cs",
    interestHint: "学术/计算机",
    allowedHosts: ["arxiv.org"]
  },
  {
    id: "hacker-news",
    label: "Hacker News",
    feedUrl: "https://hnrss.org/frontpage",
    interestHint: "技术/创业",
    allowedHosts: ["news.ycombinator.com", "hnrss.org"]
  },
  {
    id: "infoq",
    label: "InfoQ",
    feedUrl: "https://www.infoq.cn/feed",
    interestHint: "技术/工程",
    allowedHosts: ["infoq.cn", "www.infoq.cn"]
  },
  {
    id: "solidot",
    label: "Solidot",
    feedUrl: "https://www.solidot.org/index.rss",
    interestHint: "技术/科学/中文",
    allowedHosts: ["solidot.org", "www.solidot.org"]
  }
];

export const BRIEF_SOURCE_IDS: readonly string[] = BRIEF_SOURCE_DEFINITIONS.map(
  (source) => source.id
);

export const isBriefSourceUrl = (sourceId: string, value: string): boolean => {
  const source = BRIEF_SOURCE_DEFINITIONS.find((candidate) => candidate.id === sourceId);
  if (!source) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      source.allowedHosts.includes(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
};

export interface BriefFetchOutcome {
  items: BriefCachedItem[];
  degraded: string[];
  /**
   * B4-1：请求版本指纹，sourceId → 该 feed 请求的指纹（脱敏，抓取前计算，
   * 成功与失败的源都包含），供刷新台账与上游兼容雷达使用。
   */
  requestFingerprints: Record<string, string>;
}

export interface BriefFetcher {
  (input: { enabledSourceIds: string[] }): Promise<BriefFetchOutcome>;
}

export interface BriefFetcherOptions {
  fetchFn?: typeof fetch;
  now?: () => Date;
  maxRetries?: number;
  fetchTimeoutMs?: number;
  maxItemsPerSource?: number;
}

const canonicalUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
};

const fingerprintOf = (url: string): string =>
  createHash("sha256").update(url, "utf8").digest("hex");

const truncate = (value: string, max: number): string => {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
};

const parsePublishedAt = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
};

export const createBriefFetcher = ({
  fetchFn = fetch,
  now = () => new Date(),
  maxRetries = 2,
  fetchTimeoutMs = 20_000,
  maxItemsPerSource = 20
}: BriefFetcherOptions = {}): BriefFetcher => {
  // B4-2：rss-parser 仅抓取时使用，动态加载避免打进 main 首包；模块缓存保证只解析一次。
  let parserModule: Promise<{ default: typeof Parser }> | null = null;
  const loadParser = (): Promise<{ default: typeof Parser }> => {
    parserModule ??= import("rss-parser") as Promise<{ default: typeof Parser }>;
    return parserModule;
  };

  const fetchFeedXml = async (feedUrl: string): Promise<string> => {
    const state = createRetryState();
    return withRetry(
      async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
        try {
          const response = await fetchFn(feedUrl, {
            signal: controller.signal,
            headers: { "user-agent": "CampusOS-DailyBrief/0.1" }
          });
          if (!response.ok) {
            throw Object.assign(new Error(`HTTP ${response.status}`), {
              status: response.status
            });
          }
          return await response.text();
        } finally {
          clearTimeout(timeout);
        }
      },
      state,
      { maxRetries, baseDelayMs: 200, maxDelayMs: 2_000 }
    );
  };

  const fetchSource = async (
    source: BriefSourceDefinition
  ): Promise<BriefCachedItem[]> => {
    const { default: ParserCtor } = await loadParser();
    const parser = new ParserCtor();
    const xml = await fetchFeedXml(source.feedUrl);
    const parsed = await parser.parseString(xml);
    const entries = Array.isArray(parsed.items) ? parsed.items : [];
    const seen = new Set<string>();
    const items: BriefCachedItem[] = [];
    for (const entry of entries.slice(0, maxItemsPerSource * 2)) {
      const raw = entry as Record<string, unknown>;
      const rawUrl = typeof raw.link === "string" ? raw.link : "";
      const url = canonicalUrl(rawUrl);
      if (!url) continue;
      if (!isBriefSourceUrl(source.id, url)) continue;
      const fingerprint = fingerprintOf(url);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      const title = typeof raw.title === "string"
        ? truncate(raw.title, BRIEF_MAX_RAW_TITLE)
        : "";
      if (!title) continue;
      const summaryRaw =
        typeof raw.contentSnippet === "string" && raw.contentSnippet.trim()
          ? raw.contentSnippet
          : typeof raw.content === "string" && raw.content.trim()
            ? raw.content
            : typeof raw.description === "string" && raw.description.trim()
              ? raw.description
              : "";
      items.push({
        fingerprint,
        sourceId: source.id,
        url,
        title,
        summary: summaryRaw
          ? truncate(summaryRaw, BRIEF_MAX_RAW_SUMMARY)
          : null,
        publishedAt: parsePublishedAt(raw.isoDate ?? raw.pubDate),
        fetchedAt: now().toISOString()
      });
      if (items.length >= maxItemsPerSource) break;
    }
    return items;
  };

  return async ({ enabledSourceIds }) => {
    const enabled = new Set(enabledSourceIds.filter((id) => BRIEF_SOURCE_IDS.includes(id)));
    const degraded: string[] = [];
    const items: BriefCachedItem[] = [];
    const requestFingerprints: Record<string, string> = {};
    for (const source of BRIEF_SOURCE_DEFINITIONS) {
      if (!enabled.has(source.id)) continue;
      // B4-1：请求版本指纹在发起 HTTP 处构造（方法+主机+路径，不含任何值）。
      requestFingerprints[source.id] = computeRequestFingerprint(
        "GET",
        source.feedUrl
      );
      try {
        items.push(...await fetchSource(source));
      } catch {
        degraded.push(source.id);
      }
    }
    return { items, degraded, requestFingerprints };
  };
};
