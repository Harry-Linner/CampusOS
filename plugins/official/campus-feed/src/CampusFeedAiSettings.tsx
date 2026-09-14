import { useEffect, useState } from "react";
import { AlertCircle, Save, Wifi } from "lucide-react";
import { toast } from "sonner";
import type { CampusFeedAiConnection, CampusFeedAiProvider, CampusFeedBridge } from "@campusos/shared";
import { BRIEF_AI_PROVIDER_DEFAULTS, BRIEF_AI_PROVIDER_LABELS } from "@campusos/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

interface EditableAi {
  provider: CampusFeedAiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  apiKeyConfigured: boolean;
}

const toEditable = (connection: CampusFeedAiConnection | null): EditableAi => ({
  provider: connection?.provider ?? "deepseek",
  baseUrl: connection?.baseUrl ?? BRIEF_AI_PROVIDER_DEFAULTS.deepseek.baseUrl,
  model: connection?.model ?? "",
  apiKey: "",
  apiKeyConfigured: Boolean(connection?.apiKeyConfigured)
});

export const CampusFeedAiSettings = ({ feed }: { feed: CampusFeedBridge }): JSX.Element => {
  const [ai, setAi] = useState<EditableAi>(() => toEditable(null));
  const [clearAiKey, setClearAiKey] = useState(false);
  const [busy, setBusy] = useState<"load" | "save" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setBusy("load");
    void feed.loadAiSettings().then((connection) => {
      if (active) setAi(toEditable(connection));
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "读取 AI 设置失败。");
    }).finally(() => {
      if (active) setBusy(null);
    });
    return () => { active = false; };
  }, [feed]);

  const changeProvider = (provider: CampusFeedAiProvider): void => {
    const defaults = BRIEF_AI_PROVIDER_DEFAULTS[provider];
    setAi((current) => ({ ...current, provider, baseUrl: defaults.baseUrl }));
    setTestResult(null);
  };

  const save = async (): Promise<void> => {
    if (busy !== null) return;
    setBusy("save");
    setError(null);
    try {
      const saved = await feed.saveAiSettings({
        provider: ai.provider,
        protocol: BRIEF_AI_PROVIDER_DEFAULTS[ai.provider].protocol,
        baseUrl: ai.baseUrl.trim(),
        model: ai.model.trim(),
        ...(ai.apiKey.trim() ? { apiKey: ai.apiKey.trim() } : {}),
        ...(clearAiKey ? { clearApiKey: true } : {})
      });
      setAi(toEditable(saved));
      setClearAiKey(false);
      toast.success("AI 连接已保存", { description: "之后可以把新通知处理进日程。" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败。");
    } finally {
      setBusy(null);
    }
  };

  const test = async (): Promise<void> => {
    if (busy !== null) return;
    if (!ai.apiKey.trim()) {
      setTestResult("请先填写 API Key 再测试。");
      return;
    }
    setBusy("test");
    setTestResult(null);
    try {
      const result = await feed.testAiConnection({
        provider: ai.provider,
        protocol: BRIEF_AI_PROVIDER_DEFAULTS[ai.provider].protocol,
        baseUrl: ai.baseUrl.trim(),
        model: ai.model.trim(),
        apiKey: ai.apiKey.trim()
      });
      setTestResult(result.message);
    } catch (cause) {
      setTestResult(cause instanceof Error ? cause.message : "连接测试失败。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {error ? <Alert variant="destructive"><AlertCircle className="size-4" aria-hidden="true" /><AlertTitle>AI 连接没有保存</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {busy === "load" ? <div className="space-y-3">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-10 w-full" />)}</div> : <>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5"><span className="text-xs leading-5 text-muted-foreground">服务商</span><select className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" aria-label="服务商" value={ai.provider} onChange={(event) => changeProvider(event.target.value as CampusFeedAiProvider)}>{Object.entries(BRIEF_AI_PROVIDER_LABELS).map(([provider, label]) => <option key={provider} value={provider}>{label}</option>)}</select></label>
          <label className="grid gap-1.5"><span className="text-xs leading-5 text-muted-foreground">模型</span><Input aria-label="模型" value={ai.model} placeholder="例如：deepseek-v4-flash" onChange={(event) => setAi((current) => ({ ...current, model: event.target.value }))} /></label>
        </div>
        <label className="grid gap-1.5"><span className="text-xs leading-5 text-muted-foreground">接口地址</span><Input aria-label="接口地址" value={ai.baseUrl} placeholder="https://…" onChange={(event) => setAi((current) => ({ ...current, baseUrl: event.target.value }))} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5"><span className="text-xs leading-5 text-muted-foreground">API Key</span><Input aria-label="API Key" type="password" value={ai.apiKey} placeholder={ai.apiKeyConfigured && !clearAiKey ? "已配置，留空保持不变" : "输入 API Key"} onChange={(event) => setAi((current) => ({ ...current, apiKey: event.target.value }))} /></label>
          {ai.apiKeyConfigured ? <label className="flex items-end gap-2 pb-0.5"><Button type="button" variant="outline" size="sm" className={clearAiKey ? "bg-destructive/10 text-destructive" : undefined} onClick={() => setClearAiKey((current) => !current)}>{clearAiKey ? "点击保存将清除密钥" : "清除已保存的密钥"}</Button></label> : null}
        </div>
        {testResult ? <p className={`text-sm leading-6 ${testResult.includes("成功") ? "text-primary" : "text-destructive"}`}>{testResult}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => void test()} disabled={busy !== null}><Wifi className="size-4" aria-hidden="true" />{busy === "test" ? "测试中" : "测试连接"}</Button>
          <Button type="button" onClick={() => void save()} disabled={busy !== null}><Save className="size-4" aria-hidden="true" />{busy === "save" ? "正在保存" : "保存设置"}</Button>
        </div>
      </>}
    </div>
  );
};
