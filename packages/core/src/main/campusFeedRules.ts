/**
 * Campus-feed validation and normalisation rules (Core, main).
 *
 * Split out of campusFeedService.ts. These
 * are the pure rules behind the service: descriptor validation, notification
 * keyword normalisation and matching, interval clamping, the global item sort
 * and the AI schedule-candidate guard.
 */
import type {
  CampusFeedNotificationSettings,
  CampusFeedScheduleCandidate,
  FeedItemRecord,
  FeedSourceDescriptor
} from "@campusos/shared";

const MAX_INTERVAL_MINUTES = 1440;
const MIN_INTERVAL_MINUTES = 1;

export const isDescriptor = (value: unknown): value is FeedSourceDescriptor => {
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
    typeof candidate.enabled === "boolean" &&
    (candidate.notificationEnabled === undefined || typeof candidate.notificationEnabled === "boolean")
  );
};

export const normalizeNotificationSettings = (value: unknown): CampusFeedNotificationSettings => {
  if (typeof value !== "object" || value === null || !Array.isArray((value as { keywords?: unknown }).keywords)) {
    return { keywords: [] };
  }
  const keywords: string[] = [];
  const seen = new Set<string>();
  for (const entry of (value as { keywords: unknown[] }).keywords) {
    if (typeof entry !== "string") continue;
    const keyword = entry.trim().slice(0, 40);
    const key = keyword.toLocaleLowerCase("en-US");
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
    if (keywords.length >= 30) break;
  }
  return { keywords };
};

export const matchesNotificationKeywords = (
  item: Pick<FeedItemRecord, "title" | "summary">,
  settings: CampusFeedNotificationSettings
): boolean => {
  if (settings.keywords.length === 0) return true;
  const searchable = `${item.title}\n${item.summary ?? ""}`.toLocaleLowerCase("en-US");
  return settings.keywords.some((keyword) => searchable.includes(keyword.toLocaleLowerCase("en-US")));
};

export const normalizeInterval = (value: number): number => {
  if (!Number.isFinite(value)) return 60;
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(value)));
};

/** Global sort for the snapshot stream: newest published first, null published last, then by fetch time. */
export const compareFeedItems = (a: FeedItemRecord, b: FeedItemRecord): number => {
  const aNull = a.publishedAt === null ? 1 : 0;
  const bNull = b.publishedAt === null ? 1 : 0;
  if (aNull !== bNull) return aNull - bNull;
  if (a.publishedAt !== null && b.publishedAt !== null) {
    const delta = Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    if (delta !== 0) return delta;
  }
  const fetchDelta = Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt);
  if (fetchDelta !== 0) return fetchDelta;
  return a.id.localeCompare(b.id);
};

export const isCampusFeedScheduleCandidate = (
  value: unknown,
  allowedItemIds: ReadonlySet<string>,
  sourceText: string
): value is CampusFeedScheduleCandidate => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.itemId !== "string" || !allowedItemIds.has(candidate.itemId)) {
    return false;
  }
  if (typeof candidate.title !== "string" || !candidate.title.trim() || candidate.title.trim().length > 60) {
    return false;
  }
  const timedIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof candidate.startAt !== "string" || !timedIso.test(candidate.startAt)) return false;
  const start = Date.parse(candidate.startAt);
  if (!Number.isFinite(start)) return false;
  const end = candidate.endAt === null || candidate.endAt === undefined
    ? null
    : Date.parse(candidate.endAt as string);
  if (candidate.endAt !== null && candidate.endAt !== undefined &&
    (typeof candidate.endAt !== "string" || !timedIso.test(candidate.endAt) || !Number.isFinite(end) || end! < start)) {
    return false;
  }
  const type = candidate.type;
  if (type !== "deadline" && type !== "fixed") return false;
  const location = candidate.location;
  const note = candidate.note;
  const evidence = candidate.evidence;
  const normalized = (text: string): string => text.replace(/\s+/g, "").trim();
  if (typeof evidence !== "string" || evidence.length > 300 || normalized(evidence).length < 6 ||
    !/\d{1,4}[-/.年月日:]\d{1,2}/.test(evidence) || !normalized(sourceText).includes(normalized(evidence))) return false;
  return (
    (location === null || location === undefined || (typeof location === "string" && location.length <= 120)) &&
    (note === null || note === undefined || (typeof note === "string" && note.length <= 300))
  );
};
