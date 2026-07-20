import type {
  AcademicAuthenticatedProfile,
  AcademicCredentialInput,
  AcademicCredentialRecord,
  AcademicProgram
} from "../shared/credentialBridge";
import { createEmptyAcademicCredentialRecord } from "../shared/credentialBridge";
import type { ZjuAuthenticationResult } from "./zjuUnifiedAuth";

export interface StoredAcademicCredentialPayload {
  dataVersion?: 2 | 3 | 4;
  username: string;
  encryptedPassword: string;
  savedAt: string;
  verifiedAt?: string;
  provider?: "zju-unified-auth";
  program?: AcademicProgram;
  verifiedService?:
    | "undergraduate-academic-affairs"
    | "graduate-academic-affairs";
  authenticatedProfile?: AcademicAuthenticatedProfile;
}

export interface AcademicCredentialVault {
  encrypted: boolean;
  storagePath: string;
  isEncryptionAvailable: () => boolean;
  encrypt: (password: string) => string;
  decrypt?: (encryptedPassword: string) => string;
  read: () => Promise<unknown | null>;
  write: (payload: StoredAcademicCredentialPayload) => Promise<void>;
  clear: () => Promise<void>;
}

interface AcademicCredentialServiceDependencies {
  vault: AcademicCredentialVault;
  authenticate: (
    input: AcademicCredentialInput
  ) => Promise<ZjuAuthenticationResult>;
}

export interface AcademicCredentialSecret {
  username: string;
  password: string;
  verifiedAt: string;
}

export type AcademicCredentialServiceErrorCode =
  | "invalid-input"
  | "secure-storage-unavailable"
  | "connection-busy"
  | "storage-error";

export class AcademicCredentialServiceError extends Error {
  readonly code: AcademicCredentialServiceErrorCode;

  constructor(
    code: AcademicCredentialServiceErrorCode,
    message: string,
    options: { cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AcademicCredentialServiceError";
    this.code = code;
  }
}

const isStoredPayload = (
  value: unknown
): value is StoredAcademicCredentialPayload =>
  typeof value === "object" &&
  value !== null &&
  "username" in value &&
  typeof value.username === "string" &&
  value.username.trim().length > 0 &&
  "encryptedPassword" in value &&
  typeof value.encryptedPassword === "string" &&
  value.encryptedPassword.length > 0 &&
  "savedAt" in value &&
  typeof value.savedAt === "string" &&
  Number.isFinite(Date.parse(value.savedAt));

const isVerifiedPayload = (
  payload: StoredAcademicCredentialPayload
): payload is StoredAcademicCredentialPayload & {
  dataVersion: 3 | 4;
  verifiedAt: string;
  provider: "zju-unified-auth";
  verifiedService:
    | "undergraduate-academic-affairs"
    | "graduate-academic-affairs";
  authenticatedProfile: AcademicAuthenticatedProfile;
} => {
  const program = payload.dataVersion === 3
    ? "undergraduate"
    : payload.program;
  return (
  (payload.dataVersion === 3 || payload.dataVersion === 4) &&
  typeof payload.verifiedAt === "string" &&
  Number.isFinite(Date.parse(payload.verifiedAt)) &&
  payload.provider === "zju-unified-auth" &&
  ((program === "undergraduate" &&
    payload.verifiedService === "undergraduate-academic-affairs") ||
    (program === "graduate" &&
      payload.verifiedService === "graduate-academic-affairs")) &&
  isAuthenticatedProfile(payload.authenticatedProfile, payload.username, program)
  );
};

const isAuthenticatedProfile = (
  value: unknown,
  expectedStudentId: string,
  expectedProgram: AcademicProgram
): value is AcademicAuthenticatedProfile =>
  typeof value === "object" &&
  value !== null &&
  "source" in value &&
  "studentId" in value &&
  value.studentId === expectedStudentId &&
  "fetchedAt" in value &&
  typeof value.fetchedAt === "string" &&
  Number.isFinite(Date.parse(value.fetchedAt)) &&
  (expectedProgram === "undergraduate"
    ? value.source === "zju-quality-development" &&
      "secondClassPoints" in value &&
      typeof value.secondClassPoints === "number" &&
      Number.isFinite(value.secondClassPoints) &&
      "thirdClassPoints" in value &&
      typeof value.thirdClassPoints === "number" &&
      Number.isFinite(value.thirdClassPoints) &&
      "fourthClassPoints" in value &&
      typeof value.fourthClassPoints === "number" &&
      Number.isFinite(value.fourthClassPoints)
    : value.source === "zju-graduate-academic-affairs" &&
      "verifiedDataset" in value &&
      value.verifiedDataset === "graduate-grades" &&
      "recordCount" in value &&
      typeof value.recordCount === "number" &&
      Number.isSafeInteger(value.recordCount) &&
      value.recordCount >= 0);

const toRecord = (
  payload: StoredAcademicCredentialPayload,
  vault: AcademicCredentialVault
): AcademicCredentialRecord => {
  const verified = isVerifiedPayload(payload);
  const program = verified
    ? payload.dataVersion === 3
      ? "undergraduate"
      : payload.program ?? null
    : null;
  return {
    configured: verified,
    username: payload.username,
    savedAt: payload.savedAt,
    storagePath: vault.storagePath,
    encrypted: vault.encrypted,
    sourceId: "academic-affairs",
    verificationState: verified ? "verified" : "unverified",
    verifiedAt: verified ? payload.verifiedAt : null,
    provider: verified ? payload.provider : null,
    program,
    verifiedService: verified ? payload.verifiedService : null,
    authenticatedProfile: verified ? payload.authenticatedProfile : null
  };
};

export const createAcademicCredentialService = ({
  vault,
  authenticate
}: AcademicCredentialServiceDependencies) => ({
  load: async (): Promise<AcademicCredentialRecord> => {
    const payload = await vault.read();
    if (payload === null) {
      return createEmptyAcademicCredentialRecord(
        vault.storagePath,
        vault.encrypted
      );
    }
    if (!isStoredPayload(payload)) {
      throw new Error("本地统一认证凭据格式无效，请清除后重新连接。");
    }
    return toRecord(payload, vault);
  },

  connect: async (
    input: AcademicCredentialInput
  ): Promise<AcademicCredentialRecord> => {
    if (!vault.isEncryptionAvailable()) {
      throw new AcademicCredentialServiceError(
        "secure-storage-unavailable",
        "当前设备无法使用系统安全存储，账号不会被保存。"
      );
    }

    if (
      typeof input !== "object" ||
      input === null ||
      typeof input.username !== "string" ||
      typeof input.password !== "string" ||
      (input.program !== "undergraduate" && input.program !== "graduate")
    ) {
      throw new AcademicCredentialServiceError(
        "invalid-input",
        "统一认证账号和密码不能为空。"
      );
    }

    const username = input.username.trim();
    const password = input.password;
    if (
      !username ||
      !password ||
      username.length > 128 ||
      Buffer.byteLength(password, "utf8") > 1_024
    ) {
      throw new AcademicCredentialServiceError(
        "invalid-input",
        "统一认证账号或密码格式无效。"
      );
    }

    const authentication = await authenticate({
      username,
      password,
      program: input.program
    });
    if (
      authentication.username !== username ||
      authentication.program !== input.program ||
      !isAuthenticatedProfile(
        authentication.authenticatedProfile,
        username,
        input.program
      )
    ) {
      throw new AcademicCredentialServiceError(
        "storage-error",
        "统一认证返回的账号与当前输入不一致，账号不会被保存。"
      );
    }

    try {
      const payload: StoredAcademicCredentialPayload = {
        dataVersion: 4,
        username,
        encryptedPassword: vault.encrypt(password),
        savedAt: authentication.authenticatedAt,
        verifiedAt: authentication.authenticatedAt,
        provider: authentication.provider,
        program: authentication.program,
        verifiedService: authentication.verifiedService,
        authenticatedProfile: authentication.authenticatedProfile
      };
      await vault.write(payload);
      return toRecord(payload, vault);
    } catch (error) {
      throw new AcademicCredentialServiceError(
        "storage-error",
        "统一认证已经通过，但凭据未能写入系统安全存储。",
        { cause: error }
      );
    }
  },

  clear: async (): Promise<AcademicCredentialRecord> => {
    await vault.clear();
    return createEmptyAcademicCredentialRecord(vault.storagePath, vault.encrypted);
  },

  loadSecret: async (): Promise<AcademicCredentialSecret | null> => {
    const payload = await vault.read();
    if (payload === null) return null;
    if (!isStoredPayload(payload) || !isVerifiedPayload(payload)) {
      throw new Error("本地统一认证凭据尚未验证，请重新连接。");
    }
    if (!vault.decrypt) {
      throw new Error("当前凭据存储不支持解密。");
    }
    return {
      username: payload.username,
      password: vault.decrypt(payload.encryptedPassword),
      verifiedAt: payload.verifiedAt
    };
  }
});
