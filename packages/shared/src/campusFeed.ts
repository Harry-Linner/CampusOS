/**
 * campus-feed (校园资讯) shared types.
 *
 * Aggregates notices published across campus websites (awards, study-abroad
 * programs, campus events, college announcements). Sources are described by
 * declarative list selectors (RSSHub-style) or a code adapter id; the core
 * service fetches on a per-source interval, dedupes by canonical URL, stores
 * history locally, and pushes new items into the notification center.
 */

/** Declarative scraping rule for a static list page (RSSHub-style). */
export interface FeedListSelectorConfig {
  /** List item container selector, e.g. ".news_list li". */
  container: string;
  /** Title selector, relative to the container, e.g. "a". */
  title: string;
  /** Link element selector (often the title element itself). */
  link: string;
  /** Attribute holding the href; defaults to "href". */
  linkAttr?: string;
  /** Optional time selector, e.g. ".date". */
  time?: string;
  /** Attribute holding the date when the time element stores it in an attr. */
  timeAttr?: string;
  /** Regex used to pull a date out of the time text/attr, e.g. "20\\d{2}-\\d{2}-\\d{2}". */
  timePattern?: string;
  /** Page charset override for legacy sites (e.g. "gbk"). */
  encoding?: string;
}

export type FeedSourceCategory = "college" | "general";

/** A configured subscription source. */
export interface FeedSourceDescriptor {
  /** Stable source id (also used as the SQLite key). */
  id: string;
  /** Display name, e.g. 学工门户 · 评奖评优. */
  name: string;
  category: FeedSourceCategory;
  /** Information-type tags: 评奖评优 / 出国境 / 活动 / 教务 … */
  tags: string[];
  /** Site base origin used to resolve relative links. */
  baseUrl: string;
  /** Additional hosts whose item links are allowed to open (e.g. mp.weixin.qq.com). */
  extraHosts?: string[];
  /** List page URL. */
  listUrl: string;
  /** Declarative selectors; absent when a code adapter handles this source. */
  selectors?: FeedListSelectorConfig;
  /** Code adapter id used when selectors are absent. */
  adapterId?: string;
  /** Fetch interval in minutes (default 60). */
  intervalMinutes: number;
  enabled: boolean;
}

/** A normalized notice item. */
export interface FeedItemRecord {
  /** Stable id: hash of the canonical URL. */
  id: string;
  sourceId: string;
  title: string;
  url: string;
  /** Published time when the source exposes one. */
  publishedAt: string | null;
  /** Optional excerpt. */
  summary: string | null;
  /** Hash of the detail content, used to detect edits. */
  contentHash: string;
  fetchedAt: string;
  state: "new" | "read";
}

export interface CampusFeedSnapshot {
  sources: FeedSourceDescriptor[];
  items: FeedItemRecord[];
  /** sourceId -> ISO timestamp of the last successful fetch. */
  lastRefresh: Record<string, string>;
}

export interface CampusFeedBridge {
  getSnapshot: () => Promise<CampusFeedSnapshot>;
  refreshSource: (sourceId: string) => Promise<FeedItemRecord[]>;
  refreshAll: () => Promise<void>;
  updateSource: (id: string, patch: Partial<FeedSourceDescriptor>) => Promise<FeedSourceDescriptor>;
  removeSource: (id: string) => Promise<void>;
  markRead: (ids: string[]) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  subscribe: (listener: (snapshot: CampusFeedSnapshot) => void) => () => void;
}
