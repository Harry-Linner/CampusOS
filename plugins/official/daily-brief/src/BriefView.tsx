import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ExternalLink,
  Newspaper,
  RefreshCw
} from "lucide-react";
import type {
  BriefItem,
  BriefState,
  PluginComponentProps
} from "@campusos/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { InterestSettings } from "./InterestSettings";

type BriefTab = "daily" | "settings";

const statusLabel: Record<BriefState["status"], string> = {
  idle: "尚未生成",
  fetching: "正在抓取信息源…",
  generating: "AI 正在生成摘要…",
  ready: "已生成",
  error: "生成失败"
};

const isLoading = (status: BriefState["status"]): boolean =>
  status === "fetching" || status === "generating";

export const BriefView = (props: PluginComponentProps): JSX.Element => {
  const brief = props.brief;
  const [tab, setTab] = useState<BriefTab>("daily");
  const [state, setState] = useState<BriefState>({
    status: "idle",
    snapshot: null,
    error: null
  });
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const busyRef = useRef(false);
  const autoRefreshed = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!brief || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      setState(await brief.refresh());
    } catch (cause) {
      setState((current) => ({
        status: "error",
        snapshot: current.snapshot,
        error: cause instanceof Error ? cause.message : "刷新失败。"
      }));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [brief]);

  useEffect(() => {
    if (!brief) return;
    let active = true;
    void brief
      .getState()
      .then((next) => {
        if (!active) return;
        setState(next);
        // Generate on first open when nothing has been produced yet.
        if (!autoRefreshed.current && next.status === "idle" && !next.snapshot) {
          autoRefreshed.current = true;
          void refresh();
        }
      })
      .catch(() => undefined);
    const unsubscribe = brief.subscribe((next) => setState(next));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [brief, refresh]);

  const openOriginal = (item: BriefItem): void => {
    if (!brief) return;
    void brief.openExternal(item.fingerprint).catch(() => undefined);
  };

  const toggleExpanded = (fingerprint: string): void => {
    setExpanded((current) => ({
      ...current,
      [fingerprint]: !current[fingerprint]
    }));
  };

  const snapshot = state.snapshot;
  const hasContent = (snapshot?.sections.length ?? 0) > 0;
  const showContent = !isLoading(state.status) && !busy && Boolean(snapshot);
  const showEmpty =
    !isLoading(state.status) && !busy && !state.error && !snapshot;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Toaster position="top-right" />
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Newspaper className="size-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">早报</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            按关注领域聚合外部资讯，生成全中文摘要日报。
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-[3px]" role="tablist">
          <Button
            size="sm"
            variant={tab === "daily" ? "default" : "ghost"}
            role="tab"
            aria-selected={tab === "daily"}
            onClick={() => setTab("daily")}
          >
            日报
          </Button>
          <Button
            size="sm"
            variant={tab === "settings" ? "default" : "ghost"}
            role="tab"
            aria-selected={tab === "settings"}
            onClick={() => setTab("settings")}
          >
            设置
          </Button>
        </div>
      </header>

      {tab === "settings" ? (
        brief ? (
          <InterestSettings brief={brief} />
        ) : (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>桥接不可用</AlertTitle>
            <AlertDescription>早报桥接不可用，请重启 CampusOS。</AlertDescription>
          </Alert>
        )
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">
                {snapshot?.date ?? "今日早报"}
              </h2>
              {snapshot?.generatedAt ? (
                <p className="text-xs text-muted-foreground">
                  生成于 {new Date(snapshot.generatedAt).toLocaleTimeString("zh-CN")}
                </p>
              ) : null}
            </div>
            <Button
              onClick={() => void refresh()}
              disabled={!brief || busy}
            >
              <RefreshCw className={busy ? "animate-spin" : undefined} />
              {busy ? "生成中…" : "刷新早报"}
            </Button>
          </div>

          {!brief ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>桥接不可用</AlertTitle>
              <AlertDescription>早报桥接不可用，请重启 CampusOS。</AlertDescription>
            </Alert>
          ) : null}

          {state.error ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>生成失败</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>{state.error}</span>
                {state.snapshot ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void refresh()}
                    disabled={busy}
                  >
                    重试
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {isLoading(state.status) ? (
            <div className="space-y-4" role="status">
              <p className="text-sm text-muted-foreground">
                {statusLabel[state.status]}
              </p>
              {[0, 1, 2].map((index) => (
                <Card key={index}>
                  <CardHeader>
                    <Skeleton className="h-5 w-40" />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-8 w-28" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}

          {(snapshot?.degradedSources.length ?? 0) > 0 ? (
            <p className="text-sm text-muted-foreground">
              部分信息源暂不可用：{snapshot!.degradedSources.join("、")}
            </p>
          ) : null}

          {showEmpty ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
                <p className="max-w-md text-sm text-muted-foreground">
                  点击"刷新早报"抓取最新资讯并生成今日摘要。生成前请在 AI 助手设置中配置 API Key。
                </p>
                <Button onClick={() => void refresh()} disabled={busy}>
                  <RefreshCw className={busy ? "animate-spin" : undefined} />
                  刷新早报
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {showContent && !hasContent ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                {snapshot!.note ?? "今日暂无新内容。"}
              </CardContent>
            </Card>
          ) : null}

          {showContent && hasContent ? (
            <div className="space-y-6">
              {snapshot!.sections.map((section) => (
                <Card key={section.interest}>
                  <CardHeader>
                    <CardTitle>{section.interest}</CardTitle>
                    <CardDescription>{section.items.length} 条摘要</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {section.items.map((item) => (
                      <article key={item.fingerprint} className="space-y-2">
                        <h3 className="font-medium leading-snug">
                          {item.titleZh}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {item.summary}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="secondary">{item.sourceLabel}</Badge>
                          {item.relevance ? <span>{item.relevance}</span> : null}
                        </div>
                        {expanded[item.fingerprint] ? (
                          <p className="text-xs text-muted-foreground">
                            原标题：{item.originalTitle}
                          </p>
                        ) : null}
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openOriginal(item)}
                          >
                            <ExternalLink className="size-3.5" />
                            阅读原文
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => toggleExpanded(item.fingerprint)}
                          >
                            {expanded[item.fingerprint] ? "收起" : "详情"}
                          </Button>
                        </div>
                      </article>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}

          {snapshot?.note && hasContent ? (
            <p className="text-sm text-muted-foreground">{snapshot.note}</p>
          ) : null}
        </div>
      )}
    </div>
  );
};
