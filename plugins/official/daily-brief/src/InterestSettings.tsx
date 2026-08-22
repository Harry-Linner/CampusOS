import { useEffect, useState } from "react";
import { AlertCircle, KeyRound, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { BriefAiProvider, BriefProfile } from "@campusos/shared";
import { BRIEF_AI_PROVIDER_DEFAULTS, BRIEF_AI_PROVIDER_LABELS, BRIEF_MAX_INTERESTS, BRIEF_MAX_WEIGHT, BRIEF_MIN_WEIGHT } from "@campusos/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

interface InterestSettingsProps { brief: NonNullable<import("@campusos/shared").PluginComponentProps["brief"]>; }
interface EditableInterest { id: string; name: string; weight: string; note: string; }
interface EditableAi { provider: BriefAiProvider; baseUrl: string; model: string; apiKey: string; apiKeyConfigured: boolean; }

const SOURCE_LABELS: Record<string, string> = {
  arxiv: "arXiv · 学术与计算机",
  "hacker-news": "Hacker News · 技术与创业",
  infoq: "InfoQ · 技术与工程",
  solidot: "Solidot · 科技与中文资讯"
};
const toEditable = (profile: BriefProfile): EditableInterest[] => profile.interests.map((interest, index) => ({ id: `interest-${index}`, name: interest.name, weight: String(interest.weight), note: interest.note ?? "" }));
const normalizeWeight = (value: string): number => { const parsed = Number.parseInt(value, 10); if (!Number.isFinite(parsed)) return BRIEF_MIN_WEIGHT; return Math.min(BRIEF_MAX_WEIGHT, Math.max(BRIEF_MIN_WEIGHT, parsed)); };
const toEditableAi = (profile: BriefProfile): EditableAi => ({
  provider: profile.ai?.provider ?? "deepseek",
  baseUrl: profile.ai?.baseUrl ?? BRIEF_AI_PROVIDER_DEFAULTS.deepseek.baseUrl,
  model: profile.ai?.model ?? "",
  apiKey: "",
  apiKeyConfigured: Boolean(profile.ai?.apiKeyConfigured)
});

export const InterestSettings = ({ brief }: InterestSettingsProps): JSX.Element => {
  const [interests, setInterests] = useState<EditableInterest[]>([]);
  const [sourceEnabled, setSourceEnabled] = useState<Record<string, boolean>>({});
  const [ai, setAi] = useState<EditableAi>(() => toEditableAi({ interests: [], sourceEnabled: {}, savedAt: null }));
  const [clearAiKey, setClearAiKey] = useState(false);
  const [busy, setBusy] = useState<"load" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setBusy("load");
    void brief.loadSettings().then((profile) => { if (active) { setInterests(toEditable(profile)); setSourceEnabled(profile.sourceEnabled); setAi(toEditableAi(profile)); } }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "读取设置失败。"); }).finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, [brief]);

  const updateInterest = (id: string, patch: Partial<EditableInterest>): void => setInterests((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const addInterest = (): void => setInterests((current) => [...current, { id: `interest-${Date.now()}-${current.length}`, name: "", weight: "5", note: "" }]);
  const removeInterest = (id: string): void => setInterests((current) => current.filter((item) => item.id !== id));

  const changeAiProvider = (provider: BriefAiProvider): void => {
    const defaults = BRIEF_AI_PROVIDER_DEFAULTS[provider];
    setAi((current) => ({ ...current, provider, baseUrl: defaults.baseUrl }));
  };

  const save = async (): Promise<void> => {
    if (busy === "save") return;
    setBusy("save");
    setError(null);
    try {
      const saved = await brief.saveSettings({
        interests: interests.map((interest) => ({ name: interest.name.trim(), weight: normalizeWeight(interest.weight), note: interest.note.trim() || null })).filter((interest) => interest.name.length > 0),
        sourceEnabled,
        ai: {
          provider: ai.provider,
          protocol: BRIEF_AI_PROVIDER_DEFAULTS[ai.provider].protocol,
          baseUrl: ai.baseUrl.trim(),
          model: ai.model.trim(),
          ...(ai.apiKey.trim() ? { apiKey: ai.apiKey.trim() } : {}),
          ...(clearAiKey ? { clearApiKey: true } : {})
        }
      });
      setInterests(toEditable(saved));
      setAi(toEditableAi(saved));
      setClearAiKey(false);
      toast.success("设置已保存", { description: "刷新早报时会使用新的领域权重、信息源和 AI 连接。" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败。"); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-6">
      {error ? <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>设置没有保存</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">关注领域会帮助模型安排板块顺序；信息源只影响抓取范围。早报使用下方独立配置的 AI 服务，与 AI 助手互不影响。</p>
      {busy === "load" ? <div className="space-y-3">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-10 w-full" />)}</div> : <>
        <section aria-labelledby="interest-settings-heading" className="space-y-4">
          <div className="flex items-end justify-between gap-3"><div><h2 id="interest-settings-heading" className="text-base font-semibold leading-7">关注领域</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">最多 {BRIEF_MAX_INTERESTS} 个，权重范围 {BRIEF_MIN_WEIGHT} 到 {BRIEF_MAX_WEIGHT}</p></div><span className="font-mono text-xs text-muted-foreground">{interests.length}/{BRIEF_MAX_INTERESTS}</span></div>
          {interests.length === 0 ? <p className="rounded-lg border border-dashed px-4 py-5 text-sm leading-6 text-muted-foreground">还没有关注领域。添加一个具体主题，早报会更容易筛出有用内容。</p> : <div className="space-y-3">{interests.map((interest) => <div key={interest.id} className="grid gap-3 rounded-lg border border-border/70 bg-background p-3 sm:grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)_auto] sm:items-center sm:border-0 sm:bg-transparent sm:p-0"><Input aria-label="领域名称" value={interest.name} placeholder="领域名称，例如：数学" onChange={(event) => updateInterest(interest.id, { name: event.target.value })} /><Input aria-label="权重" type="number" min={BRIEF_MIN_WEIGHT} max={BRIEF_MAX_WEIGHT} value={interest.weight} title={`权重（${BRIEF_MIN_WEIGHT}-${BRIEF_MAX_WEIGHT}）`} onChange={(event) => updateInterest(interest.id, { weight: event.target.value })} /><Input aria-label="备注" value={interest.note} placeholder="备注（可选）" onChange={(event) => updateInterest(interest.id, { note: event.target.value })} /><Button type="button" variant="ghost" size="icon" aria-label={`删除领域 ${interest.name || "未命名"}`} onClick={() => removeInterest(interest.id)}><Trash2 className="size-4" /></Button></div>)}</div>}
          <Button type="button" variant="outline" size="sm" disabled={interests.length >= BRIEF_MAX_INTERESTS} onClick={addInterest}><Plus className="size-4" />添加领域</Button>
        </section>
        <Separator />
        <section aria-labelledby="source-settings-heading" className="space-y-4"><div><h2 id="source-settings-heading" className="text-base font-semibold leading-7">信息源</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">只抓取公开 RSS 内容，不会读取校园账号数据。</p></div><div className="grid gap-2 sm:grid-cols-2">{Object.entries(SOURCE_LABELS).map(([sourceId, label]) => <label key={sourceId} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-4 py-3 transition-colors hover:bg-muted/40"><span className="text-sm">{label}</span><Switch checked={sourceEnabled[sourceId] !== false} onCheckedChange={(checked) => setSourceEnabled((current) => ({ ...current, [sourceId]: checked }))} /></label>)}</div></section>
        <Separator />
        <section aria-labelledby="brief-ai-heading" className="space-y-4">
          <div><h2 id="brief-ai-heading" className="text-base font-semibold leading-7 flex items-center gap-2"><KeyRound className="size-4" aria-hidden="true" />AI 连接</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">早报独立使用这里的服务商与模型，不读取 AI 助手的配置。</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5"><span className="text-xs leading-5 text-muted-foreground">服务商</span><select className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" aria-label="服务商" value={ai.provider} onChange={(event) => changeAiProvider(event.target.value as BriefAiProvider)}>{Object.entries(BRIEF_AI_PROVIDER_LABELS).map(([provider, label]) => <option key={provider} value={provider}>{label}</option>)}</select></label>
            <label className="grid gap-1.5"><span className="text-xs leading-5 text-muted-foreground">模型</span><Input aria-label="模型" value={ai.model} placeholder="例如：deepseek-chat" onChange={(event) => setAi((current) => ({ ...current, model: event.target.value }))} /></label>
          </div>
          <label className="grid gap-1.5"><span className="text-xs leading-5 text-muted-foreground">接口地址</span><Input aria-label="接口地址" value={ai.baseUrl} placeholder="https://…" onChange={(event) => setAi((current) => ({ ...current, baseUrl: event.target.value }))} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5"><span className="text-xs leading-5 text-muted-foreground">API Key</span><Input aria-label="API Key" type="password" value={ai.apiKey} placeholder={ai.apiKeyConfigured && !clearAiKey ? "已配置，留空保持不变" : "输入 API Key"} onChange={(event) => setAi((current) => ({ ...current, apiKey: event.target.value }))} /></label>
            {ai.apiKeyConfigured ? <label className="flex items-end gap-2 pb-0.5"><Button type="button" variant="outline" size="sm" className={clearAiKey ? "bg-destructive/10 text-destructive" : undefined} onClick={() => setClearAiKey((current) => !current)}>{clearAiKey ? "点击保存将清除密钥" : "清除已保存的密钥"}</Button></label> : null}
          </div>
        </section>
      </>}
      <div className="flex justify-end"><Button type="button" onClick={() => void save()} disabled={busy !== null}><Save className="size-4" />{busy === "save" ? "正在保存" : "保存设置"}</Button></div>
    </div>
  );
};
