/*
 * Types and the error class of the ZJU unified-auth client.
 *
 * Moved verbatim out of zjuUnifiedAuth.ts in batch 43 of the ADR-0006 program. The
 * transport and service contracts are what the client, the credential store and the tests
 * agree on, and the error class has to stay a single identity because callers use
 * `instanceof` on it.
 */
import type { AcademicAuthenticatedProfile, AcademicProgram } from "../shared/credentialBridge";

export type ZjuAuthErrorCode =
  | "invalid-input"
  | "invalid-credentials"
  | "interactive-verification-required"
  | "timeout"
  | "network-error"
  | "service-unavailable"
  | "protocol-error"
  | "service-verification-failed";

export class ZjuUnifiedAuthError extends Error {
  readonly code: ZjuAuthErrorCode;
  readonly statusCode?: number;

  constructor(
    code: ZjuAuthErrorCode,
    message: string,
    options: { cause?: unknown; statusCode?: number } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ZjuUnifiedAuthError";
    this.code = code;
    this.statusCode = options.statusCode;
  }
}

export interface ZjuAuthCredentials {
  username: string;
  password: string;
}

export interface ZjuAuthenticationResult {
  provider: "zju-unified-auth";
  username: string;
  authenticatedAt: string;
  program: AcademicProgram;
  verifiedService:
    | "undergraduate-academic-affairs"
    | "graduate-academic-affairs";
  authenticatedProfile: ZjuAuthenticatedProfile;
}

export type ZjuUndergraduateSeason = "1|秋" | "1|冬" | "2|春" | "2|夏";

export type ZjuUndergraduateServiceRequest =
  | {
      operation: "timetable";
      academicYearStart: number;
      season: ZjuUndergraduateSeason;
    }
  | { operation: "exams" }
  | { operation: "grades" }
  | { operation: "major-grades" };

export interface ZjuUndergraduateServiceResponse {
  status: number;
  body: string;
  /** 请求版本指纹（方法+主机+路径+静态字段名，脱敏），供上游兼容雷达。 */
  requestFingerprint?: string;
}

export type ZjuGraduateTerm = 11 | 12 | 13 | 14 | 15 | 16;

export type ZjuGraduateServiceRequest =
  | {
      operation: "timetable";
      academicYearStart: number;
      term: ZjuGraduateTerm;
    }
  | {
      operation: "exams";
      academicYearStart: number;
      term: ZjuGraduateTerm;
    }
  | { operation: "grades" };

export interface ZjuGraduateServiceResponse {
  status: number;
  body: string;
  /** 请求版本指纹（方法+主机+路径+静态字段名，脱敏），供上游兼容雷达。 */
  requestFingerprint?: string;
}

export type ZjuLearningServiceRequest =
  | { operation: "todos" }
  | { operation: "semesters" }
  | { operation: "courses"; page: number; scope?: "active" | "all" }
  | { operation: "course-activities"; courseId: string };

export interface ZjuLearningServiceResponse {
  status: number;
  body: string;
  /** 请求版本指纹（方法+主机+路径+静态字段名，脱敏），供上游兼容雷达。 */
  requestFingerprint?: string;
}

export interface ZjuLearningDownloadRequest {
  uploadId: string;
  referenceId: string;
  signal: AbortSignal;
  range?: string;
}

export type ZjuQualityDevelopmentServiceRequest =
  | { operation: "practice" }
  | { operation: "summary" };

export interface ZjuQualityDevelopmentServiceResponse {
  status: number;
  body: string;
  /** 请求版本指纹（方法+主机+路径+静态字段名，脱敏），供上游兼容雷达。 */
  requestFingerprint?: string;
}

export interface ZjuLearningDownloadTransportRequest {
  method: "GET";
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal;
}

export type ZjuLearningDownloadTransport = (
  request: ZjuLearningDownloadTransportRequest
) => Promise<Response>;

export type ZjuAuthenticatedProfile = AcademicAuthenticatedProfile;

export interface ZjuAuthHttpRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}

export interface ZjuAuthHttpResponse {
  status: number;
  headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
  body: string;
}

export type ZjuAuthTransport = (
  request: ZjuAuthHttpRequest
) => Promise<ZjuAuthHttpResponse>;
