import { useEffect, useState } from "react";
import type { AiAssistantProvider, AiAssistantProtocol, PluginComponentProps } from "@campusos/shared";
import { AssistantModelFields } from "./AssistantModelFields";
import { Button } from "@/components/ui/button";
import {
  AI_ASSISTANT_DEFAULT_BASE_URL,
  AI_ASSISTANT_DEFAULT_MODEL,
  AI_ASSISTANT_DEFAULT_PROVIDER,
  AI_ASSISTANT_DEFAULT_PROTOCOL
} from "./prompt";

interface AssistantSetupDialogProps {
  assistant: NonNullable<PluginComponentProps["assistant"]>;
  onConfigured: () => void;
  onDismiss: () => void;
}

export const AssistantSetupDialog = ({ assistant, onConfigured, onDismiss }: AssistantSetupDialogProps): JSX.Element => {
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<AiAssistantProvider>(AI_ASSISTANT_DEFAULT_PROVIDER);
  const [protocol, setProtocol] = useState<AiAssistantProtocol>(AI_ASSISTANT_DEFAULT_PROTOCOL);
  const [baseUrl, setBaseUrl] = useState(AI_ASSISTANT_DEFAULT_BASE_URL);
  const [model, setModel] = useState(AI_ASSISTANT_DEFAULT_MODEL);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && busy === null) onDismiss();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [busy, onDismiss]);

  const testConnection = async (): Promise<void> => {
    setBusy("test");
    setError(null);
    setFeedback(null);
    try {
      const result = await assistant.testConnection({ apiKey, provider, protocol, baseUrl, model });
      setFeedback(`结构化能力可用 · ${result.provider} / ${result.model} · ${result.latencyMs} ms`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "连接测试失败。");
    } finally {
      setBusy(null);
    }
  };

  const save = async (): Promise<void> => {
    setBusy("save");
    setError(null);
    try {
      await assistant.saveSettings({ apiKey, provider, protocol, baseUrl, model });
      onConfigured();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "配置保存失败。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="assistant-setup-backdrop" role="presentation">
      <section className="assistant-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="assistant-setup-title">
        <header>
          <h2 id="assistant-setup-title">先配置 AI 连接</h2>
          <p>请选择服务商、API 地址和模型。密钥只保存在这台设备的系统安全存储中。</p>
        </header>
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <AssistantModelFields
            apiKey={apiKey}
            autoFocusApiKey
            configured={false}
            provider={provider}
            protocol={protocol}
            baseUrl={baseUrl}
            model={model}
            onApiKeyChange={setApiKey}
            onProviderChange={setProvider}
            onProtocolChange={setProtocol}
            onBaseUrlChange={setBaseUrl}
            onModelChange={setModel}
          />
          {error ? <p className="assistant-connection-result is-error" role="alert">{error}</p> : null}
          {feedback ? <p className="assistant-connection-result is-success" role="status">{feedback}</p> : null}
          <p className="assistant-privacy-copy">只有点击解析或连接测试时，当前请求才会发送给所选服务商；输入和粘贴本身不会上传。</p>
          <div className="assistant-actions">
            <Button type="submit" disabled={!apiKey.trim() || !model.trim() || !baseUrl.trim() || busy !== null}>{busy === "save" ? "正在保存" : "保存并开始使用"}</Button>
            <Button variant="secondary" type="button" disabled={!apiKey.trim() || !model.trim() || !baseUrl.trim() || busy !== null} onClick={() => void testConnection()}>{busy === "test" ? "正在测试" : "测试结构化能力"}</Button>
            <Button variant="ghost" type="button" disabled={busy !== null} onClick={onDismiss}>稍后配置</Button>
          </div>
        </form>
      </section>
    </div>
  );
};
