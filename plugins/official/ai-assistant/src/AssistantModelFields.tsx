import type { AiAssistantProvider } from "@campusos/shared";
import { AI_ASSISTANT_PROVIDER_OPTIONS } from "./prompt";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
  onClearKey: () => void;
}

/** 与【校园资讯-设置-AI处理】一比一复刻：服务商下拉 + 模型文本框 + 接口地址 + API Key。 */
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
  onModelChange,
  onClearKey
}: AssistantModelFieldsProps): JSX.Element => {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-xs leading-5 text-muted-foreground">服务商</span>
          <select
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            aria-label="服务商"
            value={provider}
            onChange={(event) => {
              const next = AI_ASSISTANT_PROVIDER_OPTIONS.find((option) => option.value === event.target.value);
              if (!next) return;
              onApiKeyChange("");
              onProviderChange(next.value);
              onBaseUrlChange(next.baseUrl);
              onModelChange("");
            }}
          >
            {AI_ASSISTANT_PROVIDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs leading-5 text-muted-foreground">模型</span>
          <Input
            aria-label="模型"
            value={model}
            placeholder="例如：deepseek-chat"
            onChange={(event) => onModelChange(event.target.value)}
          />
        </label>
      </div>
      <label className="grid gap-1.5">
        <span className="text-xs leading-5 text-muted-foreground">接口地址</span>
        <Input
          aria-label="接口地址"
          value={baseUrl}
          placeholder="https://…"
          onChange={(event) => onBaseUrlChange(event.target.value)}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-xs leading-5 text-muted-foreground">API Key</span>
          <Input
            aria-label="API Key"
            type="password"
            autoFocus={autoFocusApiKey}
            autoComplete="off"
            value={apiKey}
            placeholder={configured ? "已配置，留空保持不变" : "输入 API Key"}
            onChange={(event) => onApiKeyChange(event.target.value)}
          />
        </label>
        {configured ? (
          <label className="flex items-end gap-2 pb-0.5">
            <Button type="button" variant="outline" size="sm" className="text-destructive" onClick={onClearKey}>清除已保存的密钥</Button>
          </label>
        ) : null}
      </div>
    </div>
  );
};
