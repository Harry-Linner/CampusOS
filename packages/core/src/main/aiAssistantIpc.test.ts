import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  userDataPath: "",
  encryptString: vi.fn(() => Buffer.from([0, 1, 2, 3, 4])),
  decryptString: vi.fn(() => "mock-api-key")
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => electronState.userDataPath)
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronState.handlers.set(channel, handler);
    })
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: electronState.encryptString,
    decryptString: electronState.decryptString
  }
}));

import { registerAiAssistantHandlers } from "./aiAssistantIpc";

const temporaryDirectories: string[] = [];

const trustedEvent = (): {
  senderFrame: { url: string };
  sender: { mainFrame: unknown };
} => {
  const frame = { url: "http://localhost:5173/" };
  return { senderFrame: frame, sender: { mainFrame: frame } };
};

const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  const handler = electronState.handlers.get(channel);
  if (!handler) throw new Error(`missing handler: ${channel}`);
  return await handler(trustedEvent(), ...args) as T;
};

beforeEach(async () => {
  const root = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "campusos-assistant-ipc-"));
  temporaryDirectories.push(root);
  electronState.userDataPath = root;
  electronState.handlers.clear();
  electronState.encryptString.mockClear();
  electronState.decryptString.mockClear();
  process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
  registerAiAssistantHandlers();
});

afterEach(async () => {
  delete process.env.ELECTRON_RENDERER_URL;
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("AI Assistant IPC", () => {
  it("registers only the five formal channels and keeps the API key out of renderer results and disk plaintext", async () => {
    expect([...electronState.handlers.keys()]).toEqual([
      "campusos:assistant:settings:load",
      "campusos:assistant:settings:save",
      "campusos:assistant:settings:clear",
      "campusos:assistant:test-connection",
      "campusos:assistant:parse"
    ]);

    const record = await invoke<Record<string, unknown>>(
      "campusos:assistant:settings:save",
      { apiKey: "mock-api-key", model: "gpt-4o-mini" }
    );
    const file = await readFile(
      join(electronState.userDataPath, "secure", "ai-assistant.json"),
      "utf8"
    );

    expect(electronState.encryptString).toHaveBeenCalledWith("mock-api-key");
    expect(JSON.stringify(record)).not.toContain("mock-api-key");
    expect(file).not.toContain("mock-api-key");
    expect(file).toContain("encryptedApiKey");
  });

  it("rejects an untrusted renderer before reading settings", async () => {
    const handler = electronState.handlers.get("campusos:assistant:settings:load");
    const frame = { url: "https://evil.example/" };

    await expect(
      handler?.({ senderFrame: frame, sender: { mainFrame: frame } })
    ).rejects.toThrow("untrusted origin");
  });
});
