import { useState } from "react";
import { ExternalLink, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import type { CampusFeedBridge, CampusFeedSnapshot } from "@campusos/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CampusFeedSourceGroups } from "./CampusFeedSourceGroups";

export const CampusFeedSubscriptions = ({ snapshot, feed, onPreferences }: { snapshot: CampusFeedSnapshot; feed: CampusFeedBridge; onPreferences: () => void }): JSX.Element => {
  const [query, setQuery] = useState("");
  const [discover, setDiscover] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const subscribedIds = new Set(snapshot.sources.map(source => source.id));
  const sources = discover ? (snapshot.catalog ?? []).filter(source => !subscribedIds.has(source.id)) : snapshot.sources;
  const visible = sources.filter((source) => `${source.name} ${source.college ?? ""} ${source.tags.join(" ")} ${source.topics?.join(" ") ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const act = async (id: string, action: () => Promise<unknown>): Promise<void> => {
    if (busy) return; setBusy(id); setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请重试。"); } finally { setBusy(null); }
  };
  return <section className="settings-section" aria-label="资讯订阅管理">
    <header className="settings-section-heading"><div><h2>你的校园信息源</h2><p className="text-xs text-muted-foreground mt-1">{snapshot.sources.length} 个已订阅来源</p></div><Button variant="outline" size="sm" onClick={onPreferences}>调整身份与兴趣</Button></header>
    <div className="flex flex-wrap items-center gap-3 mb-4"><div role="group" aria-label="来源目录"><Button variant={!discover ? "secondary" : "ghost"} size="sm" onClick={() => setDiscover(false)}>我的订阅</Button><Button variant={discover ? "secondary" : "ghost"} size="sm" onClick={() => setDiscover(true)}>发现来源</Button></div></div>
    <label className="campus-feed-search"><Search size={16} aria-hidden="true" /><Input aria-label="搜索信息源" placeholder="按学院或兴趣查找来源" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    {error && <p role="alert" className="campus-feed-error">{error}</p>}
    <CampusFeedSourceGroups sources={visible} expanded={!discover || Boolean(query.trim())} renderSource={(source) => {
      const subscription = snapshot.sources.find((entry) => entry.id === source.id);
      return <article className="campus-feed-source-row" key={source.id}>
        <div><h3>{source.site?.column ?? source.name}</h3>{source.site && <p>{source.tags.join(" · ")}</p>}</div>
        <div className="campus-feed-source-controls">
          <Button size="icon" variant="ghost" aria-label={`打开 ${source.name} 官网`} disabled={busy !== null} onClick={() => void act(source.id, () => feed.openExternal(source.listUrl))}><ExternalLink size={15} /></Button>
          {subscription ? <><Button size="icon" variant="ghost" aria-label={`刷新 ${source.name}`} disabled={busy !== null} onClick={() => void act(source.id, () => feed.refreshSource(source.id))}><RefreshCw size={15} className={busy === source.id ? "animate-spin" : ""} /></Button><label className="flex items-center gap-1 text-xs text-muted-foreground">抓取<Switch disabled={busy !== null} checked={subscription.enabled} aria-label={`抓取 ${source.name}`} onCheckedChange={(enabled) => void act(source.id, () => feed.updateSource(source.id, { enabled }))} /></label><label className="flex items-center gap-1 text-xs text-muted-foreground">通知<Switch disabled={busy !== null} checked={subscription.notificationEnabled !== false} aria-label={`接收 ${source.name} 的通知`} onCheckedChange={(enabled) => void act(source.id, () => feed.updateSource(source.id, { notificationEnabled: enabled }))} /></label><Button size="icon" variant="ghost" disabled={busy !== null} aria-label={`取消订阅 ${source.name}`} onClick={() => void act(source.id, () => feed.removeSource(source.id))}><Trash2 size={15} /></Button></> : <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void act(source.id, () => feed.addSource(source.id))}><Plus size={15} />订阅</Button>}
        </div>
      </article>;
    }} />
    {visible.length === 0 && <div className="campus-feed-muted"><p>{query ? "没有匹配的信息源，试试其他关键词。" : discover ? "暂无新的信息源" : "还没有订阅，去发现页面选择官网，或调整身份兴趣获取建议。"}</p>{!discover && <Button variant="outline" className="mt-4" onClick={() => setDiscover(true)}>发现信息源</Button>}</div>}
  </section>;
};
