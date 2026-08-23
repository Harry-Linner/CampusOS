/**
 * Campus-feed (校园资讯) orchestration (Core, main process).
 *
 * Owns subscription sources (seeded from MVP definitions, persisted in SQLite),
 * the per-source fetch scheduler (default 1h, exponential backoff on failure,
 * stops auto-retry after 3 consecutive failures), canonical-URL dedupe, local
 * history, and new-item notifications. No campus data is involved.
 */
import type {
  CampusFeedSnapshot,
  FeedItemRecord,
  FeedSourceDescriptor
} from "@campusos/shared";
import { MVP_CAMPUS_FEED_SOURCES, fetchSourceList, isFeedSourceUrl } from "./campusFeedSources";
import type { DatabaseService } from "./databaseService";

const DEFAULT_ITEM_LIMIT = 500;
const MAX_INTERVAL_MINUTES = 1440;
const MIN_INTERVAL_MINUTES = 1;
const BACKOFF_BASE_MS = 5 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;

export interface CampusFeedNotifyInput {
  title: string;
  body: string;
  actionTarget?: string | null;
}

export interface CampusFeedServiceDependencies {
  database: DatabaseService;
  fetchFn?: typeof fetch;
  notify?: (input: CampusFeedNotifyInput) => Promise<unknown>;
  now?: () => Date;
  /** Set false in tests to keep the scheduler inert. */
  startScheduler?: boolean;
}

export interface CampusFeedService {
  getSnapshot: () => Promise<CampusFeedSnapshot>;
  refreshSource: (sourceId: string) => Promise<FeedItemRecord[]>;
  refreshAll: () => Promise<void>;
  updateSource: (
    id: string,
    patch: Partial<FeedSourceDescriptor>
  ) => Promise<FeedSourceDescriptor>;
  removeSource: (id: string) => Promise<void>;
  markRead: (ids: string[]) => Promise<void>;
  openExternal: (url: string) => Promise<string>;
  subscribe: (listener: (snapshot: CampusFeedSnapshot) => void) => () => void;
}

const isDescriptor = (value: unknown): value is FeedSourceDescriptor => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.baseUrl === "string" &&
    typeof candidate.listUrl === "string" &&
    (candidate.category === "college" || candidate.category === "general") &&
    Array.isArray(candidate.tags) &&
    typeof candidate.intervalMinutes === "number" &&
    typeof candidate.enabled === "boolean"
  );
};

const normalizeInterval = (value: number): number => {
  if (!Number.isFinite(value)) return 60;
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(value)));
};

export const createCampusFeedService = ({
  database,
  fetchFn,
  notify,
  now = () => new Date(),
  startScheduler = true
}: CampusFeedServiceDependencies): CampusFeedService => {
  let sources: FeedSourceDescriptor[] = [];
  const listeners = new Set<(snapshot: CampusFeedSnapshot) => void>();
  const timers = new Map<string, NodeJS.Timeout>();
  const inFlight = new Set<string>();
  const failures = new Map<string, number>();
  const lastRefresh: Record<string, string> = {};
  let hydrated = false;
  let hydration: Promise<void> | null = null;

  const hydrate = async (): Promise<void> => {
    if (hydrated) return;
    if (!hydration) {
      hydration = (async () => {
        const stored = database.listCampusFeedSources();
        if (stored.length === 0) {
          sources = MVP_CAMPUS_FEED_SOURCES.map((source) => ({ ...source }));
          const savedAt = now().toISOString();
          for (const source of sources) {
            database.saveCampusFeedSource(source.id, source, savedAt);
          }
        } else {
          sources = stored
            .map((entry) => entry.config)
            .filter(isDescriptor)
            .map((source) => ({ ...source }));
        }
        hydrated = true;
      })();
    }
    await hydration;
  };

  const broadcast = (): void => {
    const snapshot: CampusFeedSnapshot = {
      sources: sources.map((source) => ({ ...source })),
      items: database
        .listCampusFeedItems(DEFAULT_ITEM_LIMIT)
        .map((entry) => entry.item as FeedItemRecord),
      lastRefresh: { ...lastRefresh }
    };
    for (const listener of listeners) listener(snapshot);
  };

  const clearTimer = (sourceId: string): void => {
    const timer = timers.get(sourceId);
    if (timer) {
      clearTimeout(timer);
      timers.delete(sourceId);
    }
  };

  const refreshSource = async (sourceId: string): Promise<FeedItemRecord[]> => {
    await hydrate();
    const source = sources.find((candidate) => candidate.id === sourceId);
    if (!source) throw new Error("订阅源不存在。");
    if (inFlight.has(sourceId)) {
      throw new Error("该订阅源正在刷新。");
    }
    inFlight.add(sourceId);
    try {
      const items = await performRefresh(source);
      scheduleNext(source);
      broadcast();
      return items;
    } catch (cause) {
      failures.set(sourceId, (failures.get(sourceId) ?? 0) + 1);
      scheduleRetry(source);
      throw cause;
    } finally {
      inFlight.delete(sourceId);
    }
  };

  const schedule = (source: FeedSourceDescriptor, delayMs: number): void => {
    clearTimer(source.id);
    if (!source.enabled) return;
    timers.set(
      source.id,
      setTimeout(() => {
        timers.delete(source.id);
        void refreshSource(source.id).catch(() => undefined);
      }, delayMs)
    );
  };

  const scheduleNext = (source: FeedSourceDescriptor): void => {
    schedule(source, source.intervalMinutes * 60 * 1000);
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
    source: FeedSourceDescriptor
  ): Promise<FeedItemRecord[]> => {
    const items = await fetchSourceList(source, { fetchFn, now });
    const fresh: FeedItemRecord[] = [];
    for (const item of items) {
      if (database.upsertCampusFeedItem(item)) fresh.push(item);
    }
    lastRefresh[source.id] = now().toISOString();
    failures.delete(source.id);
    if (fresh.length > 0 && notify) {
      const body = fresh
        .slice(0, 5)
        .map((item) => item.title)
        .join("、");
      const suffix = fresh.length > 5 ? ` 等 ${fresh.length} 条` : "";
      void notify({
        title: source.name,
        body: `${body}${suffix}`.slice(0, 160),
        actionTarget: "campus-feed"
      });
    }
    return items;
  };

  const startInitialFetch = (): void => {
    const enabled = sources.filter((source) => source.enabled);
    enabled.forEach((source, index) => {
      schedule(source, 1000 + index * 1500);
    });
  };

  void hydrate().then(() => {
    if (startScheduler) startInitialFetch();
  });

  return {
    getSnapshot: async () => {
      await hydrate();
      return {
        sources: sources.map((source) => ({ ...source })),
        items: database
          .listCampusFeedItems(DEFAULT_ITEM_LIMIT)
          .map((entry) => entry.item as FeedItemRecord),
        lastRefresh: { ...lastRefresh }
      };
    },

    refreshSource,

    refreshAll: async () => {
      await hydrate();
      const enabled = sources.filter((source) => source.enabled);
      await Promise.allSettled(
        enabled.map((source) =>
          refreshSource(source.id).catch(() => undefined)
        )
      );
      broadcast();
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
      sources = sources.map((candidate) =>
        candidate.id === id ? next : candidate
      );
      database.saveCampusFeedSource(id, next, now().toISOString());
      clearTimer(id);
      if (next.enabled) scheduleNext(next);
      broadcast();
      return { ...next };
    },

    removeSource: async (id) => {
      await hydrate();
      sources = sources.filter((candidate) => candidate.id !== id);
      clearTimer(id);
      failures.delete(id);
      delete lastRefresh[id];
      database.deleteCampusFeedSource(id);
      broadcast();
    },

    markRead: async (ids) => {
      await hydrate();
      const clean = ids.filter((id) => typeof id === "string" && id.length > 0);
      if (clean.length > 0) {
        database.markCampusFeedItemsRead(clean);
        broadcast();
      }
    },

    openExternal: async (url) => {
      if (typeof url !== "string" || !url.trim()) {
        throw new Error("缺少条目链接。");
      }
      const owner = sources.find((source) => isFeedSourceUrl(source, url.trim()));
      if (!owner) {
        throw new Error("条目链接不属于任何已订阅信息源。");
      }
      return url.trim();
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
};
