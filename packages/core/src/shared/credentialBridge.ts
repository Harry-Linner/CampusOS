export type AcademicProgram = "undergraduate" | "graduate";

export interface AcademicCredentialInput {
  username: string;
  password: string;
  program: AcademicProgram;
}

export interface AcademicUndergraduateAuthenticatedProfile {
  source: "zju-quality-development";
  studentId: string;
  secondClassPoints: number;
  thirdClassPoints: number;
  fourthClassPoints: number;
  fetchedAt: string;
}

export interface AcademicGraduateAuthenticatedProfile {
  source: "zju-graduate-academic-affairs";
  studentId: string;
  verifiedDataset: "graduate-grades";
  recordCount: number;
  fetchedAt: string;
}

export type AcademicAuthenticatedProfile =
  | AcademicUndergraduateAuthenticatedProfile
  | AcademicGraduateAuthenticatedProfile;

export interface AcademicCredentialRecord {
  configured: boolean;
  username: string | null;
  savedAt: string | null;
  storagePath: string | null;
  encrypted: boolean;
  sourceId: "academic-affairs";
  verificationState: "not-configured" | "unverified" | "verified";
  verifiedAt: string | null;
  provider: "zju-unified-auth" | null;
  program: AcademicProgram | null;
  verifiedService:
    | "undergraduate-academic-affairs"
    | "graduate-academic-affairs"
    | null;
  authenticatedProfile: AcademicAuthenticatedProfile | null;
}

export type AcademicCredentialConnectionErrorCode =
  | "invalid-input"
  | "invalid-credentials"
  | "interactive-verification-required"
  | "timeout"
  | "network-error"
  | "service-unavailable"
  | "protocol-error"
  | "service-verification-failed"
  | "secure-storage-unavailable"
  | "connection-busy"
  | "storage-error"
  | "unknown";

export type AcademicCredentialConnectionResponse =
  | {
      ok: true;
      record: AcademicCredentialRecord;
    }
  | {
      ok: false;
      error: {
        code: AcademicCredentialConnectionErrorCode;
        message: string;
      };
    };

export interface AcademicCredentialBridge {
  load: () => Promise<AcademicCredentialRecord>;
  connect: (
    input: AcademicCredentialInput
  ) => Promise<AcademicCredentialConnectionResponse>;
  clear: () => Promise<AcademicCredentialRecord>;
}

export const createEmptyAcademicCredentialRecord = (
  storagePath: string | null,
  encrypted: boolean
): AcademicCredentialRecord => ({
  configured: false,
  username: null,
  savedAt: null,
  storagePath,
  encrypted,
  sourceId: "academic-affairs",
  verificationState: "not-configured",
  verifiedAt: null,
  provider: null,
  program: null,
  verifiedService: null,
  authenticatedProfile: null
});
