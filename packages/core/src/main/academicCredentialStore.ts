import { app, safeStorage } from "electron";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type {
  AcademicCredentialConnectionResponse,
  AcademicCredentialInput,
  AcademicCredentialRecord
} from "../shared/credentialBridge";
import {
  AcademicCredentialServiceError,
  createAcademicCredentialService,
  type AcademicCredentialSecret,
  type AcademicCredentialVault,
  type StoredAcademicCredentialPayload
} from "./academicCredentialService";
import { registerTrustedIpcHandler } from "./trustedIpc";
import { createZjuUnifiedAuthClient } from "./zjuUnifiedAuth";
import { ZjuUnifiedAuthError } from "./zjuAuthContracts";
import type { AccountProfileStore } from "./accountProfileStore";
import type { ZjuGraduateServiceRequest, ZjuGraduateServiceResponse, ZjuLearningDownloadRequest, ZjuLearningServiceRequest, ZjuLearningServiceResponse, ZjuQualityDevelopmentServiceRequest, ZjuQualityDevelopmentServiceResponse, ZjuUndergraduateServiceRequest, ZjuUndergraduateServiceResponse, ZjuZhiyunServiceRequest, ZjuZhiyunServiceResponse } from "./zjuAuthContracts";

const ACADEMIC_CREDENTIAL_FILE = "academic-affairs.json";
const zjuUnifiedAuth = createZjuUnifiedAuthClient();
let pendingConnection: Promise<AcademicCredentialRecord> | null = null;
let accountProfiles: AccountProfileStore | undefined;
let onProfileChange: (() => void) | undefined;

const getCredentialStorePath = (): string =>
  join(app.getPath("userData"), "secure", ACADEMIC_CREDENTIAL_FILE);

const isFileNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

const createAcademicCredentialVault = (): AcademicCredentialVault => {
  const storagePath = getCredentialStorePath();

  return {
    storagePath,
    encrypted: true,
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (password) =>
      safeStorage.encryptString(password).toString("base64"),
    decrypt: (encryptedPassword) =>
      safeStorage.decryptString(Buffer.from(encryptedPassword, "base64")),
    read: async () => {
      try {
        return JSON.parse(await readFile(storagePath, "utf8")) as unknown;
      } catch (error) {
        if (isFileNotFound(error)) return null;
        throw error;
      }
    },
    write: async (payload: StoredAcademicCredentialPayload) => {
      // Authentication still follows Celechron via createService; only its encrypted
      // persistence destination changes so connecting B never overwrites A's vault.
      const destination = accountProfiles?.credentialPath(payload) ?? storagePath;
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      const temporaryPath = `${destination}.${randomUUID()}.tmp`;

      try {
        await writeFile(temporaryPath, JSON.stringify(payload, null, 2), {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600
        });
        await rename(temporaryPath, destination);
      } catch (error) {
        try {
          await unlink(temporaryPath);
        } catch (cleanupError) {
          if (!isFileNotFound(cleanupError)) {
            throw new AggregateError(
              [error, cleanupError],
              "Credential write and temporary-file cleanup both failed."
            );
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

const createService = () =>
  createAcademicCredentialService({
    vault: createAcademicCredentialVault(),
    authenticate: (input) => zjuUnifiedAuth.authenticate(input)
  });

export const readAcademicCredentialRecord =
  async (): Promise<AcademicCredentialRecord> => createService().load();

export const connectAcademicCredentialRecord = async (
  input: AcademicCredentialInput
): Promise<AcademicCredentialRecord> => {
  if (pendingConnection) {
    throw new AcademicCredentialServiceError(
      "connection-busy",
      "统一认证连接正在进行，请等待当前请求完成。"
    );
  }

  zjuUnifiedAuth.clearServiceSessions();
  const connection = createService().connect(input);
  pendingConnection = connection;
  try {
    const record = await connection;
    if (accountProfiles?.activate({ username: record.username!, program: record.program })) onProfileChange?.();
    return record;
  } finally {
    if (pendingConnection === connection) pendingConnection = null;
  }
};

export const clearAcademicCredentialRecord = async (): Promise<AcademicCredentialRecord> => {
  if (pendingConnection) throw new AcademicCredentialServiceError("connection-busy", "正在连接账号，请稍后退出。");
  let cleared = false;
  try {
    const record = await createService().clear();
    cleared = true;
    accountProfiles?.signOut();
    return record;
  } finally {
    zjuUnifiedAuth.clearServiceSessions();
    if (cleared) onProfileChange?.();
  }
};

export const readAcademicCredentialSecret =
  async (): Promise<AcademicCredentialSecret | null> =>
    createService().loadSecret();

export const requestZjuItcPage = async (url: string): Promise<{ status: number; body: string }> => {
  const secret = await readAcademicCredentialSecret();
  if (!secret) throw new AcademicCredentialServiceError("invalid-input", "请先在账号管理中连接统一身份认证账号。");
  return zjuUnifiedAuth.requestItcPage(secret, url);
};

export const requestZjuEtaTimetable = async (year: number, semester: 1 | 2) => {
  const secret = await readAcademicCredentialSecret();
  if (!secret) throw new AcademicCredentialServiceError("invalid-input", "请先连接统一身份认证账号。");
  return zjuUnifiedAuth.requestEtaTimetable(secret, year, semester);
};

export const requestUndergraduateAcademicService = async (
  request: ZjuUndergraduateServiceRequest
): Promise<ZjuUndergraduateServiceResponse> => {
  const secret = await readAcademicCredentialSecret();
  if (!secret) {
    throw new AcademicCredentialServiceError(
      "invalid-input",
      "尚未保存经过验证的统一身份认证账号。"
    );
  }

  return zjuUnifiedAuth.requestUndergraduateService(secret, request);
};

export const requestZjuLearningService = async (
  request: ZjuLearningServiceRequest
): Promise<ZjuLearningServiceResponse> => {
  const secret = await readAcademicCredentialSecret();
  if (!secret) {
    throw new AcademicCredentialServiceError(
      "invalid-input",
      "尚未保存经过验证的统一身份认证账号。"
    );
  }

  return zjuUnifiedAuth.requestLearningService(secret, request);
};

export const requestZjuLearningDownload = async (
  request: ZjuLearningDownloadRequest
): Promise<Response> => {
  const secret = await readAcademicCredentialSecret();
  if (!secret) {
    throw new AcademicCredentialServiceError(
      "invalid-input",
      "尚未保存经过验证的统一身份认证账号。"
    );
  }

  return zjuUnifiedAuth.requestLearningDownload(secret, request);
};

export const requestZjuZhiyunService = async (
  request: ZjuZhiyunServiceRequest
): Promise<ZjuZhiyunServiceResponse> => {
  const secret = await readAcademicCredentialSecret();
  if (!secret) {
    throw new AcademicCredentialServiceError(
      "invalid-input",
      "尚未连接统一身份认证账号。"
    );
  }

  return zjuUnifiedAuth.requestZhiyunService(secret, request);
};

export const requestZjuQualityDevelopmentService = async (
  request: ZjuQualityDevelopmentServiceRequest
): Promise<ZjuQualityDevelopmentServiceResponse> => {
  const secret = await readAcademicCredentialSecret();
  if (!secret) {
    throw new AcademicCredentialServiceError(
      "invalid-input",
      "尚未保存经过验证的统一身份认证账号。"
    );
  }

  return zjuUnifiedAuth.requestQualityDevelopmentService(secret, request);
};

export const requestGraduateAcademicService = async (
  request: ZjuGraduateServiceRequest
): Promise<ZjuGraduateServiceResponse> => {
  const secret = await readAcademicCredentialSecret();
  if (!secret) {
    throw new AcademicCredentialServiceError(
      "invalid-input",
      "尚未保存经过验证的统一身份认证账号。"
    );
  }

  return zjuUnifiedAuth.requestGraduateService(secret, request);
};

const connectForRenderer = async (
  input: AcademicCredentialInput
): Promise<AcademicCredentialConnectionResponse> => {
  try {
    return {
      ok: true,
      record: await connectAcademicCredentialRecord(input)
    };
  } catch (error) {
    if (error instanceof ZjuUnifiedAuthError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      };
    }
    if (error instanceof AcademicCredentialServiceError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      };
    }
    return {
      ok: false,
      error: {
        code: "unknown",
        message: "统一认证连接失败，账号未保存，请重试。"
      }
    };
  }
};

export const registerAcademicCredentialHandlers = (options?: { profiles: AccountProfileStore; onProfileChange: () => void }): void => {
  accountProfiles = options?.profiles;
  onProfileChange = options?.onProfileChange;
  registerTrustedIpcHandler(
    "campusos:credentials:academic-affairs:load",
    async () => {
      return readAcademicCredentialRecord();
    }
  );
  registerTrustedIpcHandler(
    "campusos:credentials:academic-affairs:connect",
    async (input: AcademicCredentialInput) => {
      return connectForRenderer(input);
    }
  );
  registerTrustedIpcHandler(
    "campusos:credentials:academic-affairs:clear",
    async () => {
      return clearAcademicCredentialRecord();
    }
  );
};
