import { describe, expect, it, vi } from "vitest";
import {
  createAcademicCredentialService,
  type AcademicCredentialVault,
  type StoredAcademicCredentialPayload
} from "./academicCredentialService";

const createVault = (
  initialPayload: StoredAcademicCredentialPayload | null = null
): AcademicCredentialVault & {
  payload: StoredAcademicCredentialPayload | null;
  encrypt: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
} => {
  const vault = {
    payload: initialPayload,
    encrypted: true,
    storagePath: "C:/secure/academic-affairs.json",
    isEncryptionAvailable: () => true,
    encrypt: vi.fn((password: string) => `encrypted:${password}`),
    read: vi.fn(async () => vault.payload),
    write: vi.fn(async (payload: StoredAcademicCredentialPayload) => {
      vault.payload = payload;
    }),
    clear: vi.fn(async () => {
      vault.payload = null;
    })
  };

  return vault;
};

describe("AcademicCredentialService", () => {
  it("authenticates before encrypting and atomically handing the payload to the vault", async () => {
    const order: string[] = [];
    const vault = createVault();
    vault.encrypt.mockImplementation((password: string) => {
      order.push("encrypt");
      return `encrypted:${password}`;
    });
    vault.write.mockImplementation(async (payload: StoredAcademicCredentialPayload) => {
      order.push("write");
      vault.payload = payload;
    });
    const authenticate = vi.fn(async () => {
      order.push("authenticate");
      return {
        provider: "zju-unified-auth" as const,
        username: "3240100001",
        authenticatedAt: "2026-07-18T08:00:00.000Z",
        program: "undergraduate" as const,
        verifiedService: "undergraduate-academic-affairs" as const,
        authenticatedProfile: {
          source: "zju-quality-development" as const,
          studentId: "3240100001",
          secondClassPoints: 3.45,
          thirdClassPoints: 1,
          fourthClassPoints: 0,
          fetchedAt: "2026-07-18T08:00:00.000Z"
        }
      };
    });
    const service = createAcademicCredentialService({ vault, authenticate });

    const record = await service.connect({
      username: " 3240100001 ",
      password: "secret",
      program: "undergraduate"
    });

    expect(order).toEqual(["authenticate", "encrypt", "write"]);
    expect(vault.payload).toEqual({
      dataVersion: 4,
      username: "3240100001",
      encryptedPassword: "encrypted:secret",
      savedAt: "2026-07-18T08:00:00.000Z",
      verifiedAt: "2026-07-18T08:00:00.000Z",
      provider: "zju-unified-auth",
      program: "undergraduate",
      verifiedService: "undergraduate-academic-affairs",
      authenticatedProfile: {
        source: "zju-quality-development",
        studentId: "3240100001",
        secondClassPoints: 3.45,
        thirdClassPoints: 1,
        fourthClassPoints: 0,
        fetchedAt: "2026-07-18T08:00:00.000Z"
      }
    });
    expect(record).toMatchObject({
      configured: true,
      verificationState: "verified",
      program: "undergraduate",
      verifiedAt: "2026-07-18T08:00:00.000Z"
    });
  });

  it("does not overwrite an existing credential when authentication fails", async () => {
    const legacyPayload: StoredAcademicCredentialPayload = {
      username: "old-user",
      encryptedPassword: "old-secret",
      savedAt: "2026-07-17T08:00:00.000Z"
    };
    const vault = createVault(legacyPayload);
    const service = createAcademicCredentialService({
      vault,
      authenticate: vi.fn(async () => {
        throw new Error("统一认证拒绝了该账号或密码。");
      })
    });

    await expect(
      service.connect({
        username: "new-user",
        password: "wrong",
        program: "undergraduate"
      })
    ).rejects.toThrow("统一认证拒绝了该账号或密码。");
    expect(vault.write).not.toHaveBeenCalled();
    expect(vault.payload).toBe(legacyPayload);
  });

  it("loads legacy saved credentials as unverified instead of connected", async () => {
    const vault = createVault({
      username: "3240100001",
      encryptedPassword: "legacy-encrypted-value",
      savedAt: "2026-07-17T08:00:00.000Z"
    });
    const service = createAcademicCredentialService({
      vault,
      authenticate: vi.fn()
    });

    await expect(service.load()).resolves.toMatchObject({
      configured: false,
      username: "3240100001",
      verificationState: "unverified",
      verifiedAt: null
    });
  });

  it("keeps a valid version 3 undergraduate receipt verified after the schema upgrade", async () => {
    const vault = createVault({
      dataVersion: 3,
      username: "3240100001",
      encryptedPassword: "encrypted-secret",
      savedAt: "2026-07-18T08:00:00.000Z",
      verifiedAt: "2026-07-18T08:00:00.000Z",
      provider: "zju-unified-auth",
      verifiedService: "undergraduate-academic-affairs",
      authenticatedProfile: {
        source: "zju-quality-development",
        studentId: "3240100001",
        secondClassPoints: 3.45,
        thirdClassPoints: 1,
        fourthClassPoints: 0,
        fetchedAt: "2026-07-18T08:00:00.000Z"
      }
    });
    const service = createAcademicCredentialService({
      vault,
      authenticate: vi.fn()
    });

    await expect(service.load()).resolves.toMatchObject({
      configured: true,
      verificationState: "verified",
      program: "undergraduate",
      verifiedService: "undergraduate-academic-affairs"
    });
  });

  it("does not send credentials when system encryption is unavailable", async () => {
    const vault = createVault();
    vault.isEncryptionAvailable = () => false;
    const authenticate = vi.fn();
    const service = createAcademicCredentialService({ vault, authenticate });

    await expect(
      service.connect({
        username: "3240100001",
        password: "secret",
        program: "undergraduate"
      })
    ).rejects.toMatchObject({ code: "secure-storage-unavailable" });
    expect(authenticate).not.toHaveBeenCalled();
    expect(vault.write).not.toHaveBeenCalled();
  });

  it("reports storage failure without replacing the previous payload", async () => {
    const previousPayload: StoredAcademicCredentialPayload = {
      username: "old-user",
      encryptedPassword: "old-secret",
      savedAt: "2026-07-17T08:00:00.000Z"
    };
    const vault = createVault(previousPayload);
    vault.write.mockRejectedValue(new Error("disk full"));
    const service = createAcademicCredentialService({
      vault,
      authenticate: vi.fn(async () => ({
        provider: "zju-unified-auth" as const,
        username: "3240100001",
        authenticatedAt: "2026-07-18T08:00:00.000Z",
        program: "undergraduate" as const,
        verifiedService: "undergraduate-academic-affairs" as const,
        authenticatedProfile: {
          source: "zju-quality-development" as const,
          studentId: "3240100001",
          secondClassPoints: 3.45,
          thirdClassPoints: 1,
          fourthClassPoints: 0,
          fetchedAt: "2026-07-18T08:00:00.000Z"
        }
      }))
    });

    await expect(
      service.connect({
        username: "3240100001",
        password: "secret",
        program: "undergraduate"
      })
    ).rejects.toMatchObject({ code: "storage-error" });
    expect(vault.payload).toBe(previousPayload);
  });

  it("persists a graduate business-data receipt without storing its response body", async () => {
    const vault = createVault();
    const service = createAcademicCredentialService({
      vault,
      authenticate: vi.fn(async () => ({
        provider: "zju-unified-auth" as const,
        username: "2240100001",
        authenticatedAt: "2026-07-19T08:00:00.000Z",
        program: "graduate" as const,
        verifiedService: "graduate-academic-affairs" as const,
        authenticatedProfile: {
          source: "zju-graduate-academic-affairs" as const,
          studentId: "2240100001",
          verifiedDataset: "graduate-grades" as const,
          recordCount: 12,
          fetchedAt: "2026-07-19T08:00:00.000Z"
        }
      }))
    });

    await expect(service.connect({
      username: "2240100001",
      password: "secret",
      program: "graduate"
    })).resolves.toMatchObject({
      configured: true,
      program: "graduate",
      verifiedService: "graduate-academic-affairs",
      authenticatedProfile: {
        verifiedDataset: "graduate-grades",
        recordCount: 12
      }
    });
    expect(JSON.stringify(vault.payload)).not.toContain("responseBody");
  });
});
