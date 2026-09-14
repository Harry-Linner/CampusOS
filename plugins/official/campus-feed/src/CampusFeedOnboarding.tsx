import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Rss, Search } from "lucide-react";
import { CAMPUS_FEED_IDENTITIES, CAMPUS_FEED_INTERESTS, campusFeedRecommendationReasons } from "@campusos/shared";
import type { CampusFeedPreferencesInput, CampusFeedProfile, FeedSourceDescriptor } from "@campusos/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import "./campus-feed.css";
import { CampusFeedSourceGroups } from "./CampusFeedSourceGroups";

interface Props {
  catalog: FeedSourceDescriptor[];
  initialProfile?: CampusFeedProfile;
  initialSelected?: string[];
  initialDisabled?: string[];
  onSave: (input: CampusFeedPreferencesInput) => Promise<void>;
  onCancel?: () => void;
}

export const CampusFeedOnboarding = ({ catalog, initialProfile, initialSelected, initialDisabled, onSave, onCancel }: Props): JSX.Element => {
  const [profile, setProfile] = useState<CampusFeedProfile>(initialProfile ?? { identity: null, college: null, interests: [] });
  const [step, setStep] = useState<"profile" | "sources">("profile");
  const [selected, setSelected] = useState(new Set(initialSelected ?? []));
  const [manualChoices, setManualChoices] = useState<Map<string, boolean>>(new Map());
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colleges = [...new Set(catalog.flatMap((source) => source.college ? [source.college] : []))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const reasons = (source: FeedSourceDescriptor): string[] => campusFeedRecommendationReasons(source, profile);
  const recommended = catalog.filter((source) => reasons(source).length > 0);
  const recommendedIds = new Set(recommended.map(source => source.id));
  const ordered = [...catalog].sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) || reasons(b).length - reasons(a).length);
  const filtered = ordered.filter((source) => `${source.name} ${source.college ?? ""} ${source.topics?.join(" ") ?? ""} ${source.listUrl}`.toLowerCase().includes(query.trim().toLowerCase()));
  const save = async (skip = false): Promise<void> => {
    if (saving) return;
    setSaving(true); setError(null);
    try { await onSave({ profile, selectedSourceIds: skip ? initialSelected ?? [] : [...selected], ...(initialDisabled?.length ? { disabledSourceIds: initialDisabled.filter((id) => (skip ? initialSelected ?? [] : [...selected]).includes(id)) } : {}), skip }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，请重试。你的选择还在这里。"); }
    finally { setSaving(false); }
  };
  const toggle = (id: string): void => {
    const checked = !selected.has(id);
    setManualChoices(current => new Map(current).set(id, checked));
    setSelected(current => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; });
  };

  return <section className="campus-feed-setup" aria-label="校园资讯首次设置">
    <header className="campus-feed-setup-heading">
      <span className="campus-feed-setup-symbol"><Rss size={24} aria-hidden="true" /></span>
      <p className="campus-feed-eyebrow">校园资讯 · {step === "profile" ? "01 / 02" : "02 / 02"}</p>
      <h1>{step === "profile" ? "让校园消息，与你有关" : "选好你想关注的来源"}</h1>
      <p>{step === "profile" ? "告诉我们你的身份和兴趣，为你挑选值得关注的官网。" : "已按当前偏好重新勾选，你可以手动调整。"}</p>
    </header>
    {step === "profile" ? <div className="campus-feed-profile-fields">
      <fieldset><legend>你在校园的身份 <span>选填</span></legend><div className="campus-feed-choice-row">
        {CAMPUS_FEED_IDENTITIES.map(({ value, label }) => <button type="button" key={value} aria-pressed={profile.identity === value} onClick={() => setProfile({ ...profile, identity: profile.identity === value ? null : value })}>{label}</button>)}
      </div></fieldset>
      <label className="campus-feed-college-label">学院或学园 <span>选填</span>
        <select value={profile.college ?? ""} onChange={(event) => setProfile({ ...profile, college: event.target.value || null })}>
          <option value="">暂不选择 / 未列出我的学院</option>
          {colleges.map((college) => <option key={college}>{college}</option>)}
        </select>
      </label>
      <fieldset><legend>你想关注什么 <span>可多选</span></legend><div className="campus-feed-choice-row">
        {CAMPUS_FEED_INTERESTS.map((interest) => <button type="button" key={interest} aria-pressed={profile.interests.includes(interest)} onClick={() => setProfile({ ...profile, interests: profile.interests.includes(interest) ? profile.interests.filter((value) => value !== interest) : [...profile.interests, interest] })}>{interest}</button>)}
      </div></fieldset>
    </div> : <div className="campus-feed-source-picker">
      <div className="campus-feed-picker-summary"><strong>{selected.size} 个来源已选</strong><span>{recommended.length ? `${recommended.length} 个推荐来源` : "暂无匹配来源，可以手动选择"}</span></div>
      <label className="campus-feed-search"><Search size={16} aria-hidden="true" /><Input aria-label="搜索官网或栏目" placeholder="搜索学院、兴趣或官网" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="campus-feed-picker-list">
        {[{ label: "推荐来源", sources: filtered.filter(source => recommendedIds.has(source.id)) }, { label: "其他来源", sources: filtered.filter(source => !recommendedIds.has(source.id)) }].map(group => group.sources.length > 0 && <section key={group.label} aria-label={group.label}>
          <h2 className="campus-feed-picker-group-title">{group.label}</h2>
          <CampusFeedSourceGroups sources={group.sources} expanded={group.label === "推荐来源" || Boolean(query.trim())} renderSource={(source) => <label className="campus-feed-picker-item" key={source.id}>
          <input type="checkbox" aria-label={source.name} checked={selected.has(source.id)} onChange={() => toggle(source.id)} />
          <div><div className="campus-feed-picker-title"><strong>{source.site?.column ?? source.name}</strong></div>{source.site && <p>{source.tags.join(" · ")}</p>}</div>
        </label>} /></section>)}
        {filtered.length === 0 && <p className="campus-feed-muted">没有匹配的来源，试试学院名称或兴趣词。</p>}
      </div>
    </div>}
    {error && <p role="alert" className="campus-feed-error">{error}</p>}
    <footer className="campus-feed-setup-actions">
      <div>{step === "sources" ? <Button variant="ghost" disabled={saving} onClick={() => setStep("profile")}><ArrowLeft size={16} />返回修改</Button> : onCancel ? <Button variant="ghost" disabled={saving} onClick={onCancel}>返回资讯</Button> : <Button variant="ghost" disabled={saving} onClick={() => void save(true)}>暂不订阅，先看看</Button>}</div>
      {step === "profile" ? <Button onClick={() => {
        const next = new Set(recommended.map(source => source.id));
        for (const [id, checked] of manualChoices) { if (checked) next.add(id); else next.delete(id); }
        setSelected(next);
        setStep("sources");
      }}>查看推荐来源<ArrowRight size={16} /></Button> : <Button disabled={saving} onClick={() => void save()}><Check size={16} />{saving ? "保存中…" : "订阅所选并进入"}</Button>}
    </footer>
  </section>;
};
