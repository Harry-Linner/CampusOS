import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, safeStorage } from "electron";
import type {
  AiAssistantConnectionTestInput,
  AiAssistantModelDiscoveryInput,
  AiAssistantParseInput,
  AiAssistantSettingsInput
} from "@campusos/shared";
import {
  createAiAssistantService,
  type AiAssistantVault,
  type StoredAiAssistantSettings
} from "./aiAssistantService";
import type { AcademicQueryDataReader } from "./academicQuery";
import { registerTrustedIpcHandler } from "./trustedIpc";

const SETTINGS_FILE = "ai-assistant.json";

const isFileNotFound = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

export const createAiAssistantVault = (): AiAssistantVault => {
  const storagePath = join(app.getPath("userData"), "secure", SETTINGS_FILE);
  return {
    encrypted: true,
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
    decrypt: (value) => safeStorage.decryptString(Buffer.from(value, "base64")),
    read: async () => {
      try {
        return JSON.parse(await readFile(storagePath, "utf8")) as unknown;
      } catch (error) {
        if (isFileNotFound(error)) return null;
        throw error;
      }
    },
    write: async (payload: StoredAiAssistantSettings) => {
      await mkdir(dirname(storagePath), { recursive: true, mode: 0o700 });
      const temporaryPath = `${storagePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, JSON.stringify(payload, null, 2), {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600
        });
        await rename(temporaryPath, storagePath);
      } catch (error) {
        try {
          await unlink(temporaryPath);
        } catch (cleanupError) {
          if (!isFileNotFound(cleanupError)) {
            throw new AggregateError([error, cleanupError], "AI settings write and cleanup both failed.");
          }
        }
        throw error;
      }
    },
    clear: async () => {
      try {
        await unlink(storagePath);
      } catch (error) {
        if (!isFileNotFound(error)) throw error;
      }
    }
  };
};

const createService = (academicData?: AcademicQueryDataReader) =>
  createAiAssistantService({ vault: createAiAssistantVault(), academicData });

export const registerAiAssistantHandlers = (options?: { academicData?: AcademicQueryDataReader }): void => {
  const { academicData } = options ?? {};
  registerTrustedIpcHandler("campusos:assistant:settings:load", async () => {
    return createService(academicData).loadSettings();
  });
  registerTrustedIpcHandler("campusos:assistant:settings:save", async (input: AiAssistantSettingsInput) => {
    return createService(academicData).saveSettings(input);
  });
  registerTrustedIpcHandler("campusos:assistant:settings:clear", async () => {
    return createService(academicData).clearSettings();
  });
  registerTrustedIpcHandler("campusos:assistant:test-connection", async (input: AiAssistantConnectionTestInput) => {
    return createService(academicData).testConnection(input);
  });
  registerTrustedIpcHandler("campusos:assistant:parse", async (input: AiAssistantParseInput) => {
    return createService(academicData).parseMessage(input);
  });
  registerTrustedIpcHandler("campusos:assistant:models:discover", async (input: AiAssistantModelDiscoveryInput) => {
    return createService(academicData).discoverModels(input);
  });
};
