import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  Check,
  ExternalLink,
  Plus,
  RefreshCw,
  Rss,
  Settings2,
  Trash2
} from "lucide-react";
import { toast } from "sonner";
import type { CampusFeedScheduleCandidate, CampusFeedSnapshot, FeedItemRecord, FeedSourceDescriptor, PluginComponentProps } from "@campusos/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" }).format(date);
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
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleCandidates, setScheduleCandidates] = useState<CampusFeedScheduleCandidate[]>([]);
  const [importing, setImporting] = useState(false);
  const busyRef = useRef(false);

  const refreshAll = useCallback(async (): Promise<void> => {
    if (!feed || busyRef.current) return;
    busyRef.current = true;
    setRefreshing((current) => new Set(current).add("*"));
    try {
      await feed.refreshAll();
      setSnapshot(await feed.getSnapshot());
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
    void feed.getSnapshot().then((next) => {
      if (active) setSnapshot(next);
    }).catch(() => undefined);
    const unsubscribe = feed.subscribe(setSnapshot);
    return () => { active = false; unsubscribe(); };
  }, [feed]);

  const openOriginal = (item: FeedItemRecord): void => {
    if (!feed) return;
    void feed.openExternal(item.url).catch((cause) =>
      toast.error("无法打开原文", { description: cause instanceof Error ? cause.message : "链接未通过本地安全检查。" })
    );
  };

  const markAllRead = async (): Promise<void> => {
    if (!feed || !snapshot) return;
    const unread = snapshot.items.filter((item) => item.state === "new").map((item) => item.id);
    if (unread.length === 0) return;
    try { await feed.markRead(unread); } catch (cause) {
      toast.error("操作失败", { description: cause instanceof Error ? cause.message : "无法更新已读状态。" });
    }
  };

  const toggleSource = async (source: FeedSourceDescriptor): Promise<void> => {
    if (!feed) return;
    try { await feed.updateSource(source.id, { enabled: !source.enabled }); } catch (cause) {
      toast.error("操作失败", { description: cause instanceof Error ? cause.message : "无法更新订阅状态。" });
    }
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
  const unreadCount = items.filter((item) => item.state === "new").length;
  const loading = refreshing.has("*");

  return (
    <section className="mx-auto w-full max-w-5xl px-1 pb-10 sm:px-2">
      <Toaster position="top-right" />
      <header className="mb-8 border-b border-border/70 pb-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold leading-10 text-foreground sm:text-4xl sm:leading-12">校园资讯</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">聚合评奖评优、出国境项目、校园活动与学院通知，阅读原文仍回到来源网站。</p>
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
      ) : tab === "settings" ? (
        <div className="space-y-5">
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-lg leading-7">刷新频率</CardTitle>
              <CardDescription>每个订阅源可单独设置抓取间隔，默认 1 小时。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {sources.length === 0 ? <p className="text-sm text-muted-foreground">还没有订阅任何信息源。</p> : sources.map((source) => (
                <div key={source.id} className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium leading-6">{source.name}</p>
                    <p className="text-xs leading-5 text-muted-foreground">间隔 {source.intervalMinutes} 分钟</p>
                  </div>
                  <div className="flex items-center gap-2">
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
            </CardContent>
          </Card>
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-lg leading-7">AI 处理</CardTitle>
              <CardDescription>把有明确时间的通知（评选答辩、报名截止、活动讲座）转成日程条目。校园资讯独立使用这里的服务商与模型，不读取 AI 助手的配置。</CardDescription>
            </CardHeader>
            <CardContent><CampusFeedAiSettings feed={feed} /></CardContent>
          </Card>
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-lg leading-7">新内容提醒</CardTitle>
              <CardDescription>新抓取到的通知会进入系统通知与应用内通知中心，可在系统设置中关闭。</CardDescription>
            </CardHeader>
          </Card>
        </div>
      ) : tab === "sources" ? (
        <div className="space-y-5">
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-lg leading-7">我的订阅</CardTitle>
              <CardDescription>{enabledSources.length} 个订阅源已启用，共 {sources.length} 个可用。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {sources.length === 0 ? (
                <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Rss className="size-5" aria-hidden="true" /></div>
                  <div>
                    <h2 className="font-semibold leading-7">还没有订阅信息源</h2>
                    <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">首次使用会按你的学院身份推荐订阅源，之后可以随时自由增删。</p>
                  </div>
                </div>
              ) : sources.map((source) => (
                <div key={source.id} className="flex items-center justify-between gap-4 rounded-lg border border-border/70 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium leading-6">{source.name}</p>
                      <Badge variant="secondary">{categoryLabel[source.category]}</Badge>
                      {source.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                    </div>
                    <p className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">{source.listUrl}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch checked={source.enabled} onCheckedChange={() => void toggleSource(source)} aria-label={`启用 ${source.name}`} />
                    <Button size="icon" variant="ghost" onClick={() => void removeSource(source)} aria-label={`取消订阅 ${source.name}`}><Trash2 className="size-4" aria-hidden="true" /></Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <p className="flex items-center gap-2 px-1 text-xs leading-5 text-muted-foreground"><Plus className="size-3.5" aria-hidden="true" />更多信息源（含各学院院网）将在后续版本分批加入。</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/70 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold leading-8">最新通知</h2>
                {unreadCount > 0 ? <Badge variant="secondary">{unreadCount} 条未读</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {sources.length === 0 ? "尚未配置订阅源" : Object.keys(snapshot?.lastRefresh ?? {}).length > 0 ? `上次更新 ${formatLastRefresh(Object.values(snapshot!.lastRefresh).sort().at(-1)!)}` : "尚未抓取，点击刷新开始"}
              </p>
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              {unreadCount > 0 ? <Button variant="outline" onClick={() => void markAllRead()} className="w-full sm:w-auto"><Check className="size-4" aria-hidden="true" />全部已读</Button> : null}
              <Button onClick={() => void refreshAll()} disabled={loading} className="w-full sm:w-auto"><RefreshCw className={loading ? "animate-spin" : undefined} aria-hidden="true" />{loading ? "刷新中" : "刷新全部"}</Button>
            </div>
          </div>

          {error ? <Alert variant="destructive"><AlertCircle className="size-4" aria-hidden="true" /><AlertTitle>部分信息源没有更新</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3"><span>{error}</span><Button size="sm" variant="outline" onClick={() => { setError(null); void refreshAll(); }}>重试</Button></AlertDescription></Alert> : null}

          {sources.length === 0 ? (
            <Card className="border-dashed shadow-none">
              <CardContent className="flex flex-col items-center gap-4 px-6 py-16 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Rss className="size-5" aria-hidden="true" /></div>
                <div>
                  <h2 className="font-semibold leading-7">还没有订阅信息源</h2>
                  <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">前往「订阅」页管理信息源，或直接点击刷新开始抓取默认订阅。</p>
                </div>
                <Button onClick={() => void refreshAll()} disabled={loading}><RefreshCw aria-hidden="true" />抓取默认订阅</Button>
              </CardContent>
            </Card>
          ) : loading && items.length === 0 ? (
            <div className="space-y-3" role="status" aria-live="polite">
              {[0, 1, 2].map((index) => <Card key={index} className="shadow-none"><CardHeader><Skeleton className="h-5 w-2/3" /></CardHeader><CardContent><Skeleton className="h-4 w-1/3" /></CardContent></Card>)}
            </div>
          ) : items.length === 0 ? (
            <Card className="shadow-none"><CardContent className="py-14 text-center text-sm text-muted-foreground">该订阅源暂无新内容。</CardContent></Card>
          ) : (
            <div className="space-y-5">
              {enabledSources.map((source) => {
                const sourceItems = items.filter((item) => item.sourceId === source.id);
                if (sourceItems.length === 0) return null;
                return (
                  <Card key={source.id} className="overflow-hidden shadow-sm">
                    <CardHeader className="border-b border-border/60 bg-muted/20 px-5 py-4 sm:px-6">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <CardTitle className="text-lg leading-7">{source.name}</CardTitle>
                          <CardDescription className="mt-1">{sourceItems.length} 条通知</CardDescription>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => void refreshSource(source.id)} disabled={refreshing.has(source.id)} aria-label={`刷新 ${source.name}`}><RefreshCw className={refreshing.has(source.id) ? "animate-spin" : undefined} aria-hidden="true" /></Button>
                      </div>
                    </CardHeader>
                    <CardContent className="divide-y divide-border/60 px-5 sm:px-6">
                      {sourceItems.map((item) => (
                        <article key={item.id} className={`py-4 first:pt-5 last:pb-5 ${item.state === "new" ? "bg-primary/[0.03]" : ""}`}>
                          <div className="flex items-start justify-between gap-3">
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
                    </CardContent>
                  </Card>
                );
              })}
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
            <div className="space-y-3">
              {scheduleCandidates.map((candidate, index) => (
                <div key={`${candidate.itemId}-${index}`} className="rounded-lg border border-border/70 px-4 py-3">
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
