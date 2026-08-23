import type { AiAssistantProvider, AiAssistantProtocol } from "@campusos/shared";
import {
  AI_ASSISTANT_CUSTOM_MODEL,
  AI_ASSISTANT_MODEL_OPTIONS,
  AI_ASSISTANT_PROVIDER_OPTIONS
} from "./prompt";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AssistantModelFieldsProps {
  apiKey: string;
  autoFocusApiKey?: boolean;
  configured: boolean;
  provider: AiAssistantProvider;
  protocol: AiAssistantProtocol;
  baseUrl: string;
  model: string;
  discoveredModels?: string[];
  onApiKeyChange: (value: string) => void;
  onProviderChange: (value: AiAssistantProvider) => void;
  onProtocolChange: (value: AiAssistantProtocol) => void;
  onBaseUrlChange: (value: string) => void;
  onModelChange: (value: string) => void;
}

export const AssistantModelFields = ({
  apiKey,
  autoFocusApiKey = false,
  configured,
  provider,
  protocol,
  baseUrl,
  model,
  discoveredModels = [],
  onApiKeyChange,
  onProviderChange,
  onProtocolChange,
  onBaseUrlChange,
  onModelChange
}: AssistantModelFieldsProps): JSX.Element => {
  const presets = AI_ASSISTANT_MODEL_OPTIONS[provider] ?? [];
  const models = [...new Set([...presets.map((option) => option.value), ...discoveredModels])];
  const selectedModel = models.includes(model) ? model : AI_ASSISTANT_CUSTOM_MODEL;
  const protocolOptions = provider === "openai-compatible"
    ? [
      { value: "openai-chat-completions" as const, label: "OpenAI Chat Completions" },
      { value: "openai-responses" as const, label: "OpenAI Responses" }
    ]
    : [{ value: protocol, label: AI_ASSISTANT_PROVIDER_OPTIONS.find((option) => option.value === provider)?.protocol ?? protocol }];

  return (
    <>
      <div className="assistant-model-field">
        <Label htmlFor="assistant-model-provider">服务商</Label>
        <select
          id="assistant-model-provider"
          value={provider}
          onChange={(event) => {
            const next = AI_ASSISTANT_PROVIDER_OPTIONS.find((option) => option.value === event.target.value);
            if (!next) return;
            onApiKeyChange("");
            onProviderChange(next.value);
            onProtocolChange(next.protocol);
            onBaseUrlChange(next.baseUrl);
            onModelChange(AI_ASSISTANT_MODEL_OPTIONS[next.value][0]?.value ?? "");
          }}
        >
          {AI_ASSISTANT_PROVIDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <div className="assistant-model-field">
        <Label htmlFor="assistant-model-api-key">API Key</Label>
        <Input
          id="assistant-model-api-key"
          type="password"
          autoFocus={autoFocusApiKey}
          autoComplete="off"
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
          placeholder={configured ? "留空以使用已保存的密钥" : "输入当前服务商的 API Key"}
        />
      </div>
      <div className="assistant-model-field">
        <Label htmlFor="assistant-model-base-url">API 地址</Label>
        <Input
          id="assistant-model-base-url"
          type="url"
          value={baseUrl}
          onChange={(event) => onBaseUrlChange(event.target.value)}
          placeholder="例如 https://api.example.com/v1"
        />
      </div>
      <div className="assistant-model-field">
        <Label htmlFor="assistant-model-protocol">协议</Label>
        <select id="assistant-model-protocol" disabled={provider !== "openai-compatible"} value={protocol} onChange={(event) => onProtocolChange(event.target.value as AiAssistantProtocol)}>
          {protocolOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <div className="assistant-model-field">
        <Label htmlFor="assistant-model-select">模型</Label>
        <select
          id="assistant-model-select"
          value={selectedModel}
          onChange={(event) => onModelChange(event.target.value === AI_ASSISTANT_CUSTOM_MODEL ? "" : event.target.value)}
        >
          {presets.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          {discoveredModels.filter((value) => !presets.some((option) => option.value === value)).map((value) => <option key={value} value={value}>{value} · 已发现</option>)}
          <option value={AI_ASSISTANT_CUSTOM_MODEL}>其他模型</option>
        </select>
      </div>
      {selectedModel === AI_ASSISTANT_CUSTOM_MODEL ? (
        <div className="assistant-model-field">
          <Label htmlFor="assistant-model-custom">自定义模型名称</Label>
          <Input id="assistant-model-custom" value={model} onChange={(event) => onModelChange(event.target.value)} placeholder="填写服务商返回的模型 ID" />
        </div>
      ) : null}
    </>
  );
};
