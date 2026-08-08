import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, ipcMain, safeStorage } from "electron";
import type {
  AiAssistantConnectionTestInput,
  AiAssistantParseInput,
  AiAssistantSettingsInput
} from "@campusos/shared";
import {
  createAiAssistantService,
  type AiAssistantVault,
  type StoredAiAssistantSettings
} from "./aiAssistantService";
import { assertTrustedRenderer } from "./ipcSecurity";

const SETTINGS_FILE = "ai-assistant.json";

const isFileNotFound = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

const createVault = (): AiAssistantVault => {
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

const createService = () => createAiAssistantService({ vault: createVault() });

export const registerAiAssistantHandlers = (): void => {
  ipcMain.handle("campusos:assistant:settings:load", async (event) => {
    assertTrustedRenderer(event);
    return createService().loadSettings();
  });
  ipcMain.handle("campusos:assistant:settings:save", async (event, input: AiAssistantSettingsInput) => {
    assertTrustedRenderer(event);
    return createService().saveSettings(input);
  });
  ipcMain.handle("campusos:assistant:settings:clear", async (event) => {
    assertTrustedRenderer(event);
    return createService().clearSettings();
  });
  ipcMain.handle("campusos:assistant:test-connection", async (event, input: AiAssistantConnectionTestInput) => {
    assertTrustedRenderer(event);
    return createService().testConnection(input);
  });
  ipcMain.handle("campusos:assistant:parse", async (event, input: AiAssistantParseInput) => {
    assertTrustedRenderer(event);
    return createService().parseMessage(input);
  });
};
