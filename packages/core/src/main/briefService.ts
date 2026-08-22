/**
 * Daily Brief orchestration (Core, main process).
 *
 * Phase 0 chain: store (profile/snapshot) -> fetcher (whitelisted feeds) ->
 * AI structured generation (reusing the AI Assistant runtime connection) ->
 * strict validation -> snapshot persistence. No campus data is involved.
 */
import type {
  BriefCachedItem,
  BriefItem,
  BriefProfile,
  BriefProfileInput,
  BriefSection,
  BriefSnapshot,
  BriefState
} from "@campusos/shared";
import {
  BRIEF_MAX_ITEMS_PER_SECTION,
  BRIEF_MAX_NOTE,
  BRIEF_MAX_ORIGINAL_TITLE,
  BRIEF_MAX_SECTIONS,
  BRIEF_MAX_SUMMARY,
  BRIEF_MAX_TITLE_ZH,
  isBriefProfile
} from "@campusos/shared";
import {
  BRIEF_PROMPT_VERSION,
  BRIEF_SCHEMA,
  BRIEF_SYSTEM_PROMPT
} from "@campusos/plugin-daily-brief/prompt";
import {
  AiProviderAdapterError,
  createAiProviderAdapter,
  type AiProviderAdapter,
  type AiProviderProfile
} from "./aiProviderAdapters";
import type { AiRuntime } from "./aiRuntime";
import {
  BRIEF_SOURCE_IDS,
  BRIEF_SOURCE_DEFINITIONS,
  isBriefSourceUrl,
  type BriefFetcher
} from "./briefInfoSources";
import type { BriefStore } from "./briefStore";

export class BriefServiceError extends Error {
  constructor(
    readonly code:
      | "invalid-input"
      | "not-configured"
      | "storage-error"
      | "network-error"
      | "auth-error"
      | "quota-error"
      | "rate-limited"
      | "model-not-found"
      | "unsupported-capability"
      | "upstream-error"
      | "invalid-response"
      | "not-found",
    message: string,
    options: { cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "BriefServiceError";
  }
}

export interface BriefServiceDependencies {
  store: BriefStore;
  runtime: AiRuntime;
  fetchSources: BriefFetcher;
  createAdapter?: (profile: AiProviderProfile, apiKey: string) => AiProviderAdapter;
  now?: () => Date;
  timezone?: string;
}

export interface BriefService {
  getState: () => Promise<BriefState>;
  refresh: () => Promise<BriefState>;
  /** Resolves a cached fingerprint to a validated https URL for the caller to open. */
  openExternal: (fingerprint: string) => Promise<string>;
  loadSettings: () => Promise<BriefProfile>;
  saveSettings: (input: BriefProfileInput) => Promise<BriefProfile>;
  subscribe: (listener: (state: BriefState) => void) => () => void;
}

const defaultProfile = (): BriefProfile => ({
  interests: [],
  sourceEnabled: Object.fromEntries(
    BRIEF_SOURCE_IDS.map((id) => [id, true])
  ),
  savedAt: null
});

const shanghaiParts = (value: Date, timezone: string): Record<string, string> =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

const shanghaiDate = (value: Date, timezone: string): string => {
  const parts = shanghaiParts(value, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const shanghaiNow = (value: Date, timezone: string): string => {
  const parts = shanghaiParts(value, timezone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00+08:00`;
};

const validateHttpsUrl = (value: string, sourceId?: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (sourceId && !isBriefSourceUrl(sourceId, value)) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const mapProviderError = (cause: unknown): string => {
  if (cause instanceof BriefServiceError) return cause.message;
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
    : "早报生成失败。";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeBriefItem = (
  raw: unknown,
  itemMap: Map<string, BriefCachedItem>,
  sourceLabelById: Map<string, string>
): BriefItem | null => {
  if (!isRecord(raw)) return null;
  const fingerprint = raw.fingerprint;
  if (typeof fingerprint !== "string" || !itemMap.has(fingerprint)) return null;
  const cached = itemMap.get(fingerprint)!;
  const url = typeof raw.url === "string" ? raw.url : "";
  if (url !== cached.url) return null;
  if (!validateHttpsUrl(url, cached.sourceId)) return null;
  const titleZh = typeof raw.titleZh === "string" ? raw.titleZh.trim() : "";
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  const originalTitle = typeof raw.originalTitle === "string" ? raw.originalTitle.trim() : "";
  if (!titleZh || titleZh.length > BRIEF_MAX_TITLE_ZH) return null;
  if (!summary || summary.length > BRIEF_MAX_SUMMARY) return null;
  if (!originalTitle || originalTitle.length > BRIEF_MAX_ORIGINAL_TITLE) return null;
  const relevance = raw.relevance;
  if (
    relevance !== undefined &&
    relevance !== null &&
    (typeof relevance !== "string" || relevance.length > 200)
  ) {
    return null;
  }
  return {
    fingerprint,
    sourceId: cached.sourceId,
    sourceLabel: sourceLabelById.get(cached.sourceId) ?? cached.sourceId,
    titleZh,
    summary,
    originalTitle,
    url,
    relevance: typeof relevance === "string" && relevance.trim()
      ? relevance.trim()
      : null
  };
};

export const validateBrief = (
  raw: unknown,
  itemMap: Map<string, BriefCachedItem>,
  sourceLabelById: Map<string, string>,
  degradedSources: readonly string[],
  now: Date,
  timezone: string
): BriefSnapshot => {
  if (!isRecord(raw)) {
    throw new BriefServiceError("invalid-response", "AI 返回的早报结构无效。");
  }
  if (!Array.isArray(raw.sections) || raw.sections.length > BRIEF_MAX_SECTIONS) {
    throw new BriefServiceError("invalid-response", "AI 返回的板块数量无效。");
  }
  const sections: BriefSection[] = [];
  for (const rawSection of raw.sections) {
    if (!isRecord(rawSection)) {
      throw new BriefServiceError("invalid-response", "AI 返回的板块结构无效。");
    }
    const interest = typeof rawSection.interest === "string" ? rawSection.interest.trim() : "";
    if (!interest || interest.length > 50) {
      throw new BriefServiceError("invalid-response", "AI 返回的领域名称无效。");
    }
    if (
      !Array.isArray(rawSection.items) ||
      rawSection.items.length > BRIEF_MAX_ITEMS_PER_SECTION
    ) {
      throw new BriefServiceError("invalid-response", "AI 返回的条目数量无效。");
    }
    const items: BriefItem[] = [];
    for (const rawItem of rawSection.items) {
      const item = normalizeBriefItem(rawItem, itemMap, sourceLabelById);
      if (!item) {
        throw new BriefServiceError(
          "invalid-response",
          "AI 返回了不在本次抓取范围内的条目，已拒绝整期早报。"
        );
      }
      items.push(item);
    }
    if (items.length > 0) sections.push({ interest, items });
  }
  const note = raw.note;
  if (
    note !== undefined &&
    note !== null &&
    (typeof note !== "string" || note.length > BRIEF_MAX_NOTE)
  ) {
    throw new BriefServiceError("invalid-response", "AI 返回的整体说明无效。");
  }
  return {
    date: shanghaiDate(now, timezone),
    generatedAt: now.toISOString(),
    sections,
    degradedSources: [...new Set(degradedSources)],
    note: typeof note === "string" && note.trim() ? note.trim() : null
  };
};

export const createBriefService = ({
  store,
  runtime,
  fetchSources,
  createAdapter = (profile: AiProviderProfile, apiKey: string) =>
    createAiProviderAdapter({ profile, apiKey }),
  now = () => new Date(),
  timezone = "Asia/Shanghai"
}: BriefServiceDependencies): BriefService => {
  let state: BriefState = { status: "idle", snapshot: null, error: null };
  const listeners = new Set<(state: BriefState) => void>();
  let hydrated = false;
  let hydration: Promise<void> | null = null;
  let refreshInFlight: Promise<BriefState> | null = null;

  const setState = (next: BriefState): void => {
    state = next;
    for (const listener of listeners) listener(state);
  };

  const sourceLabelById = new Map(
    BRIEF_SOURCE_DEFINITIONS.map((source) => [source.id, source.label])
  );

  const hydrate = async (): Promise<void> => {
    if (hydrated) return;
    if (!hydration) {
      hydration = store.loadSnapshot().then((stored) => {
        hydrated = true;
        if (stored?.snapshot) {
          state = { status: "ready", snapshot: stored.snapshot, error: null };
        }
      }).catch((cause) => {
        hydrated = true;
        setState({
          status: "error",
          snapshot: null,
          error: cause instanceof Error ? cause.message : "早报缓存读取失败。"
        });
      }).finally(() => {
        hydration = null;
      });
    }
    await hydration;
  };

  const performRefresh = async (): Promise<BriefState> => {
    await hydrate();
    setState({ status: "fetching", snapshot: state.snapshot, error: null });
    try {
      const profile = (await store.loadProfile()) ?? defaultProfile();
      const enabledSourceIds = BRIEF_SOURCE_IDS.filter(
        (id) => profile.sourceEnabled[id] !== false
      );
      if (enabledSourceIds.length === 0) {
        setState({
          status: "error",
          snapshot: state.snapshot,
          error: "请先在早报设置中启用至少一个信息源。"
        });
        return state;
      }
      const outcome = await fetchSources({ enabledSourceIds });
      const freshItems: BriefCachedItem[] = [];
      for (const item of outcome.items) {
        if (await store.upsertItem(item)) freshItems.push(item);
      }

      if (freshItems.length === 0) {
        if (outcome.degraded.length === enabledSourceIds.length) {
          setState({
            status: "error",
            snapshot: state.snapshot,
            error: "所有信息源抓取失败，请检查网络后重试。"
          });
          return state;
        }
        if (state.snapshot) {
          setState({ status: "ready", snapshot: state.snapshot, error: null });
          return state;
        }
        const empty: BriefSnapshot = {
          date: shanghaiDate(now(), timezone),
          generatedAt: now().toISOString(),
          sections: [],
          degradedSources: outcome.degraded,
          note: outcome.degraded.length > 0
            ? "部分信息源暂不可用，当前没有新内容。"
            : "今日暂无新内容。"
        };
        await store.saveSnapshot(empty);
        setState({ status: "ready", snapshot: empty, error: null });
        return state;
      }

      const connection = await runtime.load();
      if (!connection.configured) {
        setState({
          status: "error",
          snapshot: state.snapshot,
          error: "请先在 AI 助手设置中配置 API Key。"
        });
        return state;
      }

      setState({ status: "generating", snapshot: state.snapshot, error: null });
      const adapter = createAdapter(connection.profile, connection.apiKey);
      const itemMap = new Map(freshItems.map((item) => [item.fingerprint, item]));
      const grouped = freshItems.reduce<Map<string, BriefCachedItem[]>>(
        (acc, item) => {
          const list = acc.get(item.sourceId) ?? [];
          list.push(item);
          acc.set(item.sourceId, list);
          return acc;
        },
        new Map()
      );

      const raw = await adapter.generateStructured({
        systemPrompt: BRIEF_SYSTEM_PROMPT,
        input: {
          now: shanghaiNow(now(), timezone),
          promptVersion: BRIEF_PROMPT_VERSION,
          profile: profile.interests,
          sources: [...grouped.entries()].map(([sourceId, items]) => ({
            sourceId,
            label: sourceLabelById.get(sourceId) ?? sourceId,
            items: items.map((item) => ({
              fingerprint: item.fingerprint,
              title: item.title,
              summary: item.summary,
              url: item.url,
              publishedAt: item.publishedAt
            }))
          }))
        },
        schemaName: "daily_brief_v1",
        schema: BRIEF_SCHEMA as unknown as Record<string, unknown>
      });

      const snapshot = validateBrief(
        raw,
        itemMap,
        sourceLabelById,
        outcome.degraded,
        now(),
        timezone
      );
      await store.saveSnapshot(snapshot);
      setState({ status: "ready", snapshot, error: null });
      return state;
    } catch (cause) {
      setState({
        status: "error",
        snapshot: state.snapshot,
        error: mapProviderError(cause)
      });
      return state;
    }
  };

  return {
    getState: async () => {
      await hydrate();
      return state;
    },

    refresh: async () => {
      if (!refreshInFlight) {
        refreshInFlight = performRefresh().finally(() => {
          refreshInFlight = null;
        });
      }
      return refreshInFlight;
    },

    openExternal: async (fingerprint) => {
      if (typeof fingerprint !== "string" || !fingerprint.trim()) {
        throw new BriefServiceError("invalid-input", "缺少条目指纹。");
      }
      const item = await store.findItem(fingerprint.trim());
      if (!item) {
        throw new BriefServiceError("not-found", "该条目不在本地缓存中。");
      }
      const url = validateHttpsUrl(item.url, item.sourceId);
      if (!url) {
        throw new BriefServiceError("invalid-input", "条目链接不是安全的 HTTPS 地址。");
      }
      return url;
    },

    loadSettings: async () => {
      return (await store.loadProfile()) ?? defaultProfile();
    },

    saveSettings: async (input) => {
      if (!isBriefProfile(input)) {
        throw new BriefServiceError("invalid-input", "早报设置格式无效。");
      }
      const sourceEnabled = Object.fromEntries(
        BRIEF_SOURCE_IDS.map((id) => [
          id,
          input.sourceEnabled[id] === true
        ])
      );
      const profile: BriefProfile = {
        interests: input.interests.map((interest) => ({
          name: interest.name.trim(),
          weight: Math.round(interest.weight),
          note: typeof interest.note === "string" && interest.note.trim()
            ? interest.note.trim()
            : null
        })),
        sourceEnabled,
        savedAt: null
      };
      return store.saveProfile(profile);
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
};
