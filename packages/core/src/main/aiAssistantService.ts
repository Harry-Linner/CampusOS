import { createHash } from "node:crypto";
import type {
  AiAssistantConnectionTestInput,
  AiAssistantConnectionTestResult,
  AiAssistantExtractionIntent,
  AiAssistantExtractionResult,
  AiAssistantExtractedField,
  AiAssistantFieldOrigin,
  AiAssistantMessageSource,
  AiAssistantModelDiscoveryInput,
  AiAssistantModelDiscoveryResult,
  AiAssistantParseInput,
  AiAssistantProvider,
  AiAssistantProtocol,
  AiAssistantSettingsInput,
  AiAssistantSettingsRecord
} from "@campusos/shared";
import {
  AI_ASSISTANT_DEFAULT_BASE_URL,
  AI_ASSISTANT_DEFAULT_MODEL,
  AI_ASSISTANT_DEFAULT_PROVIDER,
  AI_ASSISTANT_DEFAULT_PROTOCOL,
  AI_ASSISTANT_EXTRACTION_SCHEMA,
  AI_ASSISTANT_PROMPT_VERSION,
  AI_ASSISTANT_SYSTEM_PROMPT
} from "@campusos/plugin-ai-assistant/prompt";
import {
  AiProviderAdapterError,
  createAiProviderAdapter,
  type AiProviderProfile
} from "./aiProviderAdapters";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_MESSAGE_BYTES = 50_000;

export interface StoredAiAssistantSettings {
  dataVersion: 1 | 2;
  encryptedApiKey: string;
  model: string;
  savedAt: string;
  provider?: AiAssistantProvider;
  protocol?: AiAssistantProtocol;
  baseUrl?: string;
}

export interface AiAssistantVault {
  encrypted: boolean;
  isEncryptionAvailable: () => boolean;
  encrypt: (value: string) => string;
  decrypt: (value: string) => string;
  read: () => Promise<unknown | null>;
  write: (payload: StoredAiAssistantSettings) => Promise<void>;
  clear: () => Promise<void>;
}

interface AiAssistantServiceDependencies {
  vault: AiAssistantVault;
  fetchFn?: typeof fetch;
  now?: () => Date;
}

export class AiAssistantServiceError extends Error {
  constructor(
    readonly code:
      | "invalid-input"
      | "not-configured"
      | "secure-storage-unavailable"
      | "storage-error"
      | "network-error"
      | "auth-error"
      | "quota-error"
      | "rate-limited"
      | "model-not-found"
      | "unsupported-capability"
      | "upstream-error"
      | "invalid-response",
    message: string,
    options: { cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AiAssistantServiceError";
  }
}

const PROVIDER_DEFAULTS: Record<AiAssistantProvider, { protocol: AiAssistantProtocol; baseUrl: string }> = {
  openai: { protocol: "openai-responses", baseUrl: AI_ASSISTANT_DEFAULT_BASE_URL },
  deepseek: { protocol: "openai-chat-completions", baseUrl: "https://api.deepseek.com/v1" },
  anthropic: { protocol: "anthropic-messages", baseUrl: "https://api.anthropic.com/v1" },
  gemini: { protocol: "gemini-generate-content", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  "openai-compatible": { protocol: "openai-chat-completions", baseUrl: "" }
};

const isProvider = (value: unknown): value is AiAssistantProvider =>
  value === "openai" || value === "deepseek" || value === "anthropic" || value === "gemini" || value === "openai-compatible";

const isProtocol = (value: unknown): value is AiAssistantProtocol =>
  value === "openai-responses" || value === "openai-chat-completions" || value === "anthropic-messages" || value === "gemini-generate-content";

const isValidModel = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) return false;
  return [...value].every((character) => {
    const code = character.charCodeAt(0);
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || character === "-" || character === "_" || character === "." || character === ":" || character === "/";
  });
};

const isValidBaseUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length === 0 || value.length > 500) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    return url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"));
  } catch {
    return false;
  }
};

export const isStoredSettings = (value: unknown): value is StoredAiAssistantSettings => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.dataVersion === 1 || candidate.dataVersion === 2) &&
    typeof candidate.encryptedApiKey === "string" && candidate.encryptedApiKey.length > 0 &&
    isValidModel(candidate.model) && typeof candidate.savedAt === "string" && Number.isFinite(Date.parse(candidate.savedAt)) &&
    (candidate.dataVersion === 1 || (isProvider(candidate.provider) && isProtocol(candidate.protocol) && isValidBaseUrl(candidate.baseUrl)));
};

export const migrateSettings = (value: StoredAiAssistantSettings): StoredAiAssistantSettings => {
  if (value.dataVersion === 2) return value;
  return {
    dataVersion: 2,
    encryptedApiKey: value.encryptedApiKey,
    model: value.model,
    savedAt: value.savedAt,
    provider: "openai",
    protocol: "openai-responses",
    baseUrl: AI_ASSISTANT_DEFAULT_BASE_URL
  };
};

const toSettingsRecord = (stored: StoredAiAssistantSettings | null, encrypted: boolean): AiAssistantSettingsRecord => {
  const migrated = stored ? migrateSettings(stored) : null;
  return {
    configured: migrated !== null,
    provider: migrated?.provider ?? AI_ASSISTANT_DEFAULT_PROVIDER,
    protocol: migrated?.protocol ?? AI_ASSISTANT_DEFAULT_PROTOCOL,
    baseUrl: migrated?.baseUrl ?? AI_ASSISTANT_DEFAULT_BASE_URL,
    model: migrated?.model ?? AI_ASSISTANT_DEFAULT_MODEL,
    savedAt: migrated?.savedAt ?? null,
    encrypted
  };
};

export const normalizeProfile = (input: Pick<AiAssistantSettingsInput, "provider" | "protocol" | "baseUrl" | "model">): AiProviderProfile => {
  if (!isProvider(input.provider) || !isProtocol(input.protocol) || !isValidModel(input.model.trim())) {
    throw new AiAssistantServiceError("invalid-input", "AI 服务商、协议或模型名称无效。");
  }
  const defaults = PROVIDER_DEFAULTS[input.provider];
  const protocolMatches = input.provider === "openai-compatible"
    ? input.protocol === "openai-responses" || input.protocol === "openai-chat-completions"
    : input.protocol === defaults.protocol;
  if (!protocolMatches) throw new AiAssistantServiceError("invalid-input", "所选服务商与协议不匹配。");
  const baseUrl = input.baseUrl.trim() || defaults.baseUrl;
  if (!isValidBaseUrl(baseUrl)) throw new AiAssistantServiceError("invalid-input", "Base URL 必须是 HTTPS 地址；本地服务只允许 localhost 或 127.0.0.1。");
  return { provider: input.provider, protocol: input.protocol, baseUrl: baseUrl.replace(/\/+$/, ""), model: input.model.trim() };
};

export const getInputApiKey = (value: unknown): string => {
  const apiKey = typeof value === "string" ? value.trim() : "";
  if (!apiKey || apiKey.length > 512 || apiKey.includes("\n") || apiKey.includes("\r")) throw new AiAssistantServiceError("invalid-input", "API Key 格式无效。");
  return apiKey;
};

const getSource = (value: AiAssistantMessageSource | undefined, now: string): AiAssistantMessageSource => {
  const source = value ?? { app: "manual" as const, sentAt: null };
  if (source.app !== "manual" && source.app !== "wechat" && source.app !== "dingtalk") throw new AiAssistantServiceError("invalid-input", "消息来源无效。");
  if (source.sentAt !== undefined && source.sentAt !== null && !Number.isFinite(Date.parse(source.sentAt))) throw new AiAssistantServiceError("invalid-input", "消息发送时间无效。");
  if (!Number.isFinite(Date.parse(now))) throw new AiAssistantServiceError("invalid-input", "当前时间无效。");
  return { ...source, sentAt: source.sentAt ?? null };
};

const allowedConfidence = (value: unknown): value is "high" | "medium" | "low" => value === "high" || value === "medium" || value === "low";
const allowedOrigin = (value: unknown): value is AiAssistantFieldOrigin => value === "explicit" || value === "inferred" || value === "default";
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

const groundField = <T>(raw: unknown, sourceText: string, label: string): AiAssistantExtractedField<T> => {
  if (typeof raw !== "object" || raw === null) throw new AiAssistantServiceError("invalid-response", `AI 返回的 ${label} 字段结构无效。`);
  const value = raw as Record<string, unknown>;
  if (!allowedConfidence(value.confidence) || !allowedOrigin(value.source) || typeof value.needsConfirmation !== "boolean") {
    throw new AiAssistantServiceError("invalid-response", `AI 返回的 ${label} 字段元数据无效。`);
  }
  const evidenceText = value.evidenceText;
  if (evidenceText !== null && typeof evidenceText !== "string") throw new AiAssistantServiceError("invalid-response", `${label} 的证据引用无效。`);
  const start = typeof evidenceText === "string" && evidenceText.length > 0 ? sourceText.indexOf(evidenceText) : -1;
  const evidence = start >= 0 && typeof evidenceText === "string"
    ? { start, end: start + evidenceText.length, text: evidenceText }
    : null;
  return {
    value: value.value as T,
    confidence: value.confidence,
    source: value.source,
    evidence,
    needsConfirmation: value.needsConfirmation || value.source !== "explicit" || (evidenceText !== null && evidence === null)
  };
};

const validateDateField = (field: AiAssistantExtractedField<string | null>, label: string): void => {
  if (field.value !== null && (typeof field.value !== "string" || !Number.isFinite(Date.parse(field.value)))) throw new AiAssistantServiceError("invalid-response", `${label} 不是有效时间。`);
};

const validateExtraction = (value: unknown, sourceText: string, source: AiAssistantMessageSource, courseNames: readonly string[]): AiAssistantExtractionResult => {
  if (typeof value !== "object" || value === null) throw new AiAssistantServiceError("invalid-response", "AI 返回的抽取结果不是对象。");
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.intents) || !isStringArray(candidate.unresolvedQuestions) || candidate.intents.length > 20) throw new AiAssistantServiceError("invalid-response", "AI 返回的抽取信封结构无效。");
  const intents: AiAssistantExtractionIntent[] = candidate.intents.map((raw, index) => {
    if (typeof raw !== "object" || raw === null) throw new AiAssistantServiceError("invalid-response", "AI 返回了无效事项。");
    const item = raw as Record<string, unknown>;
    if (item.intent !== "create" && item.intent !== "update" && item.intent !== "cancel") throw new AiAssistantServiceError("invalid-response", "AI 返回了不支持的事项动作。");
    if (item.kind !== "task" && item.kind !== "deadline" && item.kind !== "event" && item.kind !== "reminder") throw new AiAssistantServiceError("invalid-response", "AI 返回了不支持的事项类型。");
    if (!allowedConfidence(item.confidence) || !isStringArray(item.missingFields) || !isStringArray(item.warnings)) throw new AiAssistantServiceError("invalid-response", "AI 返回的事项元数据无效。");
    const title = groundField<string>(item.title, sourceText, "标题");
    const description = groundField<string>(item.description, sourceText, "描述");
    const deadlineAt = groundField<string | null>(item.deadlineAt, sourceText, "截止时间");
    const startAt = groundField<string | null>(item.startAt, sourceText, "开始时间");
    const endAt = groundField<string | null>(item.endAt, sourceText, "结束时间");
    const durationMinutes = groundField<number | null>(item.durationMinutes, sourceText, "预计耗时");
    const location = groundField<string | null>(item.location, sourceText, "地点");
    const courseName = groundField<string | null>(item.courseName, sourceText, "课程");
    validateDateField(deadlineAt, "截止时间");
    validateDateField(startAt, "开始时间");
    validateDateField(endAt, "结束时间");
    if (durationMinutes.value !== null && (!Number.isInteger(durationMinutes.value) || durationMinutes.value < 1 || durationMinutes.value > 10_080)) throw new AiAssistantServiceError("invalid-response", "预计耗时无效。");
    if (typeof title.value !== "string" || title.value.trim().length > 500) throw new AiAssistantServiceError("invalid-response", "标题无效。");
    if (typeof description.value !== "string" || typeof location.value !== "string" && location.value !== null || typeof courseName.value !== "string" && courseName.value !== null) throw new AiAssistantServiceError("invalid-response", "事项文本字段无效。");
    if (courseName.value !== null && !courseNames.includes(courseName.value)) throw new AiAssistantServiceError("invalid-response", "AI 返回的课程不在当前工作区课程列表中。");
    const warnings = [...item.warnings];
    const fields = [title, description, deadlineAt, startAt, endAt, durationMinutes, location, courseName];
    if (fields.some((field) => field.needsConfirmation && field.evidence === null)) warnings.push("部分字段无法在原文中定位，请确认后再写入日程。");
    const fingerprint = createHash("sha256").update(`${sourceText}\u0000${index}\u0000${item.intent}\u0000${title.value}\u0000${deadlineAt.value ?? ""}\u0000${startAt.value ?? ""}`).digest("hex");
    return {
      id: `intent-${index + 1}`,
      intent: item.intent,
      kind: item.kind,
      title: { ...title, value: title.value.trim() },
      description: { ...description, value: description.value.trim() },
      deadlineAt,
      startAt,
      endAt,
      durationMinutes,
      location: { ...location, value: location.value?.trim() ?? null },
      courseName,
      confidence: item.confidence,
      missingFields: item.missingFields,
      warnings,
      fingerprint
    };
  });
  return { sourceText, source, schemaVersion: 2, promptVersion: AI_ASSISTANT_PROMPT_VERSION, intents, unresolvedQuestions: candidate.unresolvedQuestions };
};

const mapProviderError = (cause: unknown): AiAssistantServiceError => {
  if (cause instanceof AiAssistantServiceError) return cause;
  if (cause instanceof AiProviderAdapterError) return new AiAssistantServiceError(cause.code, cause.message, { cause });
  return new AiAssistantServiceError("upstream-error", "AI 服务返回了无法识别的结果。", { cause });
};

export const createAiAssistantService = ({ vault, fetchFn = fetch, now = () => new Date() }: AiAssistantServiceDependencies) => {
  const loadStored = async (): Promise<StoredAiAssistantSettings | null> => {
    const value = await vault.read();
    if (value === null) return null;
    if (!isStoredSettings(value)) throw new AiAssistantServiceError("storage-error", "本地 AI 助手配置格式无效，请清除后重新配置。");
    return migrateSettings(value);
  };

  const profileFromStored = (stored: StoredAiAssistantSettings): AiProviderProfile => normalizeProfile({
    provider: stored.provider!,
    protocol: stored.protocol!,
    baseUrl: stored.baseUrl!,
    model: stored.model
  });

  const hasSameCredentialScope = (left: AiProviderProfile, right: AiProviderProfile): boolean =>
    left.provider === right.provider && left.protocol === right.protocol && left.baseUrl === right.baseUrl;

  const readApiKey = async (direct: string, requestedProfile?: AiProviderProfile): Promise<string> => {
    const trimmed = direct.trim();
    if (trimmed) return getInputApiKey(trimmed);
    const stored = await loadStored();
    if (!stored) throw new AiAssistantServiceError("not-configured", "请先配置 API Key。");
    if (requestedProfile && !hasSameCredentialScope(profileFromStored(stored), requestedProfile)) {
      throw new AiAssistantServiceError("invalid-input", "服务商、协议或 API 地址已改变，请重新输入对应的 API Key。");
    }
    try {
      return getInputApiKey(vault.decrypt(stored.encryptedApiKey));
    } catch (cause) {
      throw new AiAssistantServiceError("storage-error", "无法解密已保存的 API Key，请清除后重新配置。", { cause });
    }
  };

  const createAdapter = (profile: AiProviderProfile, apiKey: string) => createAiProviderAdapter({ profile, apiKey, fetchFn, timeoutMs: REQUEST_TIMEOUT_MS });

  const runStructured = async (profile: AiProviderProfile, apiKey: string, input: unknown): Promise<unknown> => {
    try {
      return await createAdapter(profile, apiKey).generateStructured({
        systemPrompt: AI_ASSISTANT_SYSTEM_PROMPT,
        input,
        schemaName: "campus_extraction_v2",
        schema: AI_ASSISTANT_EXTRACTION_SCHEMA as unknown as Record<string, unknown>
      });
    } catch (cause) {
      throw mapProviderError(cause);
    }
  };

  return {
    loadSettings: async (): Promise<AiAssistantSettingsRecord> => toSettingsRecord(await loadStored(), vault.encrypted),

    saveSettings: async (input: AiAssistantSettingsInput): Promise<AiAssistantSettingsRecord> => {
      if (!vault.isEncryptionAvailable()) throw new AiAssistantServiceError("secure-storage-unavailable", "当前设备无法使用系统安全存储，API Key 不会被保存。");
      const profile = normalizeProfile(input);
      const existing = await loadStored();
      const apiKey = input.apiKey.trim();
      if (!apiKey && !existing) throw new AiAssistantServiceError("invalid-input", "请填写 API Key。");
      if (!apiKey && existing && !hasSameCredentialScope(profileFromStored(existing), profile)) {
        throw new AiAssistantServiceError("invalid-input", "服务商、协议或 API 地址已改变，请重新输入对应的 API Key。");
      }
      const payload: StoredAiAssistantSettings = {
        dataVersion: 2,
        encryptedApiKey: apiKey ? vault.encrypt(getInputApiKey(apiKey)) : existing!.encryptedApiKey,
        provider: profile.provider,
        protocol: profile.protocol,
        baseUrl: profile.baseUrl,
        model: profile.model,
        savedAt: now().toISOString()
      };
      try {
        await vault.write(payload);
      } catch (cause) {
        throw new AiAssistantServiceError("storage-error", "AI 助手配置未能写入系统安全存储。", { cause });
      }
      return toSettingsRecord(payload, vault.encrypted);
    },

    clearSettings: async (): Promise<AiAssistantSettingsRecord> => {
      await vault.clear();
      return toSettingsRecord(null, vault.encrypted);
    },

    testConnection: async (input: AiAssistantConnectionTestInput): Promise<AiAssistantConnectionTestResult> => {
      const profile = normalizeProfile(input);
      const apiKey = await readApiKey(input.apiKey, profile);
      const startedAt = Date.now();
      const fixtureText = "CampusOS structured capability check. Return an empty intents array.";
      const checkedAt = now().toISOString();
      const raw = await runStructured(profile, apiKey, {
        message: fixtureText,
        now: checkedAt,
        referenceTime: checkedAt,
        referenceTimeSource: "parse-time",
        timezone: "Asia/Shanghai",
        courseNames: []
      });
      validateExtraction(raw, fixtureText, { app: "manual", sentAt: null }, []);
      const adapter = createAdapter(profile, apiKey);
      return { ok: true, provider: profile.provider, protocol: profile.protocol, model: profile.model, checkedAt, latencyMs: Math.max(0, Date.now() - startedAt), structuredOutput: true, modelListingSupported: adapter.supportsModelListing };
    },

    discoverModels: async (input: AiAssistantModelDiscoveryInput): Promise<AiAssistantModelDiscoveryResult> => {
      const profile = normalizeProfile({ ...input, model: "model-discovery" });
      const apiKey = await readApiKey(input.apiKey, profile);
      const startedAt = Date.now();
      try {
        const models = await createAdapter(profile, apiKey).listModels();
        return { provider: profile.provider, models, checkedAt: now().toISOString(), latencyMs: Math.max(0, Date.now() - startedAt) };
      } catch (cause) {
        throw mapProviderError(cause);
      }
    },

    parseMessage: async (input: AiAssistantParseInput): Promise<AiAssistantExtractionResult> => {
      const text = typeof input?.text === "string" ? input.text.trim() : "";
      if (!text || Buffer.byteLength(text, "utf8") > MAX_MESSAGE_BYTES) throw new AiAssistantServiceError("invalid-input", "消息内容无效或超过 50 KB 限制。");
      const nowValue = typeof input?.now === "string" ? input.now : "";
      const source = getSource(input?.source, nowValue);
      const courseNames = Array.isArray(input?.courseNames)
        ? [...new Set(input.courseNames.filter((name): name is string => typeof name === "string" && name.trim().length > 0).map((name) => name.trim()))].slice(0, 300)
        : [];
      const stored = await loadStored();
      if (!stored) throw new AiAssistantServiceError("not-configured", "请先在 AI 助手配置中保存 API Key。");
      const profile = profileFromStored(stored);
      const apiKey = await readApiKey("", profile);
      const referenceTime = source.sentAt ?? nowValue;
      const raw = await runStructured(profile, apiKey, { message: text, now: nowValue, referenceTime, referenceTimeSource: source.sentAt ? "source-message" : "parse-time", timezone: "Asia/Shanghai", courseNames });
      try {
        return validateExtraction(raw, text, source, courseNames);
      } catch (cause) {
        throw mapProviderError(cause);
      }
    }
  };
};
