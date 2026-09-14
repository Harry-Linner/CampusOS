import type {
  AcademicCredentialConnectionErrorCode,
  AcademicCredentialInput,
  AcademicCredentialRecord
} from "../../shared/credentialBridge";
import type { CampusosBridge } from "../../shared/campusBridge";

export class AcademicCredentialConnectionError extends Error {
  readonly code: AcademicCredentialConnectionErrorCode;

  constructor(code: AcademicCredentialConnectionErrorCode, message: string) {
    super(message);
    this.name = "AcademicCredentialConnectionError";
    this.code = code;
  }
}

const resolveCampusosBridge = (): CampusosBridge | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return window.campusos ?? null;
};

const requireCampusosBridge = (): CampusosBridge => {
  const bridge = resolveCampusosBridge();

  if (!bridge) {
    throw new Error("CampusOS 主进程连接不可用，无法读取或修改统一认证凭据。");
  }

  return bridge;
};

export const loadAcademicCredentialRecord =
  async (): Promise<AcademicCredentialRecord> => {
    return requireCampusosBridge().credentials.academicAffairs.load();
  };

export const connectAcademicCredentialRecord = async (
  input: AcademicCredentialInput
): Promise<AcademicCredentialRecord> => {
  const response = await requireCampusosBridge().credentials.academicAffairs.connect(input);
  if (!response.ok) {
    throw new AcademicCredentialConnectionError(
      response.error.code,
      response.error.message
    );
  }
  return response.record;
};

export const clearAcademicCredentialRecord =
  async (): Promise<AcademicCredentialRecord> => {
    return requireCampusosBridge().credentials.academicAffairs.clear();
  };
