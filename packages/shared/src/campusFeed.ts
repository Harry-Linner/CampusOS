/**
 * campus-feed (校园资讯) shared types.
 *
 * Aggregates notices published across campus websites (awards, study-abroad
 * programs, campus events, college announcements). Sources are described by
 * declarative list selectors (RSSHub-style) or a code adapter id; the core
 * service fetches on a per-source interval, dedupes by canonical URL, stores
 * history locally, and pushes new items into the notification center.
 * Notices can be AI-processed (plugin-independent AI connection) into schedule
 * entries.
 */

import type { AiAssistantProtocol, AiAssistantProvider } from "./pluginCapabilities";

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
  /** Verified fixed prefix for a site's explicit two-digit year format. */
  timePrefix?: string;
  /** Page charset override for legacy sites (e.g. "gbk"). */
  encoding?: string;
  /** Split display dates used by logistics/college sites. */
  dateParts?: { yearMonth: string; day: string; yearPrefix?: string };
  /** Follow a real next-page link instead of guessing a URL. */
  nextPage?: string;
}

export type FeedSourceCategory = "college" | "general";

/** A configured subscription source. */
export interface FeedSourceDescriptor {
  /** Stable source id (also used as the SQLite key). */
  id: string;
  /** Display name, e.g. 学工门户 · 评奖评优. */
  name: string;
  /** Optional website/column grouping for subscription discovery. */
  site?: { id: string; name: string; column: string };
  /** New columns keep their own rows even when another column links to the same URL. */
  itemIdScope?: "source";
  /** Topic-specific and archival columns should not be selected by identity alone. */
  recommendation?: "default" | "interest" | "manual";
  category: FeedSourceCategory;
  /** Information-type tags: 评奖评优 / 出国境 / 活动 / 教务 … */
  tags: string[];
  /** Site base origin used to resolve relative links. */
  baseUrl: string;
  /** Additional hosts whose item links are allowed to open (e.g. mp.weixin.qq.com). */
  extraHosts?: string[];
  /** List page URL. */
  listUrl: string;
  /** 声明式抓取页数（苏迪分页 list2.htm…），默认 1（只抓第 1 页）。 */
  maxPages?: number;
  /** Declarative selectors; absent when a code adapter handles this source. */
  selectors?: FeedListSelectorConfig;
  /** Code adapter id used when selectors are absent. */
  adapterId?: string;
  /** Only the source's own host is normalized; never relax redirect validation. */
  linkNormalization?: "https" | "webplus-https-psp";
  /** Fetch interval in minutes (default 60). */
  intervalMinutes: number;
  enabled: boolean;
  verification?: FeedSourceVerification;
  audience?: CampusFeedIdentity[];
  /** Explicit department ownership; audience alone does not imply ownership. */
  academicOffice?: "undergraduate" | "graduate";
  college?: string;
  topics?: string[];
  ruleVersion?: number;
  /** Whether new matching items from this source enter the notification system. */
  notificationEnabled?: boolean;
}

export interface CampusFeedNotificationSettings {
  /** Global OR-matched terms applied to title and summary. Empty means no filtering. */
  keywords: string[];
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
  notificationSettings: CampusFeedNotificationSettings;
  /** sourceId -> ISO timestamp of the last successful fetch. */
  lastRefresh: Record<string, string>;
  catalog?: FeedSourceDescriptor[];
  preferences?: CampusFeedPreferences;
  health?: Record<string, FeedSourceHealth>;
}

export interface CampusFeedBridge {
  getSnapshot: () => Promise<CampusFeedSnapshot>;
  searchHistory: (input: CampusFeedHistorySearchInput) => Promise<CampusFeedHistorySearchResult>;
  getItems: (ids: string[]) => Promise<FeedItemRecord[]>;
  refreshSource: (sourceId: string) => Promise<FeedItemRecord[]>;
  refreshAll: () => Promise<void>;
  updateSource: (id: string, patch: Partial<FeedSourceDescriptor>) => Promise<FeedSourceDescriptor>;
  saveNotificationSettings: (input: CampusFeedNotificationSettings) => Promise<CampusFeedNotificationSettings>;
  removeSource: (id: string) => Promise<void>;
  addSource: (id: string) => Promise<void>;
  savePreferences: (input: CampusFeedPreferencesInput) => Promise<CampusFeedSnapshot>;
  getItemDetail: (itemId: string) => Promise<CampusFeedItemDetail>;
  markRead: (ids: string[]) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  loadAiSettings: () => Promise<CampusFeedAiConnection | null>;
  saveAiSettings: (input: CampusFeedAiInput | null) => Promise<CampusFeedAiConnection | null>;
  testAiConnection: (input: CampusFeedAiInput) => Promise<CampusFeedAiTestResult>;
  extractScheduleCandidates: (itemIds: string[]) => Promise<CampusFeedScheduleCandidate[]>;
  createScheduleTasks: (candidates: CampusFeedScheduleCandidate[]) => Promise<CampusFeedScheduleImportResult>;
  subscribe: (listener: (snapshot: CampusFeedSnapshot) => void) => () => void;
}

export interface CampusFeedHistorySearchInput {
  query: string;
  offset?: number;
}
export interface CampusFeedHistorySearchResult {
  items: Array<FeedItemRecord & { sourceName?: string }>;
  total: number;
}

export type CampusFeedAiProvider = AiAssistantProvider;
export type CampusFeedAiProtocol = AiAssistantProtocol;

/** Campus-feed AI connection, independent of the AI Assistant settings. */
export interface CampusFeedAiConnection {
  provider: CampusFeedAiProvider;
  protocol: CampusFeedAiProtocol;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
}

/** User-editable AI connection; `apiKey` is transient over IPC only. */
export interface CampusFeedAiInput {
  provider: CampusFeedAiProvider;
  protocol: CampusFeedAiProtocol;
  baseUrl: string;
  model: string;
  /** Present when the user re-enters a key; omitting keeps the stored one. */
  apiKey?: string;
  /** True clears the stored key. */
  clearApiKey?: boolean;
}

export interface CampusFeedAiTestResult {
  ok: boolean;
  message: string;
}

/** A schedule entry extracted from a notice by AI. */
export interface CampusFeedScheduleCandidate {
  /** Feed item id the candidate was extracted from. */
  itemId: string;
  title: string;
  startAt: string;
  endAt: string | null;
  location: string | null;
  note: string | null;
  /** "deadline" = 截止类 (no time block), "fixed" = 固定时间活动. */
  type: "deadline" | "fixed";
  /** Exact excerpt from the fetched article, for user verification. */
  evidence?: string;
}

export type CampusFeedIdentity = "undergraduate" | "master" | "doctor";
export interface CampusFeedProfile {
  identity: CampusFeedIdentity | null;
  college: string | null;
  interests: string[];
}
export interface CampusFeedPreferences {
  profile: CampusFeedProfile;
  onboarding: "pending" | "completed" | "skipped" | "existing";
}
export interface CampusFeedPreferencesInput {
  profile: CampusFeedProfile;
  selectedSourceIds: string[];
  /** Existing subscriptions paused with their refresh switch off. */
  disabledSourceIds?: string[];
  skip?: boolean;
}
export interface FeedSourceVerification {
  status: "verified" | "list-only" | "unverified" | "restricted" | "stale";
  checkedAt: string | null;
  note: string;
}
export interface FeedSourceHealth {
  status: "ok" | "empty" | "network-error" | "restricted" | "layout-changed" | "error";
  attemptedAt: string;
  succeededAt?: string;
  itemCount?: number;
  message?: string;
}
export interface CampusFeedItemDetail {
  itemId: string;
  title: string;
  url: string;
  text: string;
  attachments: { name: string; url: string }[];
  fetchedAt: string;
  contentHash: string;
  /** True when a network failure required falling back to saved content. */
  stale?: boolean;
}

export const CAMPUS_FEED_IDENTITIES: { value: CampusFeedIdentity; label: string }[] = [
  { value: "undergraduate", label: "本科生" }, { value: "master", label: "硕士生" },
  { value: "doctor", label: "博士生" }
];
export const CAMPUS_FEED_INTERESTS = ["教务考试", "奖助评优", "升学招生", "就业实习", "国际交流", "讲座科研", "活动社团", "图书资源", "校园生活", "校园新闻"];

/** Deterministic local explanations; profile data never needs an AI request. */
export const campusFeedRecommendationReasons = (source: FeedSourceDescriptor, profile: CampusFeedProfile): string[] => {
  const collegeOwned = source.category === "college" || Boolean(source.college);
  // Explicit ownership takes precedence over topic, audience and discovery
  // policy. Other colleges never enter through a matching interest.
  if (collegeOwned) {
    return source.college && source.college === profile.college ? [`来自你的学院：${profile.college}`] : [];
  }
  if ((source.academicOffice === "undergraduate" && profile.identity === "undergraduate") ||
      (source.academicOffice === "graduate" && (profile.identity === "master" || profile.identity === "doctor"))) {
    return [`来自${source.academicOffice === "undergraduate" ? "本科生院" : "研究生院"}`];
  }
  // Interests add public sources. An optional, unanswered identity is not a
  // rejection; an explicitly incompatible audience still limits this branch.
  if (source.recommendation === "manual") return [];
  if (source.verification && !["verified", "list-only"].includes(source.verification.status)) return [];
  if (profile.identity && source.audience?.length && !source.audience.includes(profile.identity)) return [];
  return profile.interests.filter(interest => source.topics?.includes(interest)).map(interest => `你关注${interest}`);
};

export interface CampusFeedScheduleImportResult {
  created: number;
  deduplicated: number;
}
