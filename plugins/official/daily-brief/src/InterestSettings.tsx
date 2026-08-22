import { useEffect, useState } from "react";
import { AlertCircle, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { BriefProfile } from "@campusos/shared";
import { BRIEF_MAX_INTERESTS, BRIEF_MAX_WEIGHT, BRIEF_MIN_WEIGHT } from "@campusos/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

interface InterestSettingsProps { brief: NonNullable<import("@campusos/shared").PluginComponentProps["brief"]>; }
interface EditableInterest { id: string; name: string; weight: string; note: string; }

const SOURCE_LABELS: Record<string, string> = {
  arxiv: "arXiv · 学术与计算机",
  "hacker-news": "Hacker News · 技术与创业",
  infoq: "InfoQ · 技术与工程",
  solidot: "Solidot · 科技与中文资讯"
};
const toEditable = (profile: BriefProfile): EditableInterest[] => profile.interests.map((interest, index) => ({ id: `interest-${index}`, name: interest.name, weight: String(interest.weight), note: interest.note ?? "" }));
const normalizeWeight = (value: string): number => { const parsed = Number.parseInt(value, 10); if (!Number.isFinite(parsed)) return BRIEF_MIN_WEIGHT; return Math.min(BRIEF_MAX_WEIGHT, Math.max(BRIEF_MIN_WEIGHT, parsed)); };

export const InterestSettings = ({ brief }: InterestSettingsProps): JSX.Element => {
  const [interests, setInterests] = useState<EditableInterest[]>([]);
  const [sourceEnabled, setSourceEnabled] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<"load" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setBusy("load");
    void brief.loadSettings().then((profile) => { if (active) { setInterests(toEditable(profile)); setSourceEnabled(profile.sourceEnabled); } }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "读取设置失败。"); }).finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, [brief]);

  const updateInterest = (id: string, patch: Partial<EditableInterest>): void => setInterests((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const addInterest = (): void => setInterests((current) => [...current, { id: `interest-${Date.now()}-${current.length}`, name: "", weight: "5", note: "" }]);
  const removeInterest = (id: string): void => setInterests((current) => current.filter((item) => item.id !== id));

  const save = async (): Promise<void> => {
    if (busy === "save") return;
    setBusy("save");
    setError(null);
    try {
      const saved = await brief.saveSettings({ interests: interests.map((interest) => ({ name: interest.name.trim(), weight: normalizeWeight(interest.weight), note: interest.note.trim() || null })).filter((interest) => interest.name.length > 0), sourceEnabled });
      setInterests(toEditable(saved));
      toast.success("设置已保存", { description: "刷新早报时会使用新的领域权重和信息源。" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败。"); } finally { setBusy(null); }
  };

  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="border-b border-border/60 bg-muted/20 px-5 py-5 sm:px-6"><CardTitle>早报设置</CardTitle><CardDescription className="max-w-2xl leading-6">关注领域会帮助模型安排板块顺序；信息源只影响抓取范围。早报复用 AI 助手中已经验证过的服务商和模型连接。</CardDescription></CardHeader>
      <CardContent className="space-y-7 px-5 py-6 sm:px-6">
        {error ? <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>设置没有保存</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        {busy === "load" ? <div className="space-y-3">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-10 w-full" />)}</div> : <>
          <section aria-labelledby="interest-settings-heading" className="space-y-4">
            <div className="flex items-end justify-between gap-3"><div><h2 id="interest-settings-heading" className="text-sm font-semibold">关注领域</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">最多 {BRIEF_MAX_INTERESTS} 个，权重范围 {BRIEF_MIN_WEIGHT} 到 {BRIEF_MAX_WEIGHT}</p></div><span className="font-mono text-xs text-muted-foreground">{interests.length}/{BRIEF_MAX_INTERESTS}</span></div>
            {interests.length === 0 ? <p className="rounded-lg border border-dashed px-4 py-5 text-sm leading-6 text-muted-foreground">还没有关注领域。添加一个具体主题，早报会更容易筛出有用内容。</p> : <div className="space-y-3">{interests.map((interest) => <div key={interest.id} className="grid gap-3 rounded-lg border border-border/70 bg-background p-3 sm:grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)_auto] sm:items-center sm:border-0 sm:bg-transparent sm:p-0"><Input aria-label="领域名称" value={interest.name} placeholder="领域名称，例如：数学" onChange={(event) => updateInterest(interest.id, { name: event.target.value })} /><Input aria-label="权重" type="number" min={BRIEF_MIN_WEIGHT} max={BRIEF_MAX_WEIGHT} value={interest.weight} title={`权重（${BRIEF_MIN_WEIGHT}-${BRIEF_MAX_WEIGHT}）`} onChange={(event) => updateInterest(interest.id, { weight: event.target.value })} /><Input aria-label="备注" value={interest.note} placeholder="备注（可选）" onChange={(event) => updateInterest(interest.id, { note: event.target.value })} /><Button type="button" variant="ghost" size="icon" aria-label={`删除领域 ${interest.name || "未命名"}`} onClick={() => removeInterest(interest.id)}><Trash2 className="size-4" /></Button></div>)}</div>}
            <Button type="button" variant="outline" size="sm" disabled={interests.length >= BRIEF_MAX_INTERESTS} onClick={addInterest}><Plus className="size-4" />添加领域</Button>
          </section>
          <Separator />
          <section aria-labelledby="source-settings-heading" className="space-y-4"><div><h2 id="source-settings-heading" className="text-sm font-semibold">信息源</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">只抓取公开 RSS 内容，不会读取校园账号数据。</p></div><div className="grid gap-2 sm:grid-cols-2">{Object.entries(SOURCE_LABELS).map(([sourceId, label]) => <label key={sourceId} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-4 py-3 transition-colors hover:bg-muted/40"><span className="text-sm">{label}</span><Switch checked={sourceEnabled[sourceId] !== false} onCheckedChange={(checked) => setSourceEnabled((current) => ({ ...current, [sourceId]: checked }))} /></label>)}</div></section>
        </>}
      </CardContent>
      <CardFooter className="justify-end border-t border-border/60 px-5 py-4 sm:px-6"><Button type="button" onClick={() => void save()} disabled={busy !== null}><Save className="size-4" />{busy === "save" ? "正在保存" : "保存设置"}</Button></CardFooter>
    </Card>
  );
};
