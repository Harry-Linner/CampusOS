import { useEffect, useMemo, useRef, useState } from "react";
import type { CampusWorkspaceSnapshot, LocalTaskRecord, PluginComponentProps, CampusFeedBridge, CampusFeedHistorySearchResult } from "@campusos/shared";
import {
  buildGlobalSearchIndex,
  searchGlobalIndex,
  type GlobalSearchKind,
  type GlobalSearchNavigation
} from "../lib/globalSearch";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";

interface GlobalSearchProps {
  open: boolean;
  snapshot: CampusWorkspaceSnapshot | null;
  schedule?: PluginComponentProps["schedule"];
  campusFeed?: Pick<CampusFeedBridge, "searchHistory"> & Partial<Pick<CampusFeedBridge, "subscribe" | "getSnapshot">>;
  onClose: () => void;
  onNavigate: (navigation: GlobalSearchNavigation) => void;
}

const kindLabels: Record<GlobalSearchKind, string> = {
  course: "课程",
  item: "事项",
  material: "资料",
  feed: "资讯"
};

export const GlobalSearch = ({
  open,
  snapshot,
  schedule,
  campusFeed,
  onClose,
  onNavigate
}: GlobalSearchProps): JSX.Element | null => {
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<LocalTaskRecord[]>([]);
  const [feedItems, setFeedItems] = useState<CampusFeedHistorySearchResult["items"]>([]);
  const [feedTotal, setFeedTotal] = useState(0);
  const [feedOffset, setFeedOffset] = useState(0);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedRevision, setFeedRevision] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const index = useMemo(
    () => buildGlobalSearchIndex(snapshot, tasks),
    [snapshot, tasks]
  );
  const results = useMemo(() => [...searchGlobalIndex(index, query), ...feedItems.map(item => ({ id: `feed:${item.id}`, kind: "feed" as const, title: item.title, detail: [item.sourceName ?? item.sourceId, item.publishedAt?.slice(0, 10)].filter(Boolean).join(" · "), searchableText: "", navigation: { viewId: "campus-feed", entityId: item.id } }))], [index, query, feedItems]);

  // Load the local task store when the modal opens so self-created items are searchable.
  useEffect(() => {
    if (!open) return;
    if (!schedule?.loadTasks) return;
    let active = true;
    void schedule.loadTasks().then((data) => {
      if (active) setTasks(data.tasks);
    }).catch(() => undefined);
    const unsubscribe = schedule.subscribe?.(() => {
      void schedule.loadTasks().then((data) => setTasks(data.tasks)).catch(() => undefined);
    });
    return () => { active = false; unsubscribe?.(); };
  }, [open, schedule]);

  useEffect(() => {
    if (!open || !campusFeed?.subscribe) return;
    let active = true;
    let previousScope: string | undefined;
    const unsubscribe = campusFeed.subscribe(snapshot => {
      const scope = JSON.stringify(snapshot.sources.map(source => source.id).sort());
      if (scope === previousScope) return;
      previousScope = scope;
      setFeedRevision(current => current + 1); setFeedOffset(0); setFeedItems([]); setFeedTotal(0);
    });
    void campusFeed.getSnapshot?.().then(snapshot => {
      if (active && previousScope === undefined) previousScope = JSON.stringify(snapshot.sources.map(source => source.id).sort());
    }).catch(() => undefined);
    return () => { active = false; unsubscribe(); };
  }, [open, campusFeed]);

  // Query all retained metadata belonging to current subscriptions, never the 50-row browsing snapshot
  // or fetch article bodies to answer a keyword search.
  useEffect(() => {
    if (!open || !campusFeed || !query.trim()) { setFeedItems([]); setFeedTotal(0); setFeedLoading(false); setFeedError(null); return; }
    let active = true;
    setFeedLoading(true); setFeedError(null);
    const timer = window.setTimeout(() => {
      void campusFeed.searchHistory({ query, offset: feedOffset }).then(result => {
        if (active) { setFeedItems(current => feedOffset ? [...current, ...result.items] : result.items); setFeedTotal(result.total); }
      }).catch(() => { if (active) setFeedError("资讯搜索失败，请重新输入关键词重试。"); })
        .finally(() => { if (active) setFeedLoading(false); });
    }, 150);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, campusFeed, query, feedOffset, feedRevision]);

  useEffect(() => {
    if (!open) return;
    setQuery(""); setFeedOffset(0); setFeedItems([]);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="global-search-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="global-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
      >
        <label className="global-search-field">
          <span className="sr-only">搜索课程、事项、资料和资讯</span>
          <Input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="搜索课程、事项、资料和资讯"
            onChange={(event) => { setQuery(event.target.value); setFeedOffset(0); setFeedItems([]); setFeedTotal(0); }}
          />
          <kbd>Esc</kbd>
        </label>

        <div className="global-search-results" aria-live="polite">
          {feedLoading && <p role="status">正在搜索…</p>}
          {feedError && <p role="alert">{feedError}</p>}
          {!query.trim() ? (
            <p className="global-search-hint">输入名称、来源、日期或列表摘要关键词</p>
          ) : results.length === 0 ? (
            !feedLoading && !feedError ? <p className="global-search-hint">没有匹配结果</p> : null
          ) : (
            <ul>
              {results.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigate(result.navigation);
                      onClose();
                    }}
                  >
                    <span className="global-search-kind">
                      {kindLabels[result.kind]}
                    </span>
                    <span className="global-search-result-copy">
                      <strong>{result.title}</strong>
                      {result.detail ? <small>{result.detail}</small> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {feedItems.length < feedTotal && <Button type="button" variant="outline" disabled={feedLoading} onClick={() => setFeedOffset(feedItems.length)}>加载更多结果</Button>}
        </div>
      </section>
    </div>
  );
};
