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
  CampusFeedSnapshot,
  FeedItemRecord,
  FeedSourceDescriptor,
  LocalTaskInput
} from "@campusos/shared";
import {
  MVP_CAMPUS_FEED_SOURCES,
  fetchSourceList,
  isFeedSourceUrl
} from "./campusFeedSources";
import {
  createAiProviderAdapter,
  AiProviderAdapterError,
  type AiProviderAdapter,
  type AiProviderProfile
} from "./aiProviderAdapters";
import {
  CAMPUS_FEED_PROMPT_VERSION,
  CAMPUS_FEED_SCHEMA,
  CAMPUS_FEED_SYSTEM_PROMPT
} from "./campusFeedPrompt";
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
  createAdapter?: (profile: AiProviderProfile, apiKey: string) => AiProviderAdapter;
  /** Encrypts a secret for storage in the campus-feed AI settings (vault-backed). */
  encryptSecret?: (value: string) => string;
  /** Decrypts a secret stored in the campus-feed AI settings. */
  decryptSecret?: (value: string) => string;
  /** Persists an extracted schedule entry; defaults to the schedule store. */
  saveTask?: (input: LocalTaskInput) => Promise<CampusFeedScheduleImportResult>;
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
  loadAiSettings: () => Promise<CampusFeedAiConnection | null>;
  saveAiSettings: (input: CampusFeedAiInput | null) => Promise<CampusFeedAiConnection | null>;
  testAiConnection: (input: CampusFeedAiInput) => Promise<CampusFeedAiTestResult>;
  extractScheduleCandidates: (itemIds: string[]) => Promise<CampusFeedScheduleCandidate[]>;
  createScheduleTasks: (candidates: CampusFeedScheduleCandidate[]) => Promise<CampusFeedScheduleImportResult>;
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

/** AI connection as persisted in the campus-feed settings (key never plaintext). */
interface StoredCampusFeedAi {
  provider: CampusFeedAiConnection["provider"];
  protocol: CampusFeedAiConnection["protocol"];
  baseUrl: string;
  model: string;
  encryptedApiKey: string | null;
}

const isStoredCampusFeedAi = (value: unknown): value is StoredCampusFeedAi => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.provider === "openai" ||
      candidate.provider === "deepseek" ||
      candidate.provider === "anthropic" ||
      candidate.provider === "gemini" ||
      candidate.provider === "openai-compatible") &&
    typeof candidate.protocol === "string" &&
    typeof candidate.baseUrl === "string" &&
    typeof candidate.model === "string" &&
    (candidate.encryptedApiKey === null ||
      typeof candidate.encryptedApiKey === "string")
  );
};

const storedAiToConnection = (stored: StoredCampusFeedAi | null): CampusFeedAiConnection | null =>
  stored
    ? {
        provider: stored.provider,
        protocol: stored.protocol,
        baseUrl: stored.baseUrl,
        model: stored.model,
        apiKeyConfigured: Boolean(stored.encryptedApiKey)
      }
    : null;

const isCampusFeedAiInput = (value: unknown): value is CampusFeedAiInput => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.provider === "openai" ||
      candidate.provider === "deepseek" ||
      candidate.provider === "anthropic" ||
      candidate.provider === "gemini" ||
      candidate.provider === "openai-compatible") &&
    typeof candidate.protocol === "string" &&
    typeof candidate.baseUrl === "string" &&
    typeof candidate.model === "string" &&
    candidate.model.trim().length > 0
  );
};

const mapAiError = (cause: unknown): string => {
  if (cause instanceof AiProviderAdapterError) {
    const codeLabel: Record<string, string> = {
      "network-error": "无法连接 AI 服务，请检查网络。",
      "auth-error": "AI 服务认证失败，请检查 API Key。",
      "quota-error": "AI 服务配额不足。",
      "rate-limited": "AI 服务请求过于频繁，请稍后重试。",
      "model-not-found": "AI 模型不可用，请检查模型配置。",
      "unsupported-capability": "当前 AI 服务不支持结构化输出。",
      "invalid-response": "AI 返回结果无效。",
      "upstream-error": "AI 服务暂时不可用。"
    };
    return codeLabel[cause.code] ?? "AI 服务返回错误。";
  }
  return cause instanceof Error && cause.message
    ? cause.message
    : "AI 处理失败。";
};

const isCampusFeedScheduleCandidate = (
  value: unknown,
  allowedItemIds: ReadonlySet<string>
): value is CampusFeedScheduleCandidate => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.itemId !== "string" || !allowedItemIds.has(candidate.itemId)) {
    return false;
  }
  if (typeof candidate.title !== "string" || !candidate.title.trim() || candidate.title.trim().length > 60) {
    return false;
  }
  const start = Date.parse(candidate.startAt as string);
  if (!Number.isFinite(start)) return false;
  const end = candidate.endAt === null || candidate.endAt === undefined
    ? null
    : Date.parse(candidate.endAt as string);
  if (candidate.endAt !== null && candidate.endAt !== undefined && !Number.isFinite(end)) {
    return false;
  }
  const type = candidate.type;
  if (type !== "deadline" && type !== "fixed") return false;
  const location = candidate.location;
  const note = candidate.note;
  return (
    (location === null || location === undefined || (typeof location === "string" && location.length <= 120)) &&
    (note === null || note === undefined || (typeof note === "string" && note.length <= 300))
  );
};

export const createCampusFeedService = ({
  database,
  fetchFn,
  notify,
  now = () => new Date(),
  startScheduler = true,
  createAdapter = (profile: AiProviderProfile, apiKey: string) =>
    createAiProviderAdapter({ profile, apiKey }),
  encryptSecret,
  decryptSecret,
  saveTask
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
        if (!isCampusFeedAiInput(input)) {
          throw new Error("AI 连接设置格式无效。");
        }
        const nextKey = input.clearApiKey
          ? null
          : typeof input.apiKey === "string" && input.apiKey.trim().length > 0
            ? encryptSecret
              ? encryptSecret(input.apiKey.trim())
              : (() => {
                  throw new Error("安全存储不可用，无法保存 API Key。");
                })()
            : existingAi?.encryptedApiKey ?? null;
        stored = {
          provider: input.provider,
          protocol: input.protocol,
          baseUrl: input.baseUrl.trim(),
          model: input.model.trim(),
          encryptedApiKey: nextKey
        };
      }
      database.saveCampusFeedAiSettings(stored, now().toISOString());
      return storedAiToConnection(stored);
    },

    testAiConnection: async (input) => {
      if (!isCampusFeedAiInput(input) || !input.apiKey?.trim()) {
        return { ok: false, message: "请填写 API Key 后测试。" };
      }
      const adapter = createAdapter(
        {
          provider: input.provider,
          protocol: input.protocol,
          baseUrl: input.baseUrl.trim(),
          model: input.model.trim()
        },
        input.apiKey.trim()
      );
      try {
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
      const ids = itemIds.filter((id) => typeof id === "string" && id.length > 0);
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
            publishedAt: item.publishedAt
          }))
        },
        schemaName: "campus_feed_schedule_v1",
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
          if (isCampusFeedScheduleCandidate(entry, allowed)) {
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
      const ai = (() => {
        const stored = database.loadCampusFeedAiSettings();
        return stored && isStoredCampusFeedAi(stored.settings)
          ? stored.settings
          : null;
      })();
      if (!ai) throw new Error("请先配置校园资讯的 AI 连接。");
      if (!saveTask) throw new Error("日程存储不可用，请重启 CampusOS。");
      const allowed = new Set(
        database
          .listCampusFeedItems(500)
          .map((entry) => (entry.item as FeedItemRecord).id)
      );
      const result: CampusFeedScheduleImportResult = { created: 0, deduplicated: 0 };
      for (const candidate of candidates) {
        if (!isCampusFeedScheduleCandidate(candidate, allowed)) {
          throw new Error("要加入日程的条目数据无效。");
        }
        const start = Date.parse(candidate.startAt);
        const end = candidate.endAt ? Date.parse(candidate.endAt) : start;
        const minutes = Math.max(
          1,
          Math.round((Math.max(end, start) - start) / 60_000)
        );
        const outcome = await saveTask({
          title: candidate.title.trim(),
          description: candidate.note ?? "",
          startAt: new Date(start).toISOString(),
          endAt: new Date(Math.max(end, start)).toISOString(),
          location: candidate.location ?? "",
          type: candidate.type,
          breakable: false,
          blocksPlanning: false,
          timeSpentMinutes: 0,
          timeNeededMinutes: candidate.type === "deadline" ? 0 : minutes,
          repeatType: "norepeat",
          repeatPeriod: 0,
          repeatEndsOn: "",
          source: {
            kind: "ai-assistant",
            fingerprint: `campus-feed:${candidate.itemId}`,
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
