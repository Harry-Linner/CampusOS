import type {
  AiAssistantProvider,
  AiAssistantProtocol
} from "@campusos/shared";

export interface AiProviderProfile {
  provider: AiAssistantProvider;
  protocol: AiAssistantProtocol;
  baseUrl: string;
  model: string;
}

export interface StructuredGenerationInput {
  systemPrompt: string;
  input: unknown;
  schemaName: string;
  schema: Record<string, unknown>;
}

export interface AiProviderAdapter {
  profile: AiProviderProfile;
  supportsModelListing: boolean;
  generateStructured: (input: StructuredGenerationInput) => Promise<unknown>;
  listModels: () => Promise<string[]>;
}

export type AiProviderErrorCode =
  | "network-error"
  | "auth-error"
  | "quota-error"
  | "rate-limited"
  | "model-not-found"
  | "unsupported-capability"
  | "invalid-response"
  | "upstream-error";

export class AiProviderAdapterError extends Error {
  constructor(
    readonly code: AiProviderErrorCode,
    message: string,
    options: { cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AiProviderAdapterError";
  }
}

const joinUrl = (baseUrl: string, path: string): string => {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/${path.replace(/^\/+/, "")}`;
};

const mapStatus = (status: number): AiProviderErrorCode => {
  if (status === 401 || status === 403) return "auth-error";
  if (status === 402 || status === 429) return status === 429 ? "rate-limited" : "quota-error";
  if (status === 404) return "model-not-found";
  return "upstream-error";
};

const readErrorDetail = (payload: unknown): string => {
  if (typeof payload !== "object" || payload === null) return "上游没有提供错误详情";
  const value = payload as Record<string, unknown>;
  const error = typeof value.error === "object" && value.error !== null
    ? value.error as Record<string, unknown>
    : value;
  const message = error.message;
  return typeof message === "string" && message.trim() ? message.trim().slice(0, 240) : "上游没有提供错误详情";
};

const requestJson = async (
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<unknown> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchFn(url, { ...init, signal: controller.signal });
  } catch (cause) {
    throw new AiProviderAdapterError("network-error", "无法连接 AI 服务，请检查网络或 Base URL。", { cause });
  } finally {
    clearTimeout(timeout);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch (cause) {
    if (!response.ok) {
      throw new AiProviderAdapterError(mapStatus(response.status), `AI 服务请求失败（HTTP ${response.status}）。`, { cause });
    }
    throw new AiProviderAdapterError("invalid-response", "AI 服务返回了无效 JSON。", { cause });
  }
  if (!response.ok) {
    const detail = readErrorDetail(payload);
    throw new AiProviderAdapterError(mapStatus(response.status), `AI 服务请求失败（HTTP ${response.status}）：${detail}`);
  }
  return payload;
};

const readResponsesText = (payload: unknown): string => {
  if (typeof payload !== "object" || payload === null) throw new AiProviderAdapterError("invalid-response" as AiProviderErrorCode, "Responses API 返回结构无效。");
  const value = payload as Record<string, unknown>;
  if (typeof value.output_text === "string") return value.output_text;
  if (!Array.isArray(value.output)) throw new AiProviderAdapterError("upstream-error", "Responses API 没有返回结构化内容。");
  for (const item of value.output) {
    if (typeof item !== "object" || item === null) continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const candidate = part as Record<string, unknown>;
      if (candidate.type === "refusal") throw new AiProviderAdapterError("unsupported-capability", "模型拒绝返回任务结构化结果。");
      if (candidate.type === "output_text" && typeof candidate.text === "string") return candidate.text;
    }
  }
  throw new AiProviderAdapterError("upstream-error", "Responses API 没有返回结构化内容。");
};

const readChatText = (payload: unknown): string => {
  const choices = typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>).choices
    : null;
  if (!Array.isArray(choices) || choices.length === 0) throw new AiProviderAdapterError("upstream-error", "Chat Completions 没有返回候选结果。");
  const message = choices[0] && typeof choices[0] === "object"
    ? (choices[0] as Record<string, unknown>).message
    : null;
  const content = message && typeof message === "object" ? (message as Record<string, unknown>).content : null;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content.find((part) => typeof part === "object" && part !== null && (part as Record<string, unknown>).type === "text");
    if (text && typeof (text as Record<string, unknown>).text === "string") return (text as Record<string, unknown>).text as string;
  }
  throw new AiProviderAdapterError("upstream-error", "Chat Completions 没有返回文本结果。");
};

const readAnthropicToolInput = (payload: unknown): unknown => {
  const content = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).content : null;
  if (!Array.isArray(content)) throw new AiProviderAdapterError("upstream-error", "Anthropic 没有返回工具结果。");
  const tool = content.find((part) => typeof part === "object" && part !== null && (part as Record<string, unknown>).type === "tool_use");
  if (!tool || typeof (tool as Record<string, unknown>).input !== "object") throw new AiProviderAdapterError("unsupported-capability", "当前 Anthropic 模型不支持结构化工具输出。");
  return (tool as Record<string, unknown>).input;
};

const readGeminiText = (payload: unknown): string => {
  const candidates = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).candidates : null;
  const content = Array.isArray(candidates) && candidates[0] && typeof candidates[0] === "object"
    ? (candidates[0] as Record<string, unknown>).content
    : null;
  const parts = content && typeof content === "object" ? (content as Record<string, unknown>).parts : null;
  const text = Array.isArray(parts) && parts[0] && typeof parts[0] === "object" ? (parts[0] as Record<string, unknown>).text : null;
  if (typeof text !== "string") throw new AiProviderAdapterError("upstream-error", "Gemini 没有返回结构化文本。");
  return text;
};

const parseStructuredJson = (text: string, providerLabel: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new AiProviderAdapterError("invalid-response", `${providerLabel} 返回的结构化内容不是有效 JSON。`, { cause });
  }
};

const readModels = (payload: unknown): string[] => {
  if (typeof payload !== "object" || payload === null) throw new AiProviderAdapterError("upstream-error", "模型列表结构无效。");
  const value = payload as Record<string, unknown>;
  const models = Array.isArray(value.data) ? value.data : Array.isArray(value.models) ? value.models : [];
  return models.map((item) => {
    if (typeof item === "string") return item;
    if (typeof item !== "object" || item === null) return "";
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id : candidate.name;
    return typeof id === "string" ? id.replace(/^models\//, "") : "";
  }).filter((id): id is string => id.length > 0).slice(0, 200);
};

export const createAiProviderAdapter = ({
  profile,
  apiKey,
  fetchFn = fetch,
  timeoutMs = 30_000
}: {
  profile: AiProviderProfile;
  apiKey: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): AiProviderAdapter => {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`
  };

  if (profile.protocol === "openai-responses") {
    return {
      profile,
      supportsModelListing: true,
      generateStructured: async (input) => {
        const payload = await requestJson(fetchFn, joinUrl(profile.baseUrl, "responses"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: profile.model,
            store: false,
            instructions: input.systemPrompt,
            input: JSON.stringify(input.input),
            text: { format: { type: "json_schema", name: input.schemaName, strict: true, schema: input.schema } }
          })
        }, timeoutMs);
        return parseStructuredJson(readResponsesText(payload), "OpenAI Responses");
      },
      listModels: async () => readModels(await requestJson(fetchFn, joinUrl(profile.baseUrl, "models"), { method: "GET", headers }, timeoutMs))
    };
  }

  if (profile.protocol === "openai-chat-completions") {
    return {
      profile,
      supportsModelListing: true,
      generateStructured: async (input) => {
        const payload = await requestJson(fetchFn, joinUrl(profile.baseUrl, "chat/completions"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: profile.model,
            temperature: 0,
            messages: [
              { role: "system", content: `${input.systemPrompt}\n\n严格遵循以下 JSON Schema：${JSON.stringify(input.schema)}` },
              { role: "user", content: JSON.stringify(input.input) }
            ],
            response_format: { type: "json_object" }
          })
        }, timeoutMs);
        return parseStructuredJson(readChatText(payload), "Chat Completions");
      },
      listModels: async () => readModels(await requestJson(fetchFn, joinUrl(profile.baseUrl, "models"), { method: "GET", headers }, timeoutMs))
    };
  }

  if (profile.protocol === "anthropic-messages") {
    return {
      profile,
      supportsModelListing: true,
      generateStructured: async (input) => {
        const payload = await requestJson(fetchFn, joinUrl(profile.baseUrl, "messages"), {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: profile.model,
            max_tokens: 2048,
            system: input.systemPrompt,
            messages: [{ role: "user", content: JSON.stringify(input.input) }],
            tools: [{ name: input.schemaName, description: "Return the extraction envelope.", input_schema: input.schema }],
            tool_choice: { type: "tool", name: input.schemaName }
          })
        }, timeoutMs);
        return readAnthropicToolInput(payload);
      },
      listModels: async () => readModels(await requestJson(fetchFn, joinUrl(profile.baseUrl, "models"), { method: "GET", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } }, timeoutMs))
    };
  }

  if (profile.protocol === "gemini-generate-content") {
    return {
      profile,
      supportsModelListing: true,
      generateStructured: async (input) => {
        const payload = await requestJson(fetchFn, joinUrl(profile.baseUrl, `models/${encodeURIComponent(profile.model)}:generateContent`), {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: `${input.systemPrompt}\n\n输入：${JSON.stringify(input.input)}\n\nJSON Schema：${JSON.stringify(input.schema)}` }] }],
            generationConfig: {
              temperature: 0,
              responseMimeType: "application/json",
              responseJsonSchema: input.schema
            }
          })
        }, timeoutMs);
        return parseStructuredJson(readGeminiText(payload), "Gemini");
      },
      listModels: async () => readModels(await requestJson(fetchFn, joinUrl(profile.baseUrl, "models"), { method: "GET", headers: { "x-goog-api-key": apiKey } }, timeoutMs))
    };
  }

  throw new AiProviderAdapterError("unsupported-capability", `不支持的 AI 协议：${profile.protocol}`);
};
