import type {
  AiAssistantDraft,
  AiAssistantParseInput,
  AiAssistantSettingsInput,
  AiAssistantSettingsRecord
} from "@campusos/shared";

export interface AiAssistantBridge {
  loadSettings: () => Promise<AiAssistantSettingsRecord>;
  saveSettings: (input: AiAssistantSettingsInput) => Promise<AiAssistantSettingsRecord>;
  clearSettings: () => Promise<AiAssistantSettingsRecord>;
  parseMessage: (input: AiAssistantParseInput) => Promise<AiAssistantDraft>;
}
