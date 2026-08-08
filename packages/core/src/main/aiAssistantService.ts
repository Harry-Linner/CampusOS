import type {
  AiAssistantDraft,
  AiAssistantConnectionTestInput,
  AiAssistantConnectionTestResult,
  AiAssistantParseInput,
  AiAssistantSettingsInput,
  AiAssistantSettingsRecord
} from "@campusos/shared";
import {
  AI_ASSISTANT_DEFAULT_MODEL,
  AI_ASSISTANT_SYSTEM_PROMPT,
  AI_ASSISTANT_TASK_SCHEMA
} from "@campusos/plugin-ai-assistant/prompt";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const REQUEST_TIMEOUT_MS = 30_000;

export interface StoredAiAssistantSettings {
  dataVersion: 1;
  encryptedApiKey: string;
  model: string;
  savedAt: string;
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
    readonly code: "invalid-input" | "not-configured" | "secure-storage-unavailable" | "storage-error" | "network-error" | "upstream-error" | "invalid-response",
    message: string,
    options: { cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AiAssistantServiceError";
  }
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isValidModel = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) return false;
  return [...value].every((character) => {
    const code = character.charCodeAt(0);
    return (
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      character === "-" ||
      character === "_" ||
      character === "." ||
      character === ":"
    );
  });
};

const isStoredSettings = (value: unknown): value is StoredAiAssistantSettings =>
  typeof value === "object" &&
  value !== null &&
  "dataVersion" in value &&
  value.dataVersion === 1 &&
  "encryptedApiKey" in value &&
  typeof value.encryptedApiKey === "string" &&
  value.encryptedApiKey.length > 0 &&
  "model" in value &&
  isValidModel(value.model) &&
  "savedAt" in value &&
  typeof value.savedAt === "string" &&
  Number.isFinite(Date.parse(value.savedAt));

const toSettingsRecord = (
  stored: StoredAiAssistantSettings | null,
  encrypted: boolean
): AiAssistantSettingsRecord => ({
  configured: stored !== null,
  model: stored?.model ?? AI_ASSISTANT_DEFAULT_MODEL,
  savedAt: stored?.savedAt ?? null,
  encrypted
});

const readOutputText = (response: unknown): string => {
  if (typeof response !== "object" || response === null || !("output" in response) || !Array.isArray(response.output)) {
    throw new AiAssistantServiceError("invalid-response", "AI 服务返回了无法识别的响应结构。");
  }
  for (const item of response.output) {
    if (typeof item !== "object" || item === null || !("content" in item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (typeof content !== "object" || content === null) continue;
      if ("type" in content && content.type === "refusal") {
        throw new AiAssistantServiceError("invalid-response", "AI 服务拒绝解析这条消息。");
      }
      if (
        "type" in content &&
        content.type === "output_text" &&
        "text" in content &&
        typeof content.text === "string"
      ) return content.text;
    }
  }
  throw new AiAssistantServiceError("invalid-response", "AI 服务没有返回任务草稿。");
};

const validateDraft = (
  value: unknown,
  sourceText: string,
  courseNames: readonly string[]
): AiAssistantDraft => {
  if (typeof value !== "object" || value === null) {
    throw new AiAssistantServiceError("invalid-response", "AI 返回的任务草稿不是对象。");
  }
  const draft = value as Record<string, unknown>;
  const requiredStrings = ["title", "description", "location", "courseName", "confidence"];
  if (!requiredStrings.every((field) => typeof draft[field] === "string")) {
    throw new AiAssistantServiceError("invalid-response", "AI 返回的任务草稿缺少文本字段。");
  }
  if (draft.type !== "deadline" && draft.type !== "fixed") {
    throw new AiAssistantServiceError("invalid-response", "AI 返回了不支持的任务类型。");
  }
  if (draft.confidence !== "high" && draft.confidence !== "medium" && draft.confidence !== "low") {
    throw new AiAssistantServiceError("invalid-response", "AI 返回了不支持的置信度。");
  }
  if (
    !Number.isInteger(draft.timeNeededMinutes) ||
    (draft.timeNeededMinutes as number) < 1 ||
    (draft.timeNeededMinutes as number) > 10_080
  ) {
    throw new AiAssistantServiceError("invalid-response", "AI 返回了无效的预计耗时。");
  }
  if (!isStringArray(draft.missingFields) || !isStringArray(draft.warnings) || !isStringArray(draft.evidence)) {
    throw new AiAssistantServiceError("invalid-response", "AI 返回的任务草稿列表字段无效。");
  }
  const startAt = draft.startAt;
  const endAt = draft.endAt;
  if (
    (startAt !== null && (typeof startAt !== "string" || !Number.isFinite(Date.parse(startAt)))) ||
    (endAt !== null && (typeof endAt !== "string" || !Number.isFinite(Date.parse(endAt)))) ||
    (startAt === null) !== (endAt === null)
  ) {
    throw new AiAssistantServiceError("invalid-response", "AI 返回了无效或不完整的任务时间。");
  }
  if (typeof startAt === "string" && typeof endAt === "string" && Date.parse(endAt) <= Date.parse(startAt)) {
    throw new AiAssistantServiceError("invalid-response", "AI 返回的结束时间没有晚于开始时间。");
  }
  const courseName = draft.courseName as string;
  if (courseName !== "" && !courseNames.includes(courseName)) {
    throw new AiAssistantServiceError("invalid-response", "AI 返回的课程不在当前工作区课程列表中。");
  }
  const title = (draft.title as string).trim();
  if (!title || title.length > 500) {
    throw new AiAssistantServiceError("invalid-response", "AI 返回的任务标题无效。");
  }
  return {
    sourceText,
    title,
    description: (draft.description as string).trim(),
    type: draft.type,
    startAt: startAt as string | null,
    endAt: endAt as string | null,
    timeNeededMinutes: draft.timeNeededMinutes as number,
    location: (draft.location as string).trim(),
    courseName,
    confidence: draft.confidence,
    missingFields: draft.missingFields,
    warnings: draft.warnings,
    evidence: draft.evidence
  };
};

export const createAiAssistantService = ({
  vault,
  fetchFn = fetch,
  now = () => new Date()
}: AiAssistantServiceDependencies) => {
  const loadStored = async (): Promise<StoredAiAssistantSettings | null> => {
    const value = await vault.read();
    if (value === null) return null;
    if (!isStoredSettings(value)) {
      throw new AiAssistantServiceError("storage-error", "本地 AI 助手配置格式无效，请清除后重新配置。");
    }
    return value;
  };

  return {
    loadSettings: async (): Promise<AiAssistantSettingsRecord> =>
      toSettingsRecord(await loadStored(), vault.encrypted),

    saveSettings: async (input: AiAssistantSettingsInput): Promise<AiAssistantSettingsRecord> => {
      if (!vault.isEncryptionAvailable()) {
        throw new AiAssistantServiceError("secure-storage-unavailable", "当前设备无法使用系统安全存储，API Key 不会被保存。");
      }
      if (typeof input !== "object" || input === null || !isValidModel(input.model.trim())) {
        throw new AiAssistantServiceError("invalid-input", "模型名称格式无效。");
      }
      const existing = await loadStored();
      const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
      if (!apiKey && !existing) {
        throw new AiAssistantServiceError("invalid-input", "请填写 API Key。");
      }
      if (apiKey.length > 512 || apiKey.includes("\n") || apiKey.includes("\r")) {
        throw new AiAssistantServiceError("invalid-input", "API Key 格式无效。");
      }
      const savedAt = now().toISOString();
      const payload: StoredAiAssistantSettings = {
        dataVersion: 1,
        encryptedApiKey: apiKey ? vault.encrypt(apiKey) : existing!.encryptedApiKey,
        model: input.model.trim(),
        savedAt
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

    testConnection: async (
      input: AiAssistantConnectionTestInput
    ): Promise<AiAssistantConnectionTestResult> => {
      if (typeof input !== "object" || input === null || !isValidModel(input.model.trim())) {
        throw new AiAssistantServiceError("invalid-input", "模型名称格式无效。");
      }
      if (!vault.isEncryptionAvailable() && !input.apiKey.trim()) {
        throw new AiAssistantServiceError("secure-storage-unavailable", "当前设备无法读取系统安全存储，请直接填写 API Key 后重试。");
      }
      const directApiKey = input.apiKey.trim();
      const stored = directApiKey ? null : await loadStored();
      const apiKey = directApiKey || (stored ? vault.decrypt(stored.encryptedApiKey) : "");
      if (!apiKey) {
        throw new AiAssistantServiceError("not-configured", "请先填写 API Key。");
      }
      if (apiKey.length > 512 || apiKey.includes("\n") || apiKey.includes("\r")) {
        throw new AiAssistantServiceError("invalid-input", "API Key 格式无效。");
      }
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetchFn(OPENAI_RESPONSES_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: input.model.trim(),
            store: false,
            input: "Reply with OK.",
            max_output_tokens: 4
          }),
          signal: controller.signal
        });
      } catch (cause) {
        throw new AiAssistantServiceError("network-error", "无法连接 AI 服务，请检查网络后重试。", { cause });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        throw new AiAssistantServiceError("upstream-error", `AI 服务连接失败（HTTP ${response.status}）。`);
      }
      return {
        ok: true,
        model: input.model.trim(),
        checkedAt: now().toISOString(),
        latencyMs: Math.max(0, Date.now() - startedAt)
      };
    },

    parseMessage: async (input: AiAssistantParseInput): Promise<AiAssistantDraft> => {
      const text = typeof input?.text === "string" ? input.text.trim() : "";
      const parsedNow = typeof input?.now === "string" ? Date.parse(input.now) : Number.NaN;
      const courseNames = Array.isArray(input?.courseNames)
        ? [...new Set(input.courseNames.filter((name): name is string => typeof name === "string" && name.trim().length > 0).map((name) => name.trim()))].slice(0, 300)
        : [];
      if (!text || Buffer.byteLength(text, "utf8") > 50_000 || !Number.isFinite(parsedNow)) {
        throw new AiAssistantServiceError("invalid-input", "消息内容或当前时间无效。");
      }
      const stored = await loadStored();
      if (!stored) {
        throw new AiAssistantServiceError("not-configured", "请先在 AI 助手配置中保存 API Key。");
      }
      const apiKey = vault.decrypt(stored.encryptedApiKey);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetchFn(OPENAI_RESPONSES_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: stored.model,
            store: false,
            instructions: AI_ASSISTANT_SYSTEM_PROMPT,
            input: JSON.stringify({
              message: text,
              now: new Date(parsedNow).toISOString(),
              timezone: "Asia/Shanghai",
              courseNames
            }),
            text: {
              format: {
                type: "json_schema",
                name: "campus_task_draft",
                strict: true,
                schema: AI_ASSISTANT_TASK_SCHEMA
              }
            }
          }),
          signal: controller.signal
        });
      } catch (cause) {
        throw new AiAssistantServiceError("network-error", "无法连接 AI 服务，请检查网络后重试。", { cause });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        throw new AiAssistantServiceError("upstream-error", `AI 服务请求失败（HTTP ${response.status}）。`);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (cause) {
        throw new AiAssistantServiceError("invalid-response", "AI 服务返回了无效 JSON。", { cause });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(readOutputText(payload));
      } catch (cause) {
        if (cause instanceof AiAssistantServiceError) throw cause;
        throw new AiAssistantServiceError("invalid-response", "AI 返回的任务草稿不是有效 JSON。", { cause });
      }
      return validateDraft(parsed, text, courseNames);
    }
  };
};
