import type { AiAssistantProvider } from "@campusos/shared";
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
  baseUrl: string;
  model: string;
  onApiKeyChange: (value: string) => void;
  onProviderChange: (value: AiAssistantProvider) => void;
  onBaseUrlChange: (value: string) => void;
  onModelChange: (value: string) => void;
}

export const AssistantModelFields = ({
  apiKey,
  autoFocusApiKey = false,
  configured,
  provider,
  baseUrl,
  model,
  onApiKeyChange,
  onProviderChange,
  onBaseUrlChange,
  onModelChange
}: AssistantModelFieldsProps): JSX.Element => {
  const presets = AI_ASSISTANT_MODEL_OPTIONS[provider] ?? [];
  const selectedModel = presets.some((option) => option.value === model)
    ? model
    : model
      ? AI_ASSISTANT_CUSTOM_MODEL
      : presets[0]?.value ?? AI_ASSISTANT_CUSTOM_MODEL;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field-stack">
          <Label htmlFor="assistant-model-provider">服务商</Label>
          <select
            id="assistant-model-provider"
            value={provider}
            onChange={(event) => {
              const next = AI_ASSISTANT_PROVIDER_OPTIONS.find((option) => option.value === event.target.value);
              if (!next) return;
              onApiKeyChange("");
              onProviderChange(next.value);
              onBaseUrlChange(next.baseUrl);
              onModelChange(AI_ASSISTANT_MODEL_OPTIONS[next.value][0]?.value ?? "");
            }}
          >
            {AI_ASSISTANT_PROVIDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className="field-stack">
          <Label htmlFor="assistant-model-select">模型</Label>
          <select
            id="assistant-model-select"
            value={selectedModel}
            onChange={(event) => onModelChange(event.target.value === AI_ASSISTANT_CUSTOM_MODEL ? "" : event.target.value)}
          >
            {presets.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            <option value={AI_ASSISTANT_CUSTOM_MODEL}>其他模型</option>
          </select>
        </div>
      </div>
      {selectedModel === AI_ASSISTANT_CUSTOM_MODEL ? (
        <div className="field-stack">
          <Label htmlFor="assistant-model-custom">自定义模型名称</Label>
          <Input id="assistant-model-custom" value={model} onChange={(event) => onModelChange(event.target.value)} placeholder="填写服务商返回的模型 ID" />
        </div>
      ) : null}
      <div className="field-stack">
        <Label htmlFor="assistant-model-base-url">接口地址</Label>
        <Input
          id="assistant-model-base-url"
          type="url"
          value={baseUrl}
          onChange={(event) => onBaseUrlChange(event.target.value)}
          placeholder="https://…"
        />
      </div>
      <div className="field-stack">
        <Label htmlFor="assistant-model-api-key">API Key</Label>
        <Input
          id="assistant-model-api-key"
          type="password"
          autoFocus={autoFocusApiKey}
          autoComplete="off"
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
          placeholder={configured ? "已配置，留空保持不变" : "输入 API Key"}
        />
      </div>
    </>
  );
};
