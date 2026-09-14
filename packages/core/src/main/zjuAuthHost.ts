import type { ZjuAuthCredentials, ZjuAuthHttpResponse } from "./zjuAuthContracts";
import { CookieJar } from "./zjuAuthCookies";
/*
 * The narrow view of the unified-auth client that the per-service modules get.
 *
 * Each service family (graduate, quality development, learning platform, undergraduate
 * affairs) lives in its own module and owns its own session maps. What they share - the
 * header/timeout-shaped HTTP request, the CAS login handshake and the client's clock and
 * default timeout - is passed in as this interface, built as closures inside the client so
 * that the client's `#`-private state stays private. Batch 45 introduced it for the
 * graduate family, batch 46 extended it for quality development.
 */

export interface ZjuAuthRequestOptions {
  body?: string;
  cookie?: string | null;
  headers?: Record<string, string>;
  minimalHeaders?: boolean;
  timeoutMs?: number;
}

export interface ZjuAuthRequestHost {
  request(
    method: "GET" | "POST",
    url: string,
    options?: ZjuAuthRequestOptions
  ): Promise<ZjuAuthHttpResponse>;
  authenticateCas(
    credentials: ZjuAuthCredentials
  ): Promise<{ username: string; cookies: CookieJar }>;
  /** Default request timeout, as the client resolved it from its options. */
  readonly timeoutMs: number;
  /** Clock the client was built with, so a family stamps the same time source. */
  now(): Date;
}
