/**
 * Campus-feed AI connection helpers (Core, main).
 *
 * Split out of campusFeedService.ts: the
 * stored-connection shape, its validation, the projection to the renderer-safe
 * connection and the provider-error mapping are independent of the scheduler.
 */
import type { CampusFeedAiConnection, CampusFeedAiInput } from "@campusos/shared";
import { AiProviderAdapterError } from "./aiProviderAdapters";
import { getInputApiKey, normalizeProfile } from "./aiAssistantService";

/** AI connection as persisted in the campus-feed settings (key never plaintext). */
export interface StoredCampusFeedAi {
  provider: CampusFeedAiConnection["provider"];
  protocol: CampusFeedAiConnection["protocol"];
  baseUrl: string;
  model: string;
  encryptedApiKey: string | null;
}

export const isStoredCampusFeedAi = (value: unknown): value is StoredCampusFeedAi => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!(
    (candidate.provider === "openai" ||
      candidate.provider === "deepseek" ||
      candidate.provider === "anthropic" ||
      candidate.provider === "gemini" ||
      candidate.provider === "openai-compatible") &&
    (candidate.protocol === "openai-responses" ||
      candidate.protocol === "openai-chat-completions" ||
      candidate.protocol === "anthropic-messages" ||
      candidate.protocol === "gemini-generate-content") &&
    typeof candidate.baseUrl === "string" &&
    typeof candidate.model === "string" &&
    (candidate.encryptedApiKey === null ||
      typeof candidate.encryptedApiKey === "string")
  )) return false;
  try {
    normalizeProfile(candidate as unknown as CampusFeedAiInput);
    return true;
  } catch {
    return false;
  }
};

export const storedAiToConnection = (stored: StoredCampusFeedAi | null): CampusFeedAiConnection | null =>
  stored
    ? {
        provider: stored.provider,
        protocol: stored.protocol,
        baseUrl: stored.baseUrl,
        model: stored.model,
        apiKeyConfigured: Boolean(stored.encryptedApiKey)
      }
    : null;

export const normalizeCampusFeedAiInput = (value: unknown): CampusFeedAiInput => {
  if (typeof value !== "object" || value === null) throw new Error("AI 连接设置格式无效。");
  const input = value as CampusFeedAiInput;
  const candidate = value as Record<string, unknown>;
  if ((candidate.apiKey !== undefined && typeof candidate.apiKey !== "string") ||
    (candidate.clearApiKey !== undefined && typeof candidate.clearApiKey !== "boolean")) {
    throw new Error("AI 连接设置格式无效。");
  }
  const profile = normalizeProfile(input);
  const apiKey = typeof input.apiKey === "string" && input.apiKey.trim()
    ? getInputApiKey(input.apiKey)
    : undefined;
  return {
    ...profile,
    ...(apiKey ? { apiKey } : {}),
    ...(input.clearApiKey === true ? { clearApiKey: true } : {})
  };
};

export const mapAiError = (cause: unknown): string => {
  if (cause instanceof AiProviderAdapterError) {
    const codeLabel: Record<string, string> = {
      "network-error": "无法连接 AI 服务，请检查网络。",
      "auth-error": "AI 服务认证失败，请检查 API Key。",
      "quota-error": "AI 服务配额不足。",
      "rate-limited": "AI 服务请求过于频繁，请稍后重试。",
      "model-not-found": "AI 模型不可用，请检查模型配置。",
      "unsupported-capability": "当前 AI 服务不支持结构化输出。",
      "invalid-response": "AI 返回结果无效。",
      "upstream-error": "AI 服务暂时不可用。"
    };
    return codeLabel[cause.code] ?? "AI 服务返回错误。";
  }
  return cause instanceof Error && cause.message
    ? cause.message
    : "AI 处理失败。";
};
