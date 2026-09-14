/**
 * Campus-feed (校园资讯) orchestration (Core, main process).
 *
 * Owns subscription sources (seeded from MVP definitions, persisted in SQLite),
 * the per-source fetch scheduler (default 1h, exponential backoff on failure,
 * stops auto-retry after 3 consecutive failures), canonical-URL dedupe, local
 * history, and new-item notifications. Notices can be AI-processed
 * (plugin-independent AI connection) into schedule entries.
 */
import type {
  CampusFeedAiConnection,
  CampusFeedAiInput,
  CampusFeedAiTestResult,
  CampusFeedScheduleCandidate,
  CampusFeedScheduleImportResult,
  CampusFeedNotificationSettings,
  CampusFeedSnapshot,
  CampusFeedPreferencesInput,
  CampusFeedItemDetail,
  FeedItemRecord,
  FeedSourceDescriptor,
  LocalTaskInput
} from "@campusos/shared";
import type { CampusFeedHistorySearchInput, CampusFeedHistorySearchResult } from "@campusos/shared";
import { createHash } from "node:crypto";
import {
  feedSourceRequestFingerprint,
  fetchSourceList,
  fetchSourceDetail,
  CampusFeedSourceError,
  isFeedSourceUrl
} from "./campusFeedSources";
import { MVP_CAMPUS_FEED_SOURCES } from "./campusFeedSourceCatalog";
import { CAMPUS_FEED_CATALOG } from "./campusFeedCatalog";
import { createFeedPreferences, readFeedPreferences, validateFeedPreferences, visibleFeedSources, type StoredFeedPreferences } from "./campusFeedStore";
import { classifyRetryError } from "@campusos/shared";
import type { DiagnosticAppendInput } from "./diagnosticLogStore";
import {
  createAiProviderAdapter,
  type AiProviderAdapter,
  type AiProviderProfile
} from "./aiProviderAdapters";
import {
  CAMPUS_FEED_PROMPT_VERSION,
  CAMPUS_FEED_SCHEMA,
  CAMPUS_FEED_SYSTEM_PROMPT
} from "./campusFeedPrompt";
import {
  isStoredCampusFeedAi,
  mapAiError,
  normalizeCampusFeedAiInput,
  storedAiToConnection,
  type StoredCampusFeedAi
} from "./campusFeedAi";
import {
  compareFeedItems,
  isCampusFeedScheduleCandidate,
  isDescriptor,
  matchesNotificationKeywords,
  normalizeInterval,
  normalizeNotificationSettings
} from "./campusFeedRules";
import type { DatabaseService } from "./databaseService";
import { isItcArticleRequest } from "./zjuItcApi";

const ITEM_PER_SOURCE_LIMIT = 50;
const BACKOFF_BASE_MS = 5 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;
const LEGACY_DEFAULT_ENABLED_SOURCE_IDS = new Set(
  MVP_CAMPUS_FEED_SOURCES.filter((source) => source.enabled).map((source) => source.id)
);
const LEGACY_SEMANTICALLY_CHANGED_SOURCE_IDS = new Set([
  "ugrs-dwjl",
  "zulg-tzgg",
  "polymer-tzgg",
  ...CAMPUS_FEED_CATALOG.filter((source) => (source.ruleVersion ?? 1) >= 3).map((source) => source.id)
]);

export interface CampusFeedNotifyInput {
  batchId: string;
  items: Array<Pick<FeedItemRecord, "id" | "title" | "summary" | "publishedAt" | "contentHash"> & {
    sourceId: string;
    sourceName: string;
  }>;
}

export interface CampusFeedServiceDependencies {
  database: DatabaseService;
  fetchFn?: typeof fetch;
  requestItcPage?: (url: string) => Promise<{ status: number; body: string }>;
  notify?: (input: CampusFeedNotifyInput) => Promise<unknown>;
  now?: () => Date;
  /** Set false in tests to keep the scheduler inert. */
  startScheduler?: boolean;
  createAdapter?: (profile: AiProviderProfile, apiKey: string) => AiProviderAdapter;
  /** Encrypts a secret for storage in the campus-feed AI settings (vault-backed). */
  encryptSecret?: (value: string) => string;
  /** Decrypts a secret stored in the campus-feed AI settings. */
  decryptSecret?: (value: string) => string;
  /** Persists an extracted schedule entry; defaults to the schedule store. */
  saveTask?: (input: LocalTaskInput) => Promise<CampusFeedScheduleImportResult>;
  /** Invoked after feed items are marked read, to sync their notification references. */
  onItemsRead?: (ids: string[]) => Promise<unknown> | void;
  /**
   * B4-1：刷新台账写入钩子（module=feed 源 id，operation=refresh）。
   * 生产环境由 main.ts 注入 appendDiagnosticEntry；测试可注入 mock。
   */
  recordDiagnostic?: (input: DiagnosticAppendInput) => Promise<void> | void;
}

export interface CampusFeedService {
  getSnapshot: () => Promise<CampusFeedSnapshot>;
  searchHistory: (input: CampusFeedHistorySearchInput) => Promise<CampusFeedHistorySearchResult>;
  getItems: (ids: string[]) => Promise<FeedItemRecord[]>;
  refreshSource: (sourceId: string) => Promise<FeedItemRecord[]>;
  refreshAll: () => Promise<void>;
  updateSource: (
    id: string,
    patch: Partial<FeedSourceDescriptor>
  ) => Promise<FeedSourceDescriptor>;
  saveNotificationSettings: (input: CampusFeedNotificationSettings) => Promise<CampusFeedNotificationSettings>;
  removeSource: (id: string) => Promise<void>;
  addSource: (id: string) => Promise<void>;
  savePreferences: (input: CampusFeedPreferencesInput) => Promise<CampusFeedSnapshot>;
  getItemDetail: (itemId: string) => Promise<CampusFeedItemDetail>;
  markRead: (ids: string[]) => Promise<void>;
  openExternal: (url: string) => Promise<string>;
  loadAiSettings: () => Promise<CampusFeedAiConnection | null>;
  saveAiSettings: (input: CampusFeedAiInput | null) => Promise<CampusFeedAiConnection | null>;
  testAiConnection: (input: CampusFeedAiInput) => Promise<CampusFeedAiTestResult>;
  extractScheduleCandidates: (itemIds: string[]) => Promise<CampusFeedScheduleCandidate[]>;
  createScheduleTasks: (candidates: CampusFeedScheduleCandidate[]) => Promise<CampusFeedScheduleImportResult>;
  subscribe: (listener: (snapshot: CampusFeedSnapshot) => void) => () => void;
}




export const createCampusFeedService = ({
  database,
  fetchFn,
  requestItcPage,
  notify,
  now = () => new Date(),
  startScheduler = true,
  createAdapter = (profile: AiProviderProfile, apiKey: string) =>
    createAiProviderAdapter({ profile, apiKey }),
  encryptSecret,
  decryptSecret,
  saveTask,
  onItemsRead,
  recordDiagnostic
}: CampusFeedServiceDependencies): CampusFeedService => {
  let sources: FeedSourceDescriptor[] = [];
  const listeners = new Set<(snapshot: CampusFeedSnapshot) => void>();
  const timers = new Map<string, NodeJS.Timeout>();
  const inFlight = new Set<string>();
  const failures = new Map<string, number>();
  const lastRefresh: Record<string, string> = {};
  let notificationSettings: CampusFeedNotificationSettings = { keywords: [] };
  let hydrated = false;
  let hydration: Promise<void> | null = null;
  let preferences: StoredFeedPreferences;
  let networkQueue: Promise<unknown> = Promise.resolve();
  let lastRequestAt = 0;
  const request = <T>(work: () => Promise<T>): Promise<T> => {
    const pending = networkQueue.then(async () => {
      const delay = startScheduler ? Math.max(0, 700 - (Date.now() - lastRequestAt)) : 0;
      if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      lastRequestAt = Date.now();
      return work();
    });
    networkQueue = pending.catch(() => undefined);
    return pending;
  };
  const limitedFetch: typeof fetch = async (input, init) => {
    const delay = startScheduler ? Math.max(0, 700 - (Date.now() - lastRequestAt)) : 0;
    if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    lastRequestAt = Date.now();
    return (fetchFn ?? fetch)(input, init);
  };
  const sourceFetch = (source: FeedSourceDescriptor): typeof fetch => source.id !== "itc-tzgg" ? limitedFetch : async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!isItcArticleRequest(url)) throw new CampusFeedSourceError("restricted", "信息技术中心链接超出已核验范围。");
    if (!requestItcPage) throw new CampusFeedSourceError("restricted", "请先在账号管理中连接统一身份认证账号。");
    try {
      const signal = init?.signal;
      if (signal?.aborted) throw new CampusFeedSourceError("network-error", "信息技术中心请求已超时。");
      // Cancel this feed consumer without cancelling shared single-flight SSO
      // used by another service. The auth transport retains its own timeouts.
      const page = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const abort = (): void => { signal?.removeEventListener("abort", abort); reject(new CampusFeedSourceError("network-error", "信息技术中心请求已超时。")); };
        signal?.addEventListener("abort", abort, { once: true });
        void requestItcPage(url).then(
          (value) => { signal?.removeEventListener("abort", abort); resolve(value); },
          (error) => { signal?.removeEventListener("abort", abort); reject(error); }
        );
      });
      return new Response(page.body, { status: page.status, headers: { "content-type": "text/html; charset=utf-8" } });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && ["network-error", "timeout", "service-unavailable"].includes(String(error.code))) {
        throw new CampusFeedSourceError("network-error", "信息技术中心网络请求失败，请稍后重试。");
      }
      throw new CampusFeedSourceError("restricted", "信息技术中心认证暂不可用，请检查账号管理中的统一认证连接。");
    }
  };
  const persist = (next: StoredFeedPreferences): void => {
    // Save first: a failed SQLite write must not leave an optimistic in-memory success.
    database.saveCampusFeedPreferences(next, now().toISOString());
    preferences = next;
    sources = visibleFeedSources(CAMPUS_FEED_CATALOG, preferences);
    const visibleIds = new Set(sources.map((source) => source.id));
    for (const id of Object.keys(lastRefresh)) {
      if (!visibleIds.has(id)) delete lastRefresh[id];
    }
  };

  /** B4-1：刷新台账写入（best-effort，失败不打断刷新流程）。 */
  const record = (input: DiagnosticAppendInput): void => {
    try {
      const pending = recordDiagnostic?.(input);
      if (pending) void pending.catch(() => undefined);
    } catch {
      // Diagnostics must never turn a successful feed refresh into a failure.
    }
  };

  const notifyBestEffort = (input: CampusFeedNotifyInput): void => {
    if (!notify) return;
    const failure = (): void => {
      record({
        module: "campus-feed",
        operation: "notify",
        state: "unavailable",
        durationMs: 0,
        retryClassification: "fatal",
        message: "校园资讯通知发送失败。"
      });
    };
    try {
      void Promise.resolve(notify(input)).catch(failure);
    } catch {
      failure();
    }
  };

  const hydrate = async (): Promise<void> => {
    if (hydrated) return;
    if (!hydration) {
      hydration = (async () => {
        const raw = database.loadCampusFeedPreferences();
        const restored = readFeedPreferences(raw, CAMPUS_FEED_CATALOG);
        if (raw !== null && !restored) throw new Error("校园资讯偏好无法读取，请保留数据并联系维护者。");
        const legacy = database.listCampusFeedSources().map((entry) => entry.config).filter(isDescriptor);
        const next = restored ?? createFeedPreferences(
          CAMPUS_FEED_CATALOG,
          legacy,
          LEGACY_DEFAULT_ENABLED_SOURCE_IDS
        );
        const changedRuleIds = restored
          ? CAMPUS_FEED_CATALOG.filter((source) => {
              const previous = restored.ruleVersions[source.id];
              return (previous ?? 1) !== (source.ruleVersion ?? 1);
            }).map((source) => source.id)
          : legacy.length > 0
            ? [...LEGACY_SEMANTICALLY_CHANGED_SOURCE_IDS].filter((sourceId) =>
                legacy.some((source) => source.id === sourceId)
              )
            : [];
        for (const sourceId of changedRuleIds) database.clearCampusFeedItemsBySource(sourceId);
        persist({
          ...next,
          history: Object.fromEntries(Object.entries(next.history ?? {}).filter(([id]) => !changedRuleIds.includes(id))),
          ruleVersions: Object.fromEntries(
            CAMPUS_FEED_CATALOG.map((source) => [source.id, source.ruleVersion ?? 1])
          )
        });
        const visibleIds = new Set(sources.map((source) => source.id));
        for (const source of sources) {
          const health = preferences.health[source.id];
          if (health?.succeededAt) {
            lastRefresh[source.id] = health.succeededAt;
            continue;
          }
          const persisted = database.loadCampusFeedRefreshState?.(source.id);
          if (persisted) lastRefresh[source.id] = persisted;
        }
        for (const id of Object.keys(lastRefresh)) {
          if (!visibleIds.has(id)) delete lastRefresh[id];
        }
        notificationSettings = normalizeNotificationSettings(
          database.loadCampusFeedNotificationSettings()?.settings ?? { keywords: [] }
        );
        hydrated = true;
      })();
    }
    await hydration;
  };

  const buildItems = (): FeedItemRecord[] => {
    const cutoff = "0000-01-01T00:00:00.000Z";
    const items: FeedItemRecord[] = [];
    for (const source of sources) {
      const rows = database.listCampusFeedItemsBySource(source.id, cutoff, ITEM_PER_SOURCE_LIMIT);
      for (const row of rows) items.push(row.item as FeedItemRecord);
    }
    return items.sort(compareFeedItems);
  };

  const broadcast = (): void => {
    const snapshot: CampusFeedSnapshot = {
      sources: sources.map((source) => ({ ...source })),
      items: buildItems(),
      lastRefresh: { ...lastRefresh },
      catalog: CAMPUS_FEED_CATALOG.map((source) => ({ ...source })),
      preferences: { profile: preferences.profile, onboarding: preferences.onboarding },
      health: { ...preferences.health },
      notificationSettings: { keywords: [...notificationSettings.keywords] }
    };
    for (const listener of listeners) {
      try { listener(snapshot); } catch { /* one renderer must not break persisted refresh state */ }
    }
  };

  const clearTimer = (sourceId: string): void => {
    const timer = timers.get(sourceId);
    if (timer) {
      clearTimeout(timer);
      timers.delete(sourceId);
    }
  };

  const refreshSourceInternal = async (sourceId: string, notifyImmediately: boolean): Promise<{
    items: FeedItemRecord[];
    notificationItems: CampusFeedNotifyInput["items"];
  }> => {
    await hydrate();
    const source = sources.find((candidate) => candidate.id === sourceId);
    if (!source) throw new Error("订阅源不存在。");
    if (inFlight.has(sourceId)) {
      throw new Error("该订阅源正在刷新。");
    }
    inFlight.add(sourceId);
    const startedAt = performance.now();
    try {
      const outcome = await request(() => performRefresh(source, startedAt));
      scheduleNext(source);
      broadcast();
      if (notifyImmediately && outcome.notificationItems.length > 0 && notify) {
        notifyBestEffort({
          batchId: `campus-feed:${source.id}:${now().toISOString()}`,
          items: outcome.notificationItems
        });
      }
      return outcome;
    } catch (cause) {
      failures.set(sourceId, (failures.get(sourceId) ?? 0) + 1);
      scheduleRetry(source);
      persist({ ...preferences, health: { ...preferences.health, [sourceId]: {
        status: cause instanceof CampusFeedSourceError ? cause.code : "error",
        attemptedAt: now().toISOString(), succeededAt: lastRefresh[sourceId],
        message: cause instanceof Error ? cause.message : "刷新失败，已保留缓存。"
      } } });
      broadcast();
      // B4-1：失败也写刷新台账（指纹由请求层同源函数计算，URL 已知）。
      record({
        module: source.id,
        operation: "refresh",
        state: "unavailable",
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        requestFingerprint: feedSourceRequestFingerprint(source),
        retryClassification: classifyRetryError(cause),
        message: cause instanceof Error ? cause.message : "刷新失败。"
      });
      throw cause;
    } finally {
      inFlight.delete(sourceId);
    }
  };

  const refreshSource = async (sourceId: string): Promise<FeedItemRecord[]> =>
    (await refreshSourceInternal(sourceId, true)).items;

  const schedule = (source: FeedSourceDescriptor, delayMs: number): void => {
    clearTimer(source.id);
    const current = sources.find((entry) => entry.id === source.id);
    if (!startScheduler || !current?.enabled || preferences.onboarding === "pending") return;
    timers.set(
      source.id,
      setTimeout(() => {
        timers.delete(source.id);
        void refreshSource(source.id).catch(() => undefined);
      }, delayMs)
    );
  };

  const scheduleNext = (source: FeedSourceDescriptor): void => {
    const current = sources.find((entry) => entry.id === source.id) ?? source;
    schedule(current, preferences.history?.[source.id]?.complete === false ? 30_000 : current.intervalMinutes * 60 * 1000);
  };

  const scheduleRetry = (source: FeedSourceDescriptor): void => {
    const count = failures.get(source.id) ?? 0;
    if (count >= MAX_CONSECUTIVE_FAILURES) return;
    const backoff = Math.min(
      source.intervalMinutes * 60 * 1000,
      BACKOFF_BASE_MS * Math.pow(2, count - 1)
    );
    schedule(source, backoff);
  };

  const performRefresh = async (
    source: FeedSourceDescriptor,
    startedAt: number
  ): Promise<{ items: FeedItemRecord[]; notificationItems: CampusFeedNotifyInput["items"] }> => {
    const hadBaseline = database.loadCampusFeedRefreshState(source.id) !== null;
    const outcome = await fetchSourceList(source, { fetchFn: sourceFetch(source), now });
    const current = preferences.subscriptions[source.id];
    if (current?.removed) return { items: [], notificationItems: [] };
    const items = outcome.items;
    const fresh: FeedItemRecord[] = [];
    for (const item of items) {
      if (database.upsertCampusFeedItem(item)) fresh.push(item);
    }
    // Archive list metadata independently from the notification baseline. One
    // continuation per refresh keeps the work bounded and restartable.
    const previous = preferences.history?.[source.id];
    if (!previous?.complete && current?.enabled) {
      const since = previous?.since ?? new Date(now().getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
      let history = previous ?? { since, pages: 0, visited: [], complete: false, message: "正在回溯近一年列表信息。" };
      try {
        let archive = outcome;
        if (previous?.nextUrl || previous?.nextPage) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          archive = await fetchSourceList(source, { fetchFn: sourceFetch(source), now, historyUrl: previous.nextUrl, historyPage: previous.nextPage });
        }
        if (preferences.subscriptions[source.id]?.removed || !preferences.subscriptions[source.id]?.enabled) return { items, notificationItems: [] };
        for (const item of archive.items) database.upsertCampusFeedItem(item);
        const cursor = previous?.nextUrl ?? (previous?.nextPage ? `page:${previous.nextPage}` : source.listUrl);
        const visited = [...history.visited, cursor];
        const pages = history.pages + 1;
        const reachedDate = archive.items.length > 0 && archive.items.every(item => item.publishedAt && Date.parse(item.publishedAt) < Date.parse(since));
        const next = archive.nextPageUrl ?? (archive.nextPageNumber ? `page:${archive.nextPageNumber}` : undefined);
        const restrictedPagination = source.id === "itc-tzgg";
        const complete = reachedDate || !next || visited.includes(next) || pages >= 1000 || restrictedPagination;
        history = { since, pages, visited, complete,
          ...(archive.nextPageUrl ? { nextUrl: archive.nextPageUrl } : {}),
          ...(archive.nextPageNumber ? { nextPage: archive.nextPageNumber } : {}),
          message: reachedDate ? "已回溯至一年前；已抓取列表信息持续保留。" : complete
            ? "已保存官网当前可访问的历史列表；该源未确认完整一年覆盖。"
            : `正在回溯近一年列表信息，已完成 ${pages} 批。` };
      } catch {
        history = { ...history, message: "历史回溯暂时失败，已保留进度，下次刷新继续。" };
      }
      persist({ ...preferences, history: { ...preferences.history, [source.id]: history } });
    }
    lastRefresh[source.id] = now().toISOString();
    persist({ ...preferences, health: { ...preferences.health, [source.id]: {
      status: items.length ? "ok" : "empty", attemptedAt: now().toISOString(), succeededAt: lastRefresh[source.id], itemCount: items.length,
      message: [outcome.partialWarning, preferences.history?.[source.id]?.message].filter(Boolean).join(" ") || undefined
    } } });
    const refreshedAt = now().toISOString();
    lastRefresh[source.id] = refreshedAt;
    database.saveCampusFeedRefreshState(source.id, refreshedAt);
    failures.delete(source.id);
    // B4-1：每次成功刷新写一条带请求指纹的台账记录。
    record({
      module: source.id,
      operation: "refresh",
      state: "live",
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      requestFingerprint: outcome.requestFingerprint
    });
    const notifiable = source.notificationEnabled === false
      ? []
      : fresh.filter((item) => matchesNotificationKeywords(item, notificationSettings));
    const notificationItems = hadBaseline
      ? notifiable.map(({ id, title, summary, publishedAt, contentHash }) => ({
          id,
          title,
          summary,
          publishedAt,
          contentHash,
          sourceId: source.id,
          sourceName: source.name
        }))
      : [];
    return { items, notificationItems };
  };

  const startInitialFetch = (): void => {
    const enabled = sources.filter((source) => source.enabled);
    enabled.forEach((source, index) => {
      schedule(source, 1000 + index * 1500);
    });
  };

  void hydrate().then(() => {
    if (startScheduler) startInitialFetch();
  }).catch(() => undefined); // getSnapshot propagates the same hydration failure to the renderer.

  const getSnapshot = async (): Promise<CampusFeedSnapshot> => {
    await hydrate();
    return { sources: sources.map((source) => ({ ...source })), items: buildItems(), lastRefresh: { ...lastRefresh },
      catalog: CAMPUS_FEED_CATALOG.map((source) => ({ ...source })), preferences: { profile: preferences.profile, onboarding: preferences.onboarding }, health: { ...preferences.health },
      notificationSettings: { keywords: [...notificationSettings.keywords] } };
  };

  const getItemDetail = async (itemId: string): Promise<CampusFeedItemDetail> => {
    await hydrate();
    const item = database.findCampusFeedItem(itemId) as FeedItemRecord | null;
    const owner = item && CAMPUS_FEED_CATALOG.find((source) => source.id === item.sourceId);
    if (!item || !owner) throw new Error("通知不存在或已取消订阅。");
    let detail: CampusFeedItemDetail;
    try { detail = await request(() => fetchSourceDetail(owner, item, { fetchFn: sourceFetch(owner), now })); }
    catch (cause) {
      const cached = database.loadCampusFeedDetail(itemId) as CampusFeedItemDetail | null;
      if (cached?.itemId === itemId && typeof cached.text === "string") return { ...cached, stale: true };
      throw cause;
    }
    const changed = database.saveCampusFeedDetail(itemId, detail, detail.fetchedAt);
    if (changed) {
      broadcast();
    }
    return detail;
  };

  return {
    getSnapshot,
    getItemDetail,
    searchHistory: async (input) => {
      await hydrate();
      if (!input || typeof input.query !== "string" || input.query.length > 500 || (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0))) throw new Error("历史搜索参数无效。");
      const terms = [...new Set(input.query.trim().toLowerCase().split(/\s+/).filter(Boolean))];
      if (!terms.length) return { items: [], total: 0 };
      if (terms.length > 20) throw new Error("请使用不超过20个关键词搜索。");
      // Current subscriptions include paused fetching and muted notifications.
      // Retained rows from removed sources re-enter search only after resubscribing.
      const sourceText = Object.fromEntries(sources.map(source => [source.id, [source.name, preferences.subscriptions[source.id]?.name, source.category, source.college, ...source.tags, ...(source.topics ?? [])].filter(Boolean).join(" ")]));
      const result = database.searchCampusFeedHistory(terms, sourceText, input.offset ?? 0, 50);
      return { items: (result.items as FeedItemRecord[]).map(item => ({ ...item, sourceName: preferences.subscriptions[item.sourceId]?.name ?? CAMPUS_FEED_CATALOG.find(source => source.id === item.sourceId)?.name ?? item.sourceId })), total: result.total };
    },
    getItems: async (ids) => {
      await hydrate();
      if (!Array.isArray(ids) || ids.length > 1000 || !ids.every(id=>typeof id === "string" && id.length > 0 && id.length <= 200)) throw new Error("历史资讯 ID 无效。");
      return [...new Set(ids)].flatMap(id => {
        const item = database.findCampusFeedItem(id) as FeedItemRecord | null;
        return item && sources.some(source=>source.id === item.sourceId) ? [item] : [];
      });
    },
    savePreferences: async (input) => {
      await hydrate();
      const clean = validateFeedPreferences(input, CAMPUS_FEED_CATALOG);
      const selected = new Set(clean.selectedSourceIds);
      const disabled = new Set(clean.disabledSourceIds ?? []);
      persist({ ...preferences, profile: clean.profile, onboarding: clean.skip ? "skipped" : "completed",
        subscriptions: Object.fromEntries(CAMPUS_FEED_CATALOG.map((source) => [source.id, { ...preferences.subscriptions[source.id], enabled: selected.has(source.id) && !disabled.has(source.id), removed: !selected.has(source.id) }])) });
      for (const id of timers.keys()) clearTimer(id);
      startInitialFetch();
      broadcast();
      return getSnapshot();
    },
    addSource: async (id) => {
      await hydrate();
      if (!CAMPUS_FEED_CATALOG.some((source) => source.id === id)) throw new Error("订阅源不存在。");
      persist({ ...preferences, onboarding: preferences.onboarding === "pending" ? "skipped" : preferences.onboarding,
        subscriptions: { ...preferences.subscriptions, [id]: { ...preferences.subscriptions[id], removed: false, enabled: true } } });
      schedule(sources.find((source) => source.id === id)!, 1000);
      broadcast();
    },

    refreshSource,

    refreshAll: async () => {
      await hydrate();
      const enabled = sources.filter((source) => source.enabled);
      const results = await Promise.allSettled(enabled.map((source) => refreshSourceInternal(source.id, false)));
      broadcast();
      const notificationItems = results.flatMap((result) => result.status === "fulfilled" ? result.value.notificationItems : []);
      if (notificationItems.length > 0 && notify) {
        notifyBestEffort({ batchId: `campus-feed:all:${now().toISOString()}`, items: notificationItems });
      }
      const failed = results.flatMap((result, index) => result.status === "rejected" ? [enabled[index].name] : []);
      if (failed.length > 0) {
        throw new Error(`${failed.length} 个信息源刷新失败：${failed.join("、")}`);
      }
    },

    updateSource: async (id, patch) => {
      await hydrate();
      const source = sources.find((candidate) => candidate.id === id);
      if (!source) throw new Error("订阅源不存在。");
      const next: FeedSourceDescriptor = { ...source };
      if (patch.enabled !== undefined) {
        if (typeof patch.enabled !== "boolean") throw new Error("订阅状态无效。");
        next.enabled = patch.enabled;
      }
      if (patch.notificationEnabled !== undefined) {
        if (typeof patch.notificationEnabled !== "boolean") throw new Error("通知状态无效。");
        next.notificationEnabled = patch.notificationEnabled;
      }
      if (patch.intervalMinutes !== undefined) {
        if (typeof patch.intervalMinutes !== "number") throw new Error("刷新间隔无效。");
        next.intervalMinutes = normalizeInterval(patch.intervalMinutes);
      }
      if (patch.name !== undefined) {
        if (typeof patch.name !== "string" || !patch.name.trim() || patch.name.trim().length > 60) {
          throw new Error("订阅源名称无效。");
        }
        next.name = patch.name.trim();
      }
      const oldPreference = preferences.subscriptions[id];
      persist({ ...preferences, subscriptions: { ...preferences.subscriptions, [id]: {
         ...oldPreference,
         enabled: next.enabled,
         ...(patch.notificationEnabled !== undefined ? { notificationEnabled: next.notificationEnabled } : {}),
         ...(patch.name !== undefined ? { name: next.name } : {}),
        ...(patch.intervalMinutes !== undefined ? { intervalMinutes: next.intervalMinutes } : {})
      } } });
      clearTimer(id);
      if (next.enabled) scheduleNext(next);
      broadcast();
      return { ...next };
    },

    saveNotificationSettings: async (input) => {
      await hydrate();
      if (typeof input !== "object" || input === null || !Array.isArray(input.keywords)) {
        throw new Error("通知关键词设置无效。");
      }
      notificationSettings = normalizeNotificationSettings(input);
      database.saveCampusFeedNotificationSettings(notificationSettings, now().toISOString());
      broadcast();
      return { keywords: [...notificationSettings.keywords] };
    },

    removeSource: async (id) => {
      await hydrate();
      if (!CAMPUS_FEED_CATALOG.some((source) => source.id === id)) throw new Error("订阅源不存在。");
      persist({ ...preferences, subscriptions: { ...preferences.subscriptions, [id]: { ...preferences.subscriptions[id], enabled: false, removed: true } } });
      clearTimer(id);
      failures.delete(id);
      delete lastRefresh[id];
      // Keep articles and read states so restoring a subscription is lossless.
      broadcast();
    },

    markRead: async (ids) => {
      await hydrate();
      const clean = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 200))];
      if (clean.length > 20_000) throw new Error("一次标记的校园资讯条目过多，请刷新后重试。");
      if (clean.length > 0) {
        database.markCampusFeedItemsRead(clean);
        if (onItemsRead) void onItemsRead(clean);
        broadcast();
      }
    },

    openExternal: async (url) => {
      await hydrate();
      if (typeof url !== "string" || !url.trim()) {
        throw new Error("缺少条目链接。");
      }
      const owner = CAMPUS_FEED_CATALOG.find((source) => isFeedSourceUrl(source, url.trim()));
      if (!owner) {
        throw new Error("条目链接不属于任何校园信息源。");
      }
      return url.trim();
    },

    loadAiSettings: async () => {
      await hydrate();
      const stored = database.loadCampusFeedAiSettings();
      if (!stored) return null;
      const value = isStoredCampusFeedAi(stored.settings)
        ? stored.settings
        : null;
      return storedAiToConnection(value);
    },

    saveAiSettings: async (input) => {
      await hydrate();
      const existing = database.loadCampusFeedAiSettings();
      const existingAi = existing && isStoredCampusFeedAi(existing.settings)
        ? existing.settings
        : null;
      let stored: StoredCampusFeedAi | null = null;
      if (input !== null) {
        const clean = normalizeCampusFeedAiInput(input);
        const canReuseExistingKey = Boolean(
          existingAi &&
          existingAi.provider === clean.provider &&
          existingAi.protocol === clean.protocol &&
          existingAi.baseUrl === clean.baseUrl
        );
        const nextKey = clean.clearApiKey
          ? null
          : clean.apiKey
            ? encryptSecret
              ? encryptSecret(clean.apiKey)
              : (() => {
                  throw new Error("安全存储不可用，无法保存 API Key。");
                })()
            : canReuseExistingKey
              ? existingAi?.encryptedApiKey ?? null
              : null;
        stored = {
          provider: clean.provider,
          protocol: clean.protocol,
          baseUrl: clean.baseUrl,
          model: clean.model,
          encryptedApiKey: nextKey
        };
      }
      database.saveCampusFeedAiSettings(stored, now().toISOString());
      return storedAiToConnection(stored);
    },

    testAiConnection: async (input) => {
      try {
        const clean = normalizeCampusFeedAiInput(input);
        if (!clean.apiKey) return { ok: false, message: "请填写 API Key 后测试。" };
        const adapter = createAdapter(
          {
            provider: clean.provider,
            protocol: clean.protocol,
            baseUrl: clean.baseUrl,
            model: clean.model
          },
          clean.apiKey
        );
        const models = adapter.supportsModelListing
          ? await adapter.listModels()
          : [];
        return {
          ok: true,
          message: models.length > 0
            ? `连接成功，可用模型 ${models.length} 个。`
            : "连接成功。"
        };
      } catch (cause) {
        return { ok: false, message: mapAiError(cause) };
      }
    },

    extractScheduleCandidates: async (itemIds) => {
      await hydrate();
      if (itemIds.length > 20) throw new Error("每次最多处理 20 条通知。");
      const ids = [...new Set(itemIds.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 200))];
      if (ids.length === 0) throw new Error("没有选择要处理的通知。");
      const stored = database.loadCampusFeedAiSettings();
      const ai = stored && isStoredCampusFeedAi(stored.settings) ? stored.settings : null;
      if (!ai?.encryptedApiKey || !decryptSecret) {
        throw new Error("请先在「设置」中配置校园资讯的 AI 连接。");
      }
      const itemMap = new Map<string, FeedItemRecord>();
      for (const id of ids) {
        const item = database.findCampusFeedItem(id);
        if (item && typeof item === "object" && "title" in item && "url" in item) {
          itemMap.set(id, item as unknown as FeedItemRecord);
        }
      }
      if (itemMap.size === 0) throw new Error("没有找到要处理的通知。");
      const sourceNameById = new Map(
        sources.map((source) => [source.id, source.name])
      );
      const adapter = createAdapter(
        {
          provider: ai.provider,
          protocol: ai.protocol,
          baseUrl: ai.baseUrl.trim(),
          model: ai.model.trim()
        },
        decryptSecret(ai.encryptedApiKey)
      );
      const details = new Map<string, CampusFeedItemDetail>();
      for (const item of itemMap.values()) {
        const detail = await getItemDetail(item.id);
        if (detail.stale) throw new Error("当前只有离线正文缓存，请恢复网络核对最新通知后再转为日程。");
        details.set(item.id, detail);
      }
      const raw = await adapter.generateStructured({
        systemPrompt: CAMPUS_FEED_SYSTEM_PROMPT,
        input: {
          now: now().toISOString(),
          promptVersion: CAMPUS_FEED_PROMPT_VERSION,
          items: [...itemMap.values()].map((item) => ({
            id: item.id,
            sourceName: sourceNameById.get(item.sourceId) ?? item.sourceId,
            title: item.title,
            url: item.url,
            publishedAt: item.publishedAt,
            content: details.get(item.id)?.text,
            attachments: details.get(item.id)?.attachments
          }))
        },
        schemaName: "campus_feed_schedule_v2",
        schema: CAMPUS_FEED_SCHEMA
      });
      const allowed = new Set(itemMap.keys());
      const candidates: CampusFeedScheduleCandidate[] = [];
      if (
        typeof raw === "object" &&
        raw !== null &&
        Array.isArray((raw as { candidates?: unknown }).candidates)
      ) {
        for (const entry of (raw as { candidates: unknown[] }).candidates) {
          const entryId = typeof entry === "object" && entry !== null ? (entry as { itemId?: string }).itemId : undefined;
          if (isCampusFeedScheduleCandidate(entry, allowed, details.get(entryId ?? "")?.text ?? "")) {
            const candidate = entry as CampusFeedScheduleCandidate;
            const start = Date.parse(candidate.startAt);
            const end = candidate.endAt ? Date.parse(candidate.endAt) : start;
            candidates.push({
              ...candidate,
              title: candidate.title.trim(),
              startAt: new Date(start).toISOString(),
              endAt: candidate.endAt
                ? new Date(Math.max(end, start)).toISOString()
                : null,
              location: candidate.location?.trim() || null,
              note: candidate.note?.trim() || null
            });
          }
        }
      }
      return candidates;
    },

    createScheduleTasks: async (candidates) => {
      await hydrate();
      if (candidates.length > 50) throw new Error("每次最多加入 50 条日程。");
      const ai = (() => {
        const stored = database.loadCampusFeedAiSettings();
        return stored && isStoredCampusFeedAi(stored.settings)
          ? stored.settings
          : null;
      })();
      if (!ai) throw new Error("请先配置校园资讯的 AI 连接。");
      if (!saveTask) throw new Error("日程存储不可用，请重启 CampusOS。");
      const allowed = new Set(
        candidates
          .map((candidate) => candidate?.itemId)
          .filter((id): id is string => typeof id === "string" && database.findCampusFeedItem(id) !== null)
      );
      const result: CampusFeedScheduleImportResult = { created: 0, deduplicated: 0 };
      // Validate the whole batch before writing any task, including evidence from
      // the locally cached body that produced the reviewable extraction preview.
      for (const candidate of candidates) {
        const detail = database.loadCampusFeedDetail(candidate?.itemId) as CampusFeedItemDetail | null;
        if (!isCampusFeedScheduleCandidate(candidate, allowed, detail?.text ?? "")) {
          throw new Error("要加入日程的条目数据无效。");
        }
      }
      for (const candidate of candidates) {
        const candidateStart = Date.parse(candidate.startAt);
        const candidateEnd = candidate.endAt ? Date.parse(candidate.endAt) : candidateStart;
        const hasDuration = candidateEnd > candidateStart;
        const start = hasDuration
          ? candidateStart
          : candidate.type === "deadline"
            ? candidateStart - 60 * 60_000
            : candidateStart;
        const end = hasDuration
          ? candidateEnd
          : candidate.type === "deadline"
            ? candidateStart
            : candidateStart + 60 * 60_000;
        const minutes = Math.max(
          1,
          Math.round((end - start) / 60_000)
        );
        const outcome = await saveTask({
          title: candidate.title.trim(),
          description: [candidate.note, candidate.evidence && `原文依据：${candidate.evidence}`, (database.findCampusFeedItem(candidate.itemId) as FeedItemRecord | null)?.url].filter(Boolean).join("\n"),
          startAt: new Date(start).toISOString(),
          endAt: new Date(end).toISOString(),
          location: candidate.location ?? "",
          type: candidate.type,
          breakable: false,
          blocksPlanning: false,
          timeSpentMinutes: 0,
          timeNeededMinutes: minutes,
          repeatType: "norepeat",
          repeatPeriod: 0,
          repeatEndsOn: new Date(end).toISOString(),
          source: {
            kind: "ai-assistant",
            fingerprint: `campus-feed:${candidate.itemId}:${createHash("sha256").update(`${candidate.type}\n${candidate.title.trim()}\n${new Date(start).toISOString()}\n${new Date(end).toISOString()}`).digest("hex").slice(0, 20)}`,
            provider: ai.provider,
            model: ai.model,
            importedAt: now().toISOString()
          }
        });
        result.created += outcome.created;
        result.deduplicated += outcome.deduplicated;
      }
      return result;
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
};
