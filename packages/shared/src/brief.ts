/**
 * Daily Brief (早报) shared contracts.
 *
 * Phase 0: external-info digest only. No campus data, no Obsidian profile
 * extraction, no discovery/breakout, no archive (those are later phases).
 */

import type { AiAssistantProtocol, AiAssistantProvider } from "./pluginCapabilities";

export interface BriefInterest {
  name: string;
  weight: number;
  note?: string | null;
}

export type BriefAiProvider = AiAssistantProvider;
export type BriefAiProtocol = AiAssistantProtocol;

/** Brief-specific AI connection, independent of the AI Assistant settings. */
export interface BriefAiConnection {
  provider: BriefAiProvider;
  protocol: BriefAiProtocol;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
}

/** User-editable AI connection; `apiKey` is transient over IPC only. */
export interface BriefAiInput {
  provider: BriefAiProvider;
  protocol: BriefAiProtocol;
  baseUrl: string;
  model: string;
  /** Present when the user re-enters a key; omitting keeps the stored one. */
  apiKey?: string;
  /** True clears the stored key. */
  clearApiKey?: boolean;
}

export const BRIEF_AI_PROVIDER_DEFAULTS: Record<
  BriefAiProvider,
  { protocol: BriefAiProtocol; baseUrl: string }
> = {
  openai: { protocol: "openai-responses", baseUrl: "https://api.openai.com/v1" },
  deepseek: { protocol: "openai-chat-completions", baseUrl: "https://api.deepseek.com/v1" },
  anthropic: { protocol: "anthropic-messages", baseUrl: "https://api.anthropic.com/v1" },
  gemini: { protocol: "gemini-generate-content", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  "openai-compatible": { protocol: "openai-chat-completions", baseUrl: "" }
};

export const BRIEF_AI_PROVIDER_LABELS: Record<BriefAiProvider, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  anthropic: "Anthropic",
  gemini: "Gemini",
  "openai-compatible": "OpenAI 兼容服务"
};

export interface BriefProfile {
  interests: BriefInterest[];
  sourceEnabled: Record<string, boolean>;
  ai?: BriefAiConnection | null;
  savedAt: string | null;
}

/** User-editable part of a profile; `savedAt` is always server-assigned. */
export type BriefProfileInput = Omit<BriefProfile, "savedAt" | "ai"> & {
  ai?: BriefAiInput | null;
};

export interface BriefCachedItem {
  fingerprint: string;
  sourceId: string;
  url: string;
  title: string;
  summary: string | null;
  publishedAt: string | null;
  fetchedAt: string;
}

export interface BriefItem {
  fingerprint: string;
  sourceId: string;
  sourceLabel: string;
  titleZh: string;
  summary: string;
  originalTitle: string;
  url: string;
  relevance?: string | null;
}

export interface BriefSection {
  interest: string;
  items: BriefItem[];
}

export interface BriefSnapshot {
  /** Asia/Shanghai natural day, yyyy-MM-dd. */
  date: string;
  generatedAt: string;
  sections: BriefSection[];
  degradedSources: string[];
  note?: string | null;
}

export type BriefStatus = "idle" | "fetching" | "generating" | "ready" | "error";

export interface BriefState {
  status: BriefStatus;
  snapshot: BriefSnapshot | null;
  error?: string | null;
}

export interface BriefBridge {
  getState: () => Promise<BriefState>;
  refresh: () => Promise<BriefState>;
  openExternal: (fingerprint: string) => Promise<void>;
  loadSettings: () => Promise<BriefProfile>;
  saveSettings: (input: BriefProfileInput) => Promise<BriefProfile>;
  subscribe: (listener: (state: BriefState) => void) => () => void;
}

export const BRIEF_MAX_INTERESTS = 20;
export const BRIEF_MIN_WEIGHT = 1;
export const BRIEF_MAX_WEIGHT = 10;
export const BRIEF_MAX_INTEREST_NAME = 50;
export const BRIEF_MAX_SECTIONS = 12;
export const BRIEF_MAX_ITEMS_PER_SECTION = 3;
export const BRIEF_MAX_TITLE_ZH = 120;
export const BRIEF_MAX_SUMMARY = 120;
export const BRIEF_MAX_ORIGINAL_TITLE = 200;
export const BRIEF_MAX_NOTE = 500;
export const BRIEF_MAX_RAW_TITLE = 300;
export const BRIEF_MAX_RAW_SUMMARY = 500;

export const isBriefProfile = (value: unknown): value is BriefProfile => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate.interests) ||
    candidate.interests.length > BRIEF_MAX_INTERESTS
  ) {
    return false;
  }
  if (
    typeof candidate.sourceEnabled !== "object" ||
    candidate.sourceEnabled === null ||
    Array.isArray(candidate.sourceEnabled)
  ) {
    return false;
  }
  const savedAt = candidate.savedAt;
  if (
    savedAt !== undefined &&
    savedAt !== null &&
    (typeof savedAt !== "string" || !Number.isFinite(Date.parse(savedAt)))
  ) {
    return false;
  }
  return candidate.interests.every((interest) => {
    if (typeof interest !== "object" || interest === null) return false;
    const item = interest as Record<string, unknown>;
    if (
      typeof item.name !== "string" ||
      item.name.trim().length === 0 ||
      item.name.trim().length > BRIEF_MAX_INTEREST_NAME
    ) {
      return false;
    }
    if (
      !Number.isInteger(item.weight) ||
      (item.weight as number) < BRIEF_MIN_WEIGHT ||
      (item.weight as number) > BRIEF_MAX_WEIGHT
    ) {
      return false;
    }
    const note = item.note;
    return (
      note === undefined ||
      note === null ||
      (typeof note === "string" && note.length <= 200)
    );
  });
};
