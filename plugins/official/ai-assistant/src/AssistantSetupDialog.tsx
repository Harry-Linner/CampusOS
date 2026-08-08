import { useEffect, useState } from "react";
import type { PluginComponentProps } from "@campusos/shared";
import { AssistantModelFields } from "./AssistantModelFields";
import { AI_ASSISTANT_DEFAULT_MODEL } from "./prompt";

interface AssistantSetupDialogProps {
  assistant: NonNullable<PluginComponentProps["assistant"]>;
  onConfigured: () => void;
  onDismiss: () => void;
}

export const AssistantSetupDialog = ({
  assistant,
  onConfigured,
  onDismiss
}: AssistantSetupDialogProps): JSX.Element => {
  const [apiKey, setApiKey] = useState("");
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
      const result = await assistant.testConnection({ apiKey, model });
      setFeedback(`连接成功 · ${result.latencyMs} ms`);
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
      await assistant.saveSettings({ apiKey, model });
      onConfigured();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "配置保存失败。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="assistant-setup-backdrop" role="presentation">
      <section
        className="assistant-setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-setup-title"
      >
        <header>
          <p className="eyebrow">AI Assistant</p>
          <h2 id="assistant-setup-title">先配置 API Key</h2>
          <p>AI 助手需要你的 OpenAI API Key 和模型名称。密钥只保存在这台设备的系统安全存储中。</p>
        </header>
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <AssistantModelFields
            apiKey={apiKey}
            autoFocusApiKey
            configured={false}
            model={model}
            onApiKeyChange={setApiKey}
            onModelChange={setModel}
          />
          {error ? <p className="assistant-connection-result is-error" role="alert">{error}</p> : null}
          {feedback ? <p className="assistant-connection-result is-success" role="status">{feedback}</p> : null}
          <p className="assistant-privacy-copy">测试连接和消息解析会向 OpenAI 发起请求；仅粘贴或输入内容不会上传。</p>
          <div className="assistant-actions">
            <button
              className="primary-button"
              type="submit"
              disabled={!apiKey.trim() || !model.trim() || busy !== null}
            >
              {busy === "save" ? "正在保存" : "保存并开始使用"}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!apiKey.trim() || !model.trim() || busy !== null}
              onClick={() => void testConnection()}
            >
              {busy === "test" ? "正在测试" : "测试连接"}
            </button>
            <button className="text-button" type="button" disabled={busy !== null} onClick={onDismiss}>
              稍后配置
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
