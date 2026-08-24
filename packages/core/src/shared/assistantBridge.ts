import type {
  AiAssistantConnectionTestInput,
  AiAssistantConnectionTestResult,
  AiAssistantModelDiscoveryInput,
  AiAssistantModelDiscoveryResult,
  AiAssistantParseInput,
  AiAssistantParseResult,
  AiAssistantSettingsInput,
  AiAssistantSettingsRecord
} from "@campusos/shared";

export interface AiAssistantBridge {
  loadSettings: () => Promise<AiAssistantSettingsRecord>;
  saveSettings: (input: AiAssistantSettingsInput) => Promise<AiAssistantSettingsRecord>;
  clearSettings: () => Promise<AiAssistantSettingsRecord>;
  testConnection: (input: AiAssistantConnectionTestInput) => Promise<AiAssistantConnectionTestResult>;
  parseMessage: (input: AiAssistantParseInput) => Promise<AiAssistantParseResult>;
  discoverModels: (input: AiAssistantModelDiscoveryInput) => Promise<AiAssistantModelDiscoveryResult>;
}
