/**
 * Read-only access to the AI Assistant runtime connection (provider profile +
 * decrypted API key) for Core services that reuse the same user-configured
 * provider without re-entering credentials.
 *
 * The vault file is shared with the AI Assistant module; the brief service
 * treats a missing or invalid configuration as "not configured" and the UI
 * points the user back to the AI Assistant settings.
 */
import type { AiAssistantVault } from "./aiAssistantService";
import {
  getInputApiKey,
  isStoredSettings,
  migrateSettings,
  normalizeProfile
} from "./aiAssistantService";
import type { AiProviderProfile } from "./aiProviderAdapters";

export type AiRuntimeConnection =
  | { configured: true; profile: AiProviderProfile; apiKey: string }
  | { configured: false };

export interface AiRuntime {
  load: () => Promise<AiRuntimeConnection>;
}

export const createAiRuntime = (vault: AiAssistantVault): AiRuntime => ({
  load: async () => {
    const value = await vault.read();
    if (value === null || !isStoredSettings(value)) {
      return { configured: false };
    }
    const stored = migrateSettings(value);
    const profile = normalizeProfile({
      provider: stored.provider!,
      protocol: stored.protocol!,
      baseUrl: stored.baseUrl!,
      model: stored.model
    });
    const apiKey = getInputApiKey(vault.decrypt(stored.encryptedApiKey));
    return { configured: true, profile, apiKey };
  }
});
