import type {
  AiAssistantExtractionResult,
  AiAssistantConnectionTestInput,
  AiAssistantConnectionTestResult,
  AiAssistantModelDiscoveryInput,
  AiAssistantModelDiscoveryResult,
  AiAssistantParseInput,
  AiAssistantSettingsInput,
  AiAssistantSettingsRecord
} from "@campusos/shared";

export interface AiAssistantBridge {
  loadSettings: () => Promise<AiAssistantSettingsRecord>;
  saveSettings: (input: AiAssistantSettingsInput) => Promise<AiAssistantSettingsRecord>;
  clearSettings: () => Promise<AiAssistantSettingsRecord>;
  testConnection: (input: AiAssistantConnectionTestInput) => Promise<AiAssistantConnectionTestResult>;
  parseMessage: (input: AiAssistantParseInput) => Promise<AiAssistantExtractionResult>;
  discoverModels: (input: AiAssistantModelDiscoveryInput) => Promise<AiAssistantModelDiscoveryResult>;
}
