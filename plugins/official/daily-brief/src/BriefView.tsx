import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, Newspaper, RefreshCw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import type { BriefItem, BriefState, PluginComponentProps } from "@campusos/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { InterestSettings } from "./InterestSettings";

type BriefTab = "daily" | "settings";

const statusLabel: Record<BriefState["status"], string> = {
  idle: "尚未生成", fetching: "正在抓取信息源", generating: "正在整理摘要", ready: "已更新", error: "更新失败"
};
const isLoading = (status: BriefState["status"]): boolean => status === "fetching" || status === "generating";
const formatGeneratedAt = (value: string): string => new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }).format(new Date(value));

export const BriefView = (props: PluginComponentProps): JSX.Element => {
  const brief = props.brief;
  const [tab, setTab] = useState<BriefTab>("daily");
  const [state, setState] = useState<BriefState>({ status: "idle", snapshot: null, error: null });
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const busyRef = useRef(false);
  const autoRefreshed = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!brief || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { setState(await brief.refresh()); } catch (cause) {
      setState((current) => ({ status: "error", snapshot: current.snapshot, error: cause instanceof Error ? cause.message : "刷新失败。" }));
    } finally { busyRef.current = false; setBusy(false); }
  }, [brief]);

  useEffect(() => {
    if (!brief) return;
    let active = true;
    void brief.getState().then((next) => {
      if (!active) return;
      setState(next);
      if (!autoRefreshed.current && next.status === "idle" && !next.snapshot) { autoRefreshed.current = true; void refresh(); }
    }).catch(() => undefined);
    const unsubscribe = brief.subscribe((next) => setState(next));
    return () => { active = false; unsubscribe(); };
  }, [brief, refresh]);

  const openOriginal = (item: BriefItem): void => {
    if (!brief) return;
    void brief.openExternal(item.fingerprint).catch((cause) => toast.error(cause instanceof Error ? cause.message : "无法打开原文。", { description: "条目链接未通过本地安全检查。" }));
  };

  const snapshot = state.snapshot;
  const hasContent = (snapshot?.sections.length ?? 0) > 0;
  const loading = isLoading(state.status) || busy;
  const showEmpty = !snapshot && !loading && !state.error;

  return (
    <section className="mx-auto w-full max-w-5xl px-1 pb-10 sm:px-2">
      <Toaster position="top-right" />
      <header className="mb-8 border-b border-border/70 pb-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold leading-10 text-foreground sm:text-4xl sm:leading-12">早报</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">把公开资讯整理成按关注领域分组的中文摘要，阅读原文仍回到来源网站。</p>
          </div>
          <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
            <div className="flex gap-1 rounded-lg border border-border bg-muted/60 p-1" role="tablist" aria-label="早报视图">
              <Button size="sm" variant={tab === "daily" ? "default" : "ghost"} role="tab" aria-selected={tab === "daily"} onClick={() => setTab("daily")}>日报</Button>
              <Button size="sm" variant={tab === "settings" ? "default" : "ghost"} role="tab" aria-selected={tab === "settings"} onClick={() => setTab("settings")}><Settings2 className="size-3.5" aria-hidden="true" />设置</Button>
            </div>
          </div>
        </div>
      </header>

      {tab === "settings" ? (brief ? <InterestSettings brief={brief} /> : <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>桥接不可用</AlertTitle><AlertDescription>早报桥接不可用，请重启 CampusOS。</AlertDescription></Alert>) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/70 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold leading-8">{snapshot?.date ?? "今日早报"}</h2>{snapshot ? <Badge variant="secondary">{statusLabel[state.status]}</Badge> : null}</div><p className="mt-1 text-sm text-muted-foreground">{snapshot?.generatedAt ? `上次更新 ${formatGeneratedAt(snapshot.generatedAt)}` : "尚未生成今日摘要"}</p></div>
            <Button onClick={() => void refresh()} disabled={!brief || loading} className="w-full sm:w-auto"><RefreshCw className={loading ? "animate-spin" : undefined} aria-hidden="true" />{loading ? statusLabel[state.status] : "刷新早报"}</Button>
          </div>

          {state.error ? <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>早报没有更新</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3"><span>{state.error}</span>{snapshot ? <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={loading}>重试</Button> : null}</AlertDescription></Alert> : null}

          {loading ? <div className="space-y-3" role="status" aria-live="polite"><div className="flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" aria-hidden="true" /><span>{statusLabel[state.status]}，旧内容仍可阅读</span></div>{!snapshot ? [0, 1].map((index) => <Card key={index} className="shadow-none"><CardHeader><Skeleton className="h-5 w-36" /></CardHeader><CardContent className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></CardContent></Card>) : null}</div> : null}

          {(snapshot?.degradedSources.length ?? 0) > 0 ? <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-muted-foreground"><AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" /><span>部分信息源暂不可用：{snapshot!.degradedSources.join("、")}</span></div> : null}

          {showEmpty ? <Card className="border-dashed shadow-none"><CardContent className="flex flex-col items-center gap-4 px-6 py-16 text-center"><div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Newspaper className="size-5" aria-hidden="true" /></div><div><h2 className="font-semibold leading-7">今天还没有早报</h2><p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">点击刷新抓取公开资讯。生成摘要需要在 AI 助手中配置可用的模型连接。</p></div><Button onClick={() => void refresh()} disabled={!brief}><RefreshCw aria-hidden="true" />生成今日早报</Button></CardContent></Card> : null}

          {snapshot && !hasContent && !loading ? <Card className="shadow-none"><CardContent className="py-14 text-center text-sm text-muted-foreground">{snapshot.note ?? "今日暂无新内容。"}</CardContent></Card> : null}

          {snapshot && hasContent ? <div className="space-y-5">{snapshot.sections.map((section, sectionIndex) => <Card key={`${section.interest}-${sectionIndex}`} className="overflow-hidden shadow-sm"><CardHeader className="border-b border-border/60 bg-muted/20 px-5 py-4 sm:px-6"><div className="flex items-center justify-between gap-3"><div><CardTitle className="text-lg leading-7">{section.interest}</CardTitle><CardDescription className="mt-1">{section.items.length} 条摘要</CardDescription></div><span className="font-mono text-xs text-muted-foreground">{String(sectionIndex + 1).padStart(2, "0")}</span></div></CardHeader><CardContent className="divide-y divide-border/60 px-5 sm:px-6">{section.items.map((item) => <article key={item.fingerprint} className="py-6 first:pt-6 last:pb-6"><h3 className="text-base font-semibold leading-7 text-foreground">{item.titleZh}</h3><p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">{item.summary}</p><div className="mt-3 flex flex-wrap items-center gap-2 text-xs leading-5 text-muted-foreground"><Badge variant="secondary">{item.sourceLabel}</Badge>{item.relevance ? <span>{item.relevance}</span> : null}</div>{expanded[item.fingerprint] ? <p className="mt-3 border-l-2 border-primary/30 pl-3 text-xs leading-5 text-muted-foreground">原标题：{item.originalTitle}</p> : null}<div className="mt-4 flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onClick={() => openOriginal(item)}><ExternalLink className="size-3.5" aria-hidden="true" />阅读原文</Button><Button size="sm" variant="ghost" onClick={() => setExpanded((current) => ({ ...current, [item.fingerprint]: !current[item.fingerprint] }))}>{expanded[item.fingerprint] ? "收起详情" : "查看详情"}</Button></div></article>)}</CardContent></Card>)}</div> : null}

          {snapshot?.note && hasContent ? <p className="flex items-center gap-2 text-sm leading-6 text-muted-foreground"><CheckCircle2 className="size-4 text-primary" aria-hidden="true" />{snapshot.note}</p> : null}
        </div>
      )}
    </section>
  );
};
