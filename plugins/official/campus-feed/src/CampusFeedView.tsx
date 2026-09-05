import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  Check,
  ChevronDown,
  ExternalLink,
  Plus,
  RefreshCw,
  Rss,
  Settings2,
  Trash2,
  X
} from "lucide-react";
import { toast } from "sonner";
import type { CampusFeedScheduleCandidate, CampusFeedSnapshot, FeedItemRecord, FeedSourceDescriptor, PluginComponentProps } from "@campusos/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/sonner";
import { CampusFeedAiSettings } from "./CampusFeedAiSettings";

type FeedTab = "feed" | "sources" | "settings";

const categoryLabel: Record<FeedSourceDescriptor["category"], string> = {
  college: "学院",
  general: "全校"
};

const formatTime = (value: string | null): string => {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff >= 0 && diff < 60 * 60 * 1000) return "刚刚";
  if (diff >= 0 && diff < 24 * 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / (60 * 60 * 1000)))} 小时前`;
  const parts = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}年${month}月${day}日`;
};

const formatLastRefresh = (value: string): string =>
  new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }).format(new Date(value));

const formatCandidateTime = (value: string | null): string => {
  if (!value) return "时间待定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待定";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai"
  }).format(date);
};

export const CampusFeedView = (props: PluginComponentProps): JSX.Element => {
  const feed = props.campusFeed;
  const [tab, setTab] = useState<FeedTab>("feed");
  const [snapshot, setSnapshot] = useState<CampusFeedSnapshot | null>(null);
  const [reading, setReading] = useState(Boolean(feed));
  const [readError, setReadError] = useState<string | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleCandidates, setScheduleCandidates] = useState<CampusFeedScheduleCandidate[]>([]);
  const [importing, setImporting] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<FeedSourceDescriptor["category"] | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [viewMode, setViewMode] = useState<"grouped" | "all">("grouped");
  const [collapsedSources, setCollapsedSources] = useState<Set<string>>(new Set());
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [navigationIds, setNavigationIds] = useState<Set<string> | null>(null);
  const [navigationIsBatch, setNavigationIsBatch] = useState(false);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [notificationStatus, setNotificationStatus] = useState<string | null>(null);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const focusedIndexRef = useRef(0);
  const busyRef = useRef(false);
  const handledNavigationRef = useRef<string | null>(null);

  const refreshAll = useCallback(async (): Promise<void> => {
    if (!feed || busyRef.current) return;
    busyRef.current = true;
    setRefreshing((current) => new Set(current).add("*"));
    try {
      await feed.refreshAll();
      setSnapshot(await feed.getSnapshot());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "刷新失败。");
    } finally {
      busyRef.current = false;
      setRefreshing(new Set());
    }
  }, [feed]);

  const refreshSource = useCallback(async (sourceId: string): Promise<void> => {
    if (!feed) return;
    setRefreshing((current) => new Set(current).add(sourceId));
    try {
      await feed.refreshSource(sourceId);
      setSnapshot(await feed.getSnapshot());
    } catch (cause) {
      toast.error("刷新失败", { description: cause instanceof Error ? cause.message : "该信息源暂时不可用。" });
    } finally {
      setRefreshing((current) => {
        const next = new Set(current);
        next.delete(sourceId);
        return next;
      });
    }
  }, [feed]);

  useEffect(() => {
    if (!feed) return;
    let active = true;
    setReading(true);
    setReadError(null);
    void feed.getSnapshot().then((next) => {
      if (active) setSnapshot(next);
    }).catch((cause) => {
      if (active) setReadError(cause instanceof Error ? cause.message : "无法读取校园资讯。");
    }).finally(() => { if (active) setReading(false); });
    const unsubscribe = feed.subscribe((next) => {
      if (active) { setSnapshot(next); setReadError(null); }
    });
    return () => { active = false; unsubscribe(); };
  }, [feed, readAttempt]);

  const openOriginal = useCallback((item: FeedItemRecord): void => {
    if (!feed) return;
    void feed.markRead([item.id])
      .then(() => feed.openExternal(item.url))
      .catch((cause) =>
        toast.error("无法打开原文", { description: cause instanceof Error ? cause.message : "链接未通过本地安全检查。" })
      );
  }, [feed]);

  const markAllRead = useCallback(async (): Promise<void> => {
    if (!feed || !snapshot) return;
    const unread = snapshot.items.filter((item) => item.state === "new").map((item) => item.id);
    if (unread.length === 0) return;
    try { await feed.markRead(unread); } catch (cause) {
      toast.error("操作失败", { description: cause instanceof Error ? cause.message : "无法更新已读状态。" });
    }
  }, [feed, snapshot]);

  const markSourceRead = async (source: FeedSourceDescriptor): Promise<void> => {
    if (!feed || !snapshot) return;
    const unread = snapshot.items
      .filter((item) => item.sourceId === source.id && item.state === "new")
      .map((item) => item.id);
    if (unread.length === 0) return;
    try { await feed.markRead(unread); } catch (cause) {
      toast.error("操作失败", { description: cause instanceof Error ? cause.message : "无法更新已读状态。" });
    }
  };

  const toggleSourceCollapse = (sourceId: string): void => {
    setCollapsedSources((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) next.delete(sourceId); else next.add(sourceId);
      return next;
    });
  };

  const sourceNameOf = (sourceId: string): string =>
    sources.find((source) => source.id === sourceId)?.name ?? sourceId;

  const toggleSource = async (source: FeedSourceDescriptor): Promise<void> => {
    if (!feed) return;
    try { await feed.updateSource(source.id, { enabled: !source.enabled }); } catch (cause) {
      toast.error("操作失败", { description: cause instanceof Error ? cause.message : "无法更新订阅状态。" });
    }
  };

  const toggleSourceNotifications = async (source: FeedSourceDescriptor): Promise<void> => {
    if (!feed) return;
    try {
      await feed.updateSource(source.id, { notificationEnabled: source.notificationEnabled === false });
    } catch (cause) {
      toast.error("操作失败", { description: cause instanceof Error ? cause.message : "无法更新通知状态。" });
    }
  };

  const saveKeywords = async (keywords: string[]): Promise<void> => {
    if (!feed || savingNotifications) return;
    setSavingNotifications(true);
    setNotificationStatus("保存中…");
    try {
      const saved = await feed.saveNotificationSettings({ keywords });
      setSnapshot((current) => current ? { ...current, notificationSettings: saved } : current);
      setNotificationStatus("已保存");
    } catch (cause) {
      setNotificationStatus("保存失败");
      toast.error("保存失败", { description: cause instanceof Error ? cause.message : "无法保存通知关键词。" });
    } finally {
      setSavingNotifications(false);
    }
  };

  const addKeyword = (): void => {
    const keyword = keywordDraft.trim();
    if (!keyword) return;
    const keywords = snapshot?.notificationSettings?.keywords ?? [];
    if (keywords.some((entry) => entry.toLocaleLowerCase("en-US") === keyword.toLocaleLowerCase("en-US"))) {
      setKeywordDraft("");
      setNotificationStatus("关键词已存在");
      return;
    }
    setKeywordDraft("");
    void saveKeywords([...keywords, keyword]);
  };

  const removeSource = async (source: FeedSourceDescriptor): Promise<void> => {
    if (!feed) return;
    try { await feed.removeSource(source.id); } catch (cause) {
      toast.error("操作失败", { description: cause instanceof Error ? cause.message : "无法取消订阅。" });
    }
  };

  const extractItem = async (item: FeedItemRecord): Promise<void> => {
    if (!feed || extractingId) return;
    setExtractingId(item.id);
    try {
      const candidates = await feed.extractScheduleCandidates([item.id]);
      setScheduleCandidates(candidates);
      setScheduleOpen(true);
    } catch (cause) {
      toast.error("AI 处理失败", { description: cause instanceof Error ? cause.message : "请先在「设置」中配置校园资讯的 AI 连接。" });
    } finally {
      setExtractingId(null);
    }
  };

  const importCandidates = async (): Promise<void> => {
    if (!feed || importing) return;
    setImporting(true);
    try {
      const result = await feed.createScheduleTasks(scheduleCandidates);
      const parts = [`已加入日程 ${result.created} 条`];
      if (result.deduplicated > 0) parts.push(`${result.deduplicated} 条已存在`);
      toast.success(parts.join("，"), { description: "可以在「日程」中查看和编辑。" });
      setScheduleOpen(false);
    } catch (cause) {
      toast.error("加入日程失败", { description: cause instanceof Error ? cause.message : "无法保存日程条目。" });
    } finally {
      setImporting(false);
    }
  };

  const sources = snapshot?.sources ?? [];
  const enabledSources = sources.filter((source) => source.enabled);
  const items = snapshot?.items ?? [];
  const notificationKeywords = snapshot?.notificationSettings?.keywords ?? [];
  const unreadCount = items.filter((item) => item.state === "new").length;
  const loading = refreshing.has("*");

  const unreadOfSource = (sourceId: string): number =>
    items.filter((item) => item.sourceId === sourceId && item.state === "new").length;
  const unreadSources = enabledSources.filter((source) => unreadOfSource(source.id) > 0);
  const orderedSources = unreadSources.concat(enabledSources.filter((source) => unreadOfSource(source.id) === 0));
  const allTags = [...new Set(enabledSources.flatMap((source) => source.tags))];

  const matchesSource = (source: FeedSourceDescriptor): boolean =>
    (selectedSourceId === null || source.id === selectedSourceId) &&
    (selectedCategory === null || source.category === selectedCategory) &&
    (selectedTag === null || source.tags.includes(selectedTag));
  const visibleSources = enabledSources.filter(matchesSource);
  const visibleSourceIds = new Set(visibleSources.map((source) => source.id));
  const sourceFilteredItems = onlyUnread
    ? items.filter((item) => item.state === "new" && visibleSourceIds.has(item.sourceId))
    : items.filter((item) => visibleSourceIds.has(item.sourceId));
  const visibleItems = navigationIds
    ? items.filter((item) => navigationIds.has(item.id))
    : sourceFilteredItems;
  const hasDisplayFilter = selectedSourceId !== null || selectedCategory !== null || selectedTag !== null || onlyUnread;
  const hasFilter = hasDisplayFilter || navigationIds !== null;
  const hasFilters = enabledSources.length > 1 || allTags.length > 0;
  // Display order (and keyboard navigation order): globally-sorted in "all" mode, source-by-source in "grouped".
  const orderedItems = viewMode === "all"
    ? visibleItems
    : visibleSources.flatMap((source) => visibleItems.filter((item) => item.sourceId === source.id));

  useEffect(() => {
    const target = props.navigationTarget;
    if (
      !feed || !snapshot || target?.viewId !== "campus-feed" || (!target.entityId && !target.entityIds?.length) ||
      handledNavigationRef.current === target.requestId
    ) return;
    const targetIds = target.entityId ? [target.entityId] : target.entityIds ?? [];
    const matchedIds = targetIds.filter((id) => snapshot.items.some((candidate) => candidate.id === id));
    if (matchedIds.length === 0) return;
    const item = snapshot.items.find((candidate) => candidate.id === matchedIds[0])!;
    handledNavigationRef.current = target.requestId;
    setTab("feed");
    setSelectedSourceId(null);
    setSelectedCategory(null);
    setSelectedTag(null);
    setOnlyUnread(false);
    setViewMode("all");
    setNavigationIds(new Set(matchedIds));
    setNavigationIsBatch(!target.entityId);
    setHighlightedItemId(item.id);
    if (target.entityId) void feed.markRead([item.id]);
    const frame = requestAnimationFrame(() => {
      document.querySelector(`[data-feed-item-id="${item.id}"]`)?.scrollIntoView({ block: "center" });
    });
    const timer = window.setTimeout(() => setHighlightedItemId(null), 2400);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [feed, props.navigationTarget, snapshot]);
  const resetFilters = (): void => {
    setSelectedSourceId(null); setSelectedCategory(null); setSelectedTag(null); setOnlyUnread(false); setNavigationIds(null); setNavigationIsBatch(false);
  };

  const scrollToFocused = (): void => {
    const el = document.querySelector(`[data-feed-index="${focusedIndexRef.current}"]`);
    el?.scrollIntoView({ block: "center" });
  };

  useEffect(() => {
    if (tab !== "feed" || !feed) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea, select, button, a, [role='combobox'], [role='switch'], [role='tab']")) return;
      if (orderedItems.length === 0) return;
      if (event.key === "j") {
        event.preventDefault();
        focusedIndexRef.current = Math.min(focusedIndexRef.current + 1, orderedItems.length - 1);
        scrollToFocused();
      } else if (event.key === "k") {
        event.preventDefault();
        focusedIndexRef.current = Math.max(focusedIndexRef.current - 1, 0);
        scrollToFocused();
      } else if (event.key === "m") {
        const item = orderedItems[focusedIndexRef.current];
        if (item && item.state === "new") void feed.markRead([item.id]);
      } else if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        void markAllRead();
      } else if (event.key === "Enter") {
        const item = orderedItems[focusedIndexRef.current];
        if (item) openOriginal(item);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, feed, orderedItems, markAllRead, openOriginal]);

  return (
    <section className="mx-auto w-full max-w-5xl px-1 pb-10 sm:px-2">
      <Toaster position="top-right" />
      <header className="mb-8 border-b border-border/70 pb-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold leading-10 text-foreground sm:text-4xl sm:leading-12">校园资讯</h1>
          </div>
          <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
            <div className="flex gap-1 rounded-lg border border-border bg-muted/60 p-1" role="tablist" aria-label="校园资讯视图">
              <Button size="sm" variant={tab === "feed" ? "default" : "ghost"} role="tab" aria-selected={tab === "feed"} onClick={() => setTab("feed")}>资讯</Button>
              <Button size="sm" variant={tab === "sources" ? "default" : "ghost"} role="tab" aria-selected={tab === "sources"} onClick={() => setTab("sources")}>订阅</Button>
              <Button size="sm" variant={tab === "settings" ? "default" : "ghost"} role="tab" aria-selected={tab === "settings"} onClick={() => setTab("settings")}><Settings2 className="size-3.5" aria-hidden="true" />设置</Button>
            </div>
          </div>
        </div>
      </header>

      {!feed ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>桥接不可用</AlertTitle>
          <AlertDescription>校园资讯桥接不可用，请重启 CampusOS。</AlertDescription>
        </Alert>
      ) : !snapshot && reading ? (
        <div className="space-y-5" role="status" aria-live="polite">
          <p className="text-sm text-muted-foreground">正在读取校园资讯…</p>
          {[0, 1, 2].map((index) => <div key={index} className="space-y-2" aria-hidden="true"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-1/3" /></div>)}
        </div>
      ) : !snapshot && readError ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>资讯读取失败</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{readError}</span>
            <Button size="sm" variant="outline" onClick={() => setReadAttempt((attempt) => attempt + 1)}>重试读取</Button>
          </AlertDescription>
        </Alert>
      ) : tab === "settings" ? (
        <div className="settings-panel">
          <section className="settings-section" aria-labelledby="feed-notification-heading">
            <header className="settings-section-heading">
              <div>
                <h2 id="feed-notification-heading">资讯通知</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">关键词匹配标题和摘要；留空时提醒所有新资讯。</p>
              </div>
              <span className="text-xs text-muted-foreground" role="status" aria-live="polite">{notificationStatus}</span>
            </header>
            <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); addKeyword(); }}>
              <label htmlFor="feed-notification-keyword" className="sr-only">通知关键词</label>
              <input
                id="feed-notification-keyword"
                value={keywordDraft}
                onChange={(event) => setKeywordDraft(event.target.value)}
                maxLength={40}
                placeholder="例如：奖学金、交换、讲座"
                className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" variant="outline" disabled={savingNotifications || !keywordDraft.trim()}><Plus className="size-4" aria-hidden="true" />添加关键词</Button>
            </form>
            {notificationKeywords.length > 0 ? (
              <div className="flex flex-wrap gap-2" aria-label="已设置的通知关键词">
                {notificationKeywords.map((keyword) => (
                  <Badge key={keyword.toLocaleLowerCase("en-US")} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1">
                    {keyword}
                    <button type="button" className="rounded-sm p-1 hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void saveKeywords(notificationKeywords.filter((entry) => entry !== keyword))} disabled={savingNotifications} aria-label={`移除关键词 ${keyword}`}>
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : <p className="text-xs leading-5 text-muted-foreground">当前未筛选关键词，所有开启通知的来源都会提醒。</p>}
          </section>
          <section className="settings-section" aria-labelledby="feed-interval-heading">
            <header className="settings-section-heading"><h2 id="feed-interval-heading">刷新频率</h2></header>
            {sources.length === 0 ? <p className="text-sm text-muted-foreground">还没有订阅任何信息源。</p> : (
              <div className="divide-y divide-border/60">
                {sources.map((source) => (
                  <div key={source.id} className="flex items-center justify-between gap-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium leading-6">{source.name}</p>
                      <p className="text-xs leading-5 text-muted-foreground">间隔 {source.intervalMinutes} 分钟</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {[30, 60, 180, 720].map((minutes) => (
                        <Button
                          key={minutes}
                          size="sm"
                          variant={source.intervalMinutes === minutes ? "default" : "outline"}
                          onClick={() => void feed.updateSource(source.id, { intervalMinutes: minutes }).catch((cause) => toast.error("操作失败", { description: cause instanceof Error ? cause.message : "无法更新间隔。" }))}
                        >
                          {minutes < 60 ? `${minutes}分` : `${minutes / 60}时`}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="settings-section" aria-labelledby="feed-ai-heading">
            <header className="settings-section-heading"><h2 id="feed-ai-heading">AI 处理</h2></header>
            <CampusFeedAiSettings feed={feed} />
          </section>
        </div>
      ) : tab === "sources" ? (
        <div className="settings-panel">
          <section className="settings-section" aria-labelledby="feed-sources-heading">
            <header className="settings-section-heading">
              <h2 id="feed-sources-heading">我的订阅</h2>
              <span className="text-xs text-muted-foreground">{enabledSources.length} 个已启用 · 共 {sources.length} 个</span>
            </header>
            {sources.length === 0 ? (
              <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Rss className="size-5" aria-hidden="true" /></div>
                <div>
                  <h2 className="font-semibold leading-7">还没有订阅信息源</h2>
                  <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">首次使用会按你的学院身份推荐订阅源，之后可以随时自由增删。</p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {sources.map((source) => (
                  <div key={source.id} className="flex flex-col items-stretch gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium leading-6">{source.name}</p>
                        <Badge variant="secondary">{categoryLabel[source.category]}</Badge>
                        {source.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                      </div>
                      <p className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">{source.listUrl}</p>
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        抓取
                        <Switch checked={source.enabled} onCheckedChange={() => void toggleSource(source)} aria-label={`抓取 ${source.name}`} />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        通知
                        <Switch checked={source.notificationEnabled !== false} onCheckedChange={() => void toggleSourceNotifications(source)} aria-label={`接收 ${source.name} 的通知`} />
                      </label>
                      <Button size="icon" variant="ghost" onClick={() => void removeSource(source)} aria-label={`取消订阅 ${source.name}`}><Trash2 className="size-4" aria-hidden="true" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="flex items-center gap-2 text-xs leading-5 text-muted-foreground"><Plus className="size-3.5" aria-hidden="true" />更多信息源（含各学院院网）将在后续版本分批加入。</p>
          </section>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 pb-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold leading-8">最新通知</h2>
                {unreadCount > 0 ? <Badge variant="secondary">{unreadCount} 条未读</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {sources.length === 0 ? "尚未配置订阅源" : Object.keys(snapshot?.lastRefresh ?? {}).length > 0 ? `上次更新 ${formatLastRefresh(Object.values(snapshot!.lastRefresh).sort().at(-1)!)}` : "尚未抓取，点击刷新开始"}
              </p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
              <div className="flex gap-1 rounded-lg border border-border bg-muted/60 p-1" role="group" aria-label="视图方式">
                <Button size="sm" variant={viewMode === "grouped" ? "default" : "ghost"} onClick={() => setViewMode("grouped")}>按源</Button>
                <Button size="sm" variant={viewMode === "all" ? "default" : "ghost"} onClick={() => setViewMode("all")}>时间流</Button>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={onlyUnread} onCheckedChange={setOnlyUnread} aria-label="只看未读" />
                只看未读
              </label>
              {unreadCount > 0 ? <Button variant="outline" onClick={() => void markAllRead()} className="w-full sm:w-auto"><Check className="size-4" aria-hidden="true" />全部已读</Button> : null}
              <Button onClick={() => void refreshAll()} disabled={loading} className="w-full sm:w-auto"><RefreshCw className={loading ? "animate-spin" : undefined} aria-hidden="true" />{loading ? "刷新中" : "刷新全部"}</Button>
            </div>
          </div>

          {hasFilters ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="group" aria-label="资讯筛选">
              <div className="col-span-2 min-w-0 space-y-1.5 sm:col-span-1">
                <label htmlFor="feed-source-filter" className="text-sm text-muted-foreground">来源</label>
                <select id="feed-source-filter" className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={selectedSourceId ?? ""} onChange={(event) => setSelectedSourceId(event.target.value || null)}>
                  <option value="">全部来源</option>
                  {orderedSources.map((source) => <option key={source.id} value={source.id}>{source.name}{unreadOfSource(source.id) > 0 ? ` · ${unreadOfSource(source.id)} 条未读` : ""}</option>)}
                </select>
              </div>
              <div className="min-w-0 space-y-1.5">
                <label htmlFor="feed-category-filter" className="text-sm text-muted-foreground">分类</label>
                <select id="feed-category-filter" className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={selectedCategory ?? ""} onChange={(event) => { setSelectedCategory(event.target.value as FeedSourceDescriptor["category"] || null); setSelectedTag(null); }}>
                  <option value="">全部分类</option><option value="general">全校</option><option value="college">学院</option>
                </select>
              </div>
              <div className="min-w-0 space-y-1.5">
                <label htmlFor="feed-tag-filter" className="text-sm text-muted-foreground">标签</label>
                <select id="feed-tag-filter" className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={selectedTag ?? ""} onChange={(event) => { setSelectedTag(event.target.value || null); setSelectedCategory(null); }}>
                  <option value="">全部标签</option>{allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                </select>
              </div>
              {hasDisplayFilter ? <Button size="sm" variant="ghost" className="col-span-2 justify-self-start sm:col-span-3" onClick={resetFilters}>清除筛选</Button> : null}
            </div>
          ) : null}

          {navigationIds ? (
            <Alert>
              <AlertTitle>{navigationIsBatch ? "本次提醒的资讯" : "已定位通知资讯"}</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{navigationIsBatch ? `正在查看本次批量提醒中的 ${visibleItems.length} 条资讯。` : "正在查看从通知中心打开的资讯。"}</span>
                <Button size="sm" variant="outline" onClick={() => { setNavigationIds(null); setNavigationIsBatch(false); }}>查看全部资讯</Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {error ? <Alert variant="destructive"><AlertCircle className="size-4" aria-hidden="true" /><AlertTitle>部分信息源没有更新</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3"><span>{error}</span><Button size="sm" variant="outline" onClick={() => { setError(null); void refreshAll(); }}>重试</Button></AlertDescription></Alert> : null}

          {sources.length === 0 ? (
            <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Rss className="size-5" aria-hidden="true" /></div>
              <div>
                <h2 className="font-semibold leading-7">还没有订阅信息源</h2>
                <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">前往「订阅」页管理信息源，或直接点击刷新开始抓取默认订阅。</p>
              </div>
              <Button onClick={() => void refreshAll()} disabled={loading}><RefreshCw aria-hidden="true" />抓取默认订阅</Button>
            </div>
          ) : loading && visibleItems.length === 0 ? (
            <div className="space-y-4" role="status" aria-live="polite">
              {[0, 1, 2].map((index) => <div key={index} className="space-y-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-1/3" /></div>)}
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center text-sm text-muted-foreground">
              <p>{hasFilter ? "没有符合当前筛选项的内容。" : "该订阅源暂无新内容。"}</p>
              {hasFilter ? <Button size="sm" variant="outline" onClick={resetFilters}>清除筛选</Button> : null}
            </div>
          ) : (
            <div>
              {viewMode === "all" ? (
                <div className="divide-y divide-border/60">
                  {orderedItems.map((item, index) => (
                    <article key={item.id} data-feed-index={index} data-feed-item-id={item.id} className={`py-4 ${item.state === "new" ? "bg-primary/[0.03]" : ""} ${highlightedItemId === item.id ? "ring-2 ring-primary/40 ring-offset-4" : ""}`}>
                      <div className="flex flex-col items-start gap-3 lg:flex-row lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs leading-5 text-muted-foreground">
                            <span className="font-medium text-foreground/70">{sourceNameOf(item.sourceId)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatTime(item.publishedAt)}</span>
                            {item.state === "new" ? <Badge variant="default" className="px-1.5 py-0 text-[10px]">新</Badge> : null}
                          </div>
                          <h3 className="mt-1 text-base font-semibold leading-7 text-foreground">{item.title}</h3>
                          {item.summary ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{item.summary}</p> : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => void extractItem(item)} disabled={extractingId !== null} title="AI 提取时间信息后加入日程"><CalendarClock className={extractingId === item.id ? "animate-pulse" : undefined} aria-hidden="true" />转为日程</Button>
                          <Button size="sm" variant="outline" onClick={() => openOriginal(item)}><ExternalLink className="size-3.5" aria-hidden="true" />阅读原文</Button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                visibleSources.map((source) => {
                  const sourceItems = orderedItems.filter((item) => item.sourceId === source.id);
                  if (sourceItems.length === 0) return null;
                  const sourceUnread = unreadOfSource(source.id);
                  const collapsed = collapsedSources.has(source.id);
                  return (
                    <section key={source.id} aria-labelledby={`feed-source-${source.id}-heading`} className="border-t border-border/60 pt-5 pb-2">
                      <div className="flex items-center justify-between gap-3">
                        <button type="button" onClick={() => toggleSourceCollapse(source.id)} className="flex min-w-0 items-center gap-2 text-left" aria-expanded={!collapsed}>
                          <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`} aria-hidden="true" />
                          <span className="min-w-0">
                            <span id={`feed-source-${source.id}-heading`} className="block text-lg font-semibold leading-7">{source.name}</span>
                            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{sourceItems.length} 条通知{sourceUnread > 0 ? ` · ${sourceUnread} 条未读` : ""}</span>
                          </span>
                        </button>
                        <div className="flex shrink-0 items-center gap-2">
                          {sourceUnread > 0 ? <Button size="sm" variant="outline" onClick={() => void markSourceRead(source)}><Check className="size-3.5" aria-hidden="true" />全部已读</Button> : null}
                          <Button size="sm" variant="ghost" onClick={() => void refreshSource(source.id)} disabled={refreshing.has(source.id)} aria-label={`刷新 ${source.name}`}><RefreshCw className={refreshing.has(source.id) ? "animate-spin" : undefined} aria-hidden="true" /></Button>
                        </div>
                      </div>
                      {!collapsed ? (
                        <div className="divide-y divide-border/60">
                          {sourceItems.map((item) => (
                            <article key={item.id} data-feed-index={orderedItems.indexOf(item)} data-feed-item-id={item.id} className={`py-4 ${item.state === "new" ? "bg-primary/[0.03]" : ""} ${highlightedItemId === item.id ? "ring-2 ring-primary/40 ring-offset-4" : ""}`}>
                              <div className="flex flex-col items-start gap-3 lg:flex-row lg:justify-between">
                                <div className="min-w-0">
                                  <h3 className="text-base font-semibold leading-7 text-foreground">{item.title}</h3>
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs leading-5 text-muted-foreground">
                                    <span>{formatTime(item.publishedAt)}</span>
                                    {item.state === "new" ? <Badge variant="default" className="px-1.5 py-0 text-[10px]">新</Badge> : null}
                                  </div>
                                  {item.summary ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{item.summary}</p> : null}
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <Button size="sm" variant="outline" onClick={() => void extractItem(item)} disabled={extractingId !== null} title="AI 提取时间信息后加入日程"><CalendarClock className={extractingId === item.id ? "animate-pulse" : undefined} aria-hidden="true" />转为日程</Button>
                                  <Button size="sm" variant="outline" onClick={() => openOriginal(item)}><ExternalLink className="size-3.5" aria-hidden="true" />阅读原文</Button>
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CalendarClock className="size-4" aria-hidden="true" />AI 提取的日程</DialogTitle>
            <DialogDescription>以下事件由 AI 从通知中提取，确认后加入「日程」。</DialogDescription>
          </DialogHeader>
          {scheduleCandidates.length === 0 ? (
            <p className="py-6 text-center text-sm leading-6 text-muted-foreground">这条通知里没有识别到明确时间的事件，没有可加入的日程。</p>
          ) : (
            <div className="divide-y divide-border/60">
              {scheduleCandidates.map((candidate, index) => (
                <div key={`${candidate.itemId}-${index}`} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium leading-6">{candidate.title}</p>
                    <Badge variant="secondary">{candidate.type === "deadline" ? "截止" : "活动"}</Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {formatCandidateTime(candidate.startAt)}{candidate.endAt ? ` → ${formatCandidateTime(candidate.endAt)}` : ""}
                    {candidate.location ? ` · ${candidate.location}` : ""}
                  </p>
                  {candidate.note ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{candidate.note}</p> : null}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>取消</Button>
            <Button onClick={() => void importCandidates()} disabled={importing || scheduleCandidates.length === 0}><CalendarClock className="size-4" aria-hidden="true" />{importing ? "正在加入" : "加入日程"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};
