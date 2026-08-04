import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademicCredentialRecord } from "../shared/credentialBridge";
import type { DatabaseService } from "./databaseService";

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  record: null as AcademicCredentialRecord | null,
  database: {
    loadAcademicGpaWeights: vi.fn(),
    saveAcademicGpaWeights: vi.fn(),
    loadAcademicGpaStrategy: vi.fn(),
    saveAcademicGpaStrategy: vi.fn()
  }
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      state.handlers.set(channel, handler);
    })
  }
}));

vi.mock("./academicCredentialStore", () => ({
  readAcademicCredentialRecord: vi.fn(async () => state.record)
}));

vi.mock("./officialDatabaseService", () => ({
  getOfficialDatabaseService: () => state.database as unknown as DatabaseService
}));

import { registerAcademicGpaHandlers } from "./academicGpaIpc";

const verifiedRecord = (studentId: string): AcademicCredentialRecord => ({
  configured: true,
  username: studentId,
  savedAt: "2026-08-04T00:00:00.000Z",
  storagePath: null,
  encrypted: true,
  sourceId: "academic-affairs",
  verificationState: "verified",
  verifiedAt: "2026-08-04T00:00:00.000Z",
  provider: "zju-unified-auth",
  program: "undergraduate",
  verifiedService: "undergraduate-academic-affairs",
  authenticatedProfile: {
    source: "zju-quality-development",
    studentId,
    secondClassPoints: 0,
    thirdClassPoints: 0,
    fourthClassPoints: 0,
    fetchedAt: "2026-08-04T00:00:00.000Z"
  }
});

const trustedEvent = (): { senderFrame: { url: string }; sender: { mainFrame: unknown } } => {
  const frame = { url: "http://localhost:5173/" };
  return { senderFrame: frame, sender: { mainFrame: frame } };
};

const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  const handler = state.handlers.get(channel);
  if (!handler) throw new Error(`missing handler: ${channel}`);
  return await handler(trustedEvent(), ...args) as T;
};

describe("academic GPA IPC", () => {
  beforeEach(() => {
    process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
    state.handlers.clear();
    state.record = verifiedRecord("account-a");
    state.database.loadAcademicGpaWeights.mockReset();
    state.database.saveAcademicGpaWeights.mockReset();
    state.database.loadAcademicGpaStrategy.mockReset();
    state.database.saveAcademicGpaStrategy.mockReset();
    state.database.loadAcademicGpaWeights.mockReturnValue(null);
    state.database.loadAcademicGpaStrategy.mockReturnValue(null);
    registerAcademicGpaHandlers();
  });

  it("isolates saved weights by the verified account id", async () => {
    state.database.loadAcademicGpaWeights.mockImplementation((accountId: string) =>
      accountId === "account-a"
        ? { weights: { "course-1": 90 }, savedAt: "2026-08-04T00:00:00.000Z" }
        : null
    );

    const loaded = await invoke("campusos:academic:gpa-weights:load");
    expect(loaded).toEqual({
      weights: { "course-1": 90 },
      savedAt: "2026-08-04T00:00:00.000Z"
    });
    expect(state.database.loadAcademicGpaWeights).toHaveBeenCalledWith("account-a");

    state.record = verifiedRecord("account-b");
    expect(await invoke("campusos:academic:gpa-weights:load")).toEqual({
      weights: {},
      savedAt: null
    });
    expect(state.database.loadAcademicGpaWeights).toHaveBeenLastCalledWith("account-b");
  });

  it("rejects saving before an account is verified", async () => {
    state.record = { ...verifiedRecord("account-a"), verificationState: "unverified", authenticatedProfile: null };

    await expect(invoke("campusos:academic:gpa-weights:save", { "course-1": 80 }))
      .rejects.toThrow("请先连接并验证学业账号");
    expect(state.database.saveAcademicGpaWeights).not.toHaveBeenCalled();
  });

  it("rejects empty accounts, non-objects, and non-finite or out-of-range values", async () => {
    state.record = verifiedRecord("  ");
    await expect(invoke("campusos:academic:gpa-weights:save", { "course-1": 80 }))
      .rejects.toThrow("请先连接并验证学业账号");

    state.record = verifiedRecord("account-a");
    for (const input of [null, [], { "course-1": Number.NaN }, { "course-1": Infinity }, { "course-1": -1 }, { "course-1": 101 }]) {
      await expect(invoke("campusos:academic:gpa-weights:save", input)).rejects.toThrow();
    }
    expect(state.database.saveAcademicGpaWeights).not.toHaveBeenCalled();
  });

  it("isolates and validates the Celechron repeated-course strategy", async () => {
    state.database.loadAcademicGpaStrategy.mockImplementation((accountId: string) =>
      accountId === "account-a"
        ? { strategy: "first", savedAt: "2026-08-04T00:00:00.000Z" }
        : null
    );

    expect(await invoke("campusos:academic:gpa-strategy:load")).toEqual({
      strategy: "first",
      savedAt: "2026-08-04T00:00:00.000Z"
    });
    state.record = verifiedRecord("account-b");
    expect(await invoke("campusos:academic:gpa-strategy:load")).toEqual({
      strategy: "best",
      savedAt: null
    });

    await invoke("campusos:academic:gpa-strategy:save", "best");
    expect(state.database.saveAcademicGpaStrategy).toHaveBeenCalledWith(
      "account-b",
      "best",
      expect.any(String)
    );
    await expect(invoke("campusos:academic:gpa-strategy:save", "invalid"))
      .rejects.toThrow();
  });
});
