import { CAMPUS_FEED_IDENTITIES, CAMPUS_FEED_INTERESTS } from "@campusos/shared";
import type { CampusFeedPreferences, CampusFeedPreferencesInput, FeedSourceDescriptor, FeedSourceHealth } from "@campusos/shared";

export interface FeedSubscriptionPreference {
  enabled: boolean;
  notificationEnabled?: boolean;
  removed?: boolean;
  name?: string;
  intervalMinutes?: number;
}
export interface StoredFeedPreferences extends CampusFeedPreferences {
  history?: Record<string, { since: string; pages: number; nextUrl?: string; nextPage?: number; visited: string[]; complete: boolean; message: string }>;
  version: 1;
  subscriptions: Record<string, FeedSubscriptionPreference>;
  health: Record<string, FeedSourceHealth>;
  ruleVersions: Record<string, number>;
}
const OBSOLETE_BUILTIN_NAMES: Record<string, Set<string>> = {
  "xgb-pingjiang": new Set(["学工门户 · 评奖评优"]),
  "ugrs-dwjl": new Set(["本科生对外交流 · 国际项目","本科生对外交流 · 通知"]),
  "zjutw-tzgg": new Set(["校团委 · 通知公告"]),
  "ckc-zxtz": new Set(["竺可桢学院 · 最新通知"]),
  "zju-yaowen": new Set(["求是新闻网 · 要闻"]),
  "zju-zonghe": new Set(["求是新闻网 · 综合"]),
  "bksy-tzgg": new Set(["本科生院 · 通知公告"]),
  "grs-yjszs": new Set(["研究生招生 · 通知"]),
  "zdzsc-zxgg": new Set(["本科招生 · 最新公告"]),
  "xlzx-zdts": new Set(["心理健康中心 · 重点提示"]),
  "libweb-xw": new Set(["图书馆 · 本馆新闻"]),
  "libweb-zy": new Set(["图书馆 · 资源动态"]),
  "zulg-tzgg": new Set(["后勤集团 · 日常通知","后勤集团 · 通知公告"]),
  "zdyy-tzgg": new Set(["校医院 · 通知公告"]),
  "itc-tzgg": new Set(["信息技术中心 · 通知"]),
  "intl-rss": new Set(["国际校区 · 新闻"]),
  "libintl-rss": new Set(["国际校区图书馆 · 动态"]),
  "tyys-tzgg": new Set(["艺体 · 通知公告"]),
  "dqxy-tzgg": new Set(["丹青学园 · 最新通知"]),
  "lantian-tzgg": new Set(["蓝田学园 · 教学通知"]),
  "mse-tzgg": new Set(["材料学院 · 党建通知","材料学院 · 通知公告"]),
  "ls-tzgg": new Set(["历史学院 · 通知公告"]),
  "physics-tzgg": new Set(["物理学院 · 科研通知","物理学院 · 通知"]),
  "cs-csen": new Set(["计算机学院 · 通知"]),
  "cst-soft": new Set(["软件学院 · 通知"]),
  "isee-tzgg": new Set(["信电学院 · 通知"]),
  "math-tzgg": new Set(["数学学院 · 通知"]),
  "sis-tzgg": new Set(["外语学院 · 通知"]),
  "ee-tzgg": new Set(["电气学院 · 通知"]),
  "me-tzgg": new Set(["机械学院 · 通知"]),
  "som-tzgg": new Set(["管理学院 · 信息公告"]),
  "cec-tzgg": new Set(["经济学院 · 通知"]),
  "cmm-tzgg": new Set(["医学院 · 通知"]),
  "ccea-tzgg": new Set(["建工学院 · 通知"]),
  "ghls-tzgg": new Set(["光华法学院 · 通知"]),
  "cmic-tzgg": new Set(["传媒学院 · 通知"]),
  "cse-tzgg": new Set(["控制学院 · 通知"]),
  "doe-tzgg": new Set(["能源学院 · 重要通知"]),
  "cps-tzgg": new Set(["药学院 · 通知"]),
  "oc-tzgg": new Set(["海洋学院 · 通知"]),
  "lsi-tzgg": new Set(["生命科学学院 · 通知"]),
  "cab-tzgg": new Set(["农学院 · 通知"]),
  "saa-tzgg": new Set(["航空航天学院 · 通知"]),
  "lit-tzgg": new Set(["文学院 · 通知"]),
  "ced-tzgg": new Set(["教育学院 · 通知"]),
  "marx-tzgg": new Set(["马克思主义学院 · 通知"]),
  "polymer-tzgg": new Set(["高分子系 · 通知"]),
  "cers-tzgg": new Set(["环资学院 · 通知"]),
  "soaa-tzgg": new Set(["艺术考古学院 · 通知"]),
  "chem-tzgg": new Set(["化学系 · 通知"]),
  "qsxy-tzgg": new Set(["求是学院 · 通知"]),
  "yunfeng-tzgg": new Set(["云峰学园 · 通知"]),
  "psych-tzgg": new Set(["心理系 · 通知"])
};
const preservedName = (source: FeedSourceDescriptor, name?: string): string | undefined =>
  name && !OBSOLETE_BUILTIN_NAMES[source.id]?.has(name) && name !== source.name ? name : undefined;

export const createFeedPreferences = (
  catalog: readonly FeedSourceDescriptor[],
  legacy: FeedSourceDescriptor[],
  legacyDefaultEnabledIds: ReadonlySet<string> = new Set()
): StoredFeedPreferences => ({
  version: 1,
  profile: { identity: null, college: null, interests: [] },
  onboarding: legacy.length ? "existing" : "pending",
  subscriptions: Object.fromEntries(catalog.map((source) => {
    const saved = legacy.find((entry) => entry.id === source.id);
    return [source.id, saved ? {
      enabled: saved.enabled,
      notificationEnabled: saved.notificationEnabled,
      removed: !saved.enabled && !legacyDefaultEnabledIds.has(source.id),
      name: preservedName(source, saved.name),
      intervalMinutes: saved.intervalMinutes
    } : { enabled: false, removed: legacy.length > 0 }];
  })),
  health: {},
  ruleVersions: Object.fromEntries(catalog.map((source) => [source.id, source.ruleVersion ?? 1]))
});

export const visibleFeedSources = (catalog: readonly FeedSourceDescriptor[], state: StoredFeedPreferences): FeedSourceDescriptor[] => catalog
  .filter((source) => !state.subscriptions[source.id]?.removed)
  .map((source) => {
    const user = state.subscriptions[source.id];
    const name = preservedName(source, user?.name);
    return { ...source, enabled: user?.enabled ?? false, notificationEnabled: user?.notificationEnabled !== false, ...(name ? { name } : {}), ...(user?.intervalMinutes ? { intervalMinutes: user.intervalMinutes } : {}) };
  });

export const validateFeedPreferences = (value: unknown, catalog: readonly FeedSourceDescriptor[]): CampusFeedPreferencesInput => {
  if (!value || typeof value !== "object") throw new Error("订阅偏好格式无效。");
  const input = value as CampusFeedPreferencesInput;
  const profile = input.profile;
  if (!profile || (profile.identity !== null && !CAMPUS_FEED_IDENTITIES.some((entry) => entry.value === profile.identity)) ||
    (profile.college !== null && (typeof profile.college !== "string" || profile.college.length > 80)) ||
    !Array.isArray(profile.interests) || !profile.interests.every((interest) => CAMPUS_FEED_INTERESTS.includes(interest)) ||
    !Array.isArray(input.selectedSourceIds) || input.selectedSourceIds.length > catalog.length ||
    !input.selectedSourceIds.every((id) => catalog.some((entry) => entry.id === id)) ||
    (input.disabledSourceIds !== undefined && (!Array.isArray(input.disabledSourceIds) || !input.disabledSourceIds.every((id) => input.selectedSourceIds.includes(id)))) ||
    (input.skip !== undefined && typeof input.skip !== "boolean")) throw new Error("身份、兴趣或订阅源选择无效。");
  return { profile: { identity: profile.identity, college: profile.college?.trim() || null, interests: [...new Set(profile.interests)] }, selectedSourceIds: [...new Set(input.selectedSourceIds)], ...(input.disabledSourceIds ? { disabledSourceIds: [...new Set(input.disabledSourceIds)] } : {}), skip: input.skip === true };
};

export const readFeedPreferences = (value: unknown, catalog: readonly FeedSourceDescriptor[]): StoredFeedPreferences | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as StoredFeedPreferences;
  if (candidate.version !== 1 || !["pending", "completed", "skipped", "existing"].includes(candidate.onboarding) || !candidate.subscriptions || typeof candidate.subscriptions !== "object" || Array.isArray(candidate.subscriptions)) return null;
  // Removed identity choices must not invalidate existing subscriptions/history.
  const oldIdentity: unknown = candidate.profile?.identity;
  const profile = oldIdentity === "staff" || oldIdentity === "other"
    ? { ...candidate.profile, identity: null } : candidate.profile;
  try {
    validateFeedPreferences({ profile, selectedSourceIds: [] }, catalog);
    for (const entry of Object.values(candidate.subscriptions)) {
      if (!entry || typeof entry.enabled !== "boolean" || (entry.notificationEnabled !== undefined && typeof entry.notificationEnabled !== "boolean") || (entry.removed !== undefined && typeof entry.removed !== "boolean") ||
        (entry.name !== undefined && (typeof entry.name !== "string" || entry.name.length > 80)) ||
        (entry.intervalMinutes !== undefined && (!Number.isFinite(entry.intervalMinutes) || entry.intervalMinutes < 1 || entry.intervalMinutes > 1440))) return null;
    }
    const health = candidate.health ?? {};
    if (!health || typeof health !== "object" || Array.isArray(health)) return null;
    for (const entry of Object.values(health)) {
      if (!entry || !["ok", "empty", "network-error", "restricted", "layout-changed", "error"].includes(entry.status) ||
        typeof entry.attemptedAt !== "string" || !Number.isFinite(Date.parse(entry.attemptedAt)) ||
        (entry.succeededAt !== undefined && !Number.isFinite(Date.parse(entry.succeededAt))) ||
        (entry.itemCount !== undefined && (!Number.isInteger(entry.itemCount) || entry.itemCount < 0)) ||
        (entry.message !== undefined && typeof entry.message !== "string")) return null;
    }
    const ruleVersions = candidate.ruleVersions ?? {};
    if (candidate.history && (typeof candidate.history !== "object" || Array.isArray(candidate.history) || Object.values(candidate.history).some(entry =>
      !entry || !Number.isFinite(Date.parse(entry.since)) || !Number.isInteger(entry.pages) || entry.pages < 0 || entry.pages > 1000 ||
      typeof entry.complete !== "boolean" || typeof entry.message !== "string" || !Array.isArray(entry.visited) || entry.visited.length > 1000 ||
      !entry.visited.every(url => typeof url === "string" && url.length <= 2000) ||
      (entry.nextUrl !== undefined && (typeof entry.nextUrl !== "string" || entry.nextUrl.length > 2000)) ||
      (entry.nextPage !== undefined && (!Number.isInteger(entry.nextPage) || entry.nextPage < 1 || entry.nextPage > 1001))))) return null;
    if (!ruleVersions || typeof ruleVersions !== "object" || Array.isArray(ruleVersions) ||
      !Object.values(ruleVersions).every((version) => Number.isInteger(version) && version >= 1)) return null;
    const subscriptions = Object.fromEntries(catalog.map((source) => [
      source.id,
      candidate.subscriptions[source.id] ?? {
        enabled: false,
        removed: candidate.onboarding !== "pending"
      }
    ]));
    return { ...candidate, profile, subscriptions, health, ruleVersions };
  } catch { return null; }
};
