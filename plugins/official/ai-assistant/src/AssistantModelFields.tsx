import {
  AI_ASSISTANT_CUSTOM_MODEL,
  AI_ASSISTANT_MODEL_OPTIONS
} from "./prompt";

interface AssistantModelFieldsProps {
  apiKey: string;
  autoFocusApiKey?: boolean;
  configured: boolean;
  model: string;
  onApiKeyChange: (value: string) => void;
  onModelChange: (value: string) => void;
}

export const AssistantModelFields = ({
  apiKey,
  autoFocusApiKey = false,
  configured,
  model,
  onApiKeyChange,
  onModelChange
}: AssistantModelFieldsProps): JSX.Element => {
  const selectedModel = AI_ASSISTANT_MODEL_OPTIONS.some(
    (option) => option.value === model
  )
    ? model
    : AI_ASSISTANT_CUSTOM_MODEL;

  return (
    <>
      <label>
        <span>API Key</span>
        <input
          type="password"
          autoFocus={autoFocusApiKey}
          autoComplete="off"
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
          placeholder={configured ? "留空以使用已保存的密钥" : "输入 OpenAI API Key"}
        />
      </label>
      <label>
        <span>模型</span>
        <select
          value={selectedModel}
          onChange={(event) => {
            onModelChange(
              event.target.value === AI_ASSISTANT_CUSTOM_MODEL
                ? ""
                : event.target.value
            );
          }}
        >
          {AI_ASSISTANT_MODEL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          <option value={AI_ASSISTANT_CUSTOM_MODEL}>其他模型</option>
        </select>
      </label>
      {selectedModel === AI_ASSISTANT_CUSTOM_MODEL ? (
        <label>
          <span>自定义模型名称</span>
          <input
            value={model}
            onChange={(event) => onModelChange(event.target.value)}
            placeholder="例如：你的可用模型名称"
          />
        </label>
      ) : null}
    </>
  );
};
