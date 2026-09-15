/*
 * Quality-development family of the ZJU unified-auth client.
 *
 * Split out of zjuUnifiedAuth.ts. The bodies are the
 * originals with only mechanical renames: the session maps belong to this class and the
 * shared request/CAS helpers arrive through the injected host. DekT needs a separate
 * cookie jar and hands back the authenticated profile the login flow reports.
 */
import { computeRequestFingerprint } from "./requestFingerprint";
import { QUALITY_DEVELOPMENT_CONTEXT_URL, QUALITY_DEVELOPMENT_PRACTICE_ACCEPT, QUALITY_DEVELOPMENT_PRACTICE_TIMEOUT_MS, QUALITY_DEVELOPMENT_PRACTICE_URL, QUALITY_DEVELOPMENT_PROFILE_URL, QUALITY_DEVELOPMENT_SERVICE_URL, ZJU_AUTH_LOGIN_URL } from "./zjuAuthConfig";
import { ZjuUnifiedAuthError } from "./zjuAuthContracts";
import type { ZjuAuthCredentials, ZjuAuthenticatedProfile, ZjuQualityDevelopmentServiceRequest, ZjuQualityDevelopmentServiceResponse } from "./zjuAuthContracts";
import { CookieJar, cookieHeaderHasName, getHeader, getHeaderValues } from "./zjuAuthCookies";
import { isAuthenticatedQualityContext, isRedirect, parseAuthenticatedProfile, serviceBodyIndicatesExpiredSession, validateQualityDevelopmentCallback, validateStatus } from "./zjuAuthParsing";
import type { ZjuAuthRequestHost } from "./zjuAuthHost";

export class ZjuQualityApi {
  readonly #host: ZjuAuthRequestHost;
  readonly #sessions = new Map<string, CookieJar>();
  readonly #pendingSessions = new Map<string, Promise<CookieJar>>();

  constructor(host: ZjuAuthRequestHost) {
    this.#host = host;
  }

  clear(): void {
    this.#sessions.clear();
    this.#pendingSessions.clear();
  }

  setSession(username: string, session: CookieJar): void {
    this.#sessions.set(username, session);
  }

  connect(
    casCookies: CookieJar,
    username: string,
    authenticatedAt: string
  ): Promise<{ profile: ZjuAuthenticatedProfile; session: CookieJar }> {
    return this.#connect(casCookies, username, authenticatedAt);
  }

  async #connect(
    casCookies: CookieJar,
    username: string,
    authenticatedAt: string
  ): Promise<{ profile: ZjuAuthenticatedProfile; session: CookieJar }> {
    const serviceLoginUrl = new URL(ZJU_AUTH_LOGIN_URL);
    serviceLoginUrl.searchParams.set("service", QUALITY_DEVELOPMENT_SERVICE_URL);
    const serviceResponse = await this.#host.request("GET", serviceLoginUrl.href, {
      cookie: casCookies.header(serviceLoginUrl.href)
    });
    const location = getHeader(serviceResponse.headers, "location");
    if (!isRedirect(serviceResponse.status) || !location) {
      throw new ZjuUnifiedAuthError(
        "service-verification-failed",
        "统一认证登录态未能通过素质拓展平台连接验证。",
        { statusCode: serviceResponse.status }
      );
    }

    const callback = new URL(location, QUALITY_DEVELOPMENT_SERVICE_URL);
    validateQualityDevelopmentCallback(callback);
    const callbackResponse = await this.#host.request("GET", callback.href);
    const qualityCookies = new CookieJar();
    qualityCookies.store(
      callback.href,
      getHeaderValues(callbackResponse.headers, "set-cookie")
    );
    if (
      callbackResponse.status !== 200 ||
      !cookieHeaderHasName(
        qualityCookies.header(QUALITY_DEVELOPMENT_CONTEXT_URL),
        "SESSION"
      )
    ) {
      throw new ZjuUnifiedAuthError(
        "service-verification-failed",
        "素质拓展平台没有建立正式的已认证会话。",
        { statusCode: callbackResponse.status }
      );
    }

    const contextResponse = await this.#host.request(
      "POST",
      QUALITY_DEVELOPMENT_CONTEXT_URL,
      {
        body: "",
        cookie: qualityCookies.header(QUALITY_DEVELOPMENT_CONTEXT_URL),
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://sztz.zju.edu.cn",
          Referer: QUALITY_DEVELOPMENT_SERVICE_URL
        }
      }
    );
    qualityCookies.store(
      QUALITY_DEVELOPMENT_CONTEXT_URL,
      getHeaderValues(contextResponse.headers, "set-cookie")
    );
    if (
      contextResponse.status !== 200 ||
      !cookieHeaderHasName(
        qualityCookies.header(QUALITY_DEVELOPMENT_PROFILE_URL),
        "SESSION"
      ) ||
      !isAuthenticatedQualityContext(contextResponse.body)
    ) {
      throw new ZjuUnifiedAuthError(
        "service-verification-failed",
        "素质拓展平台返回了匿名或无效身份。",
        { statusCode: contextResponse.status }
      );
    }

    const profileResponse = await this.#host.request(
      "GET",
      QUALITY_DEVELOPMENT_PROFILE_URL,
      {
        cookie: qualityCookies.header(QUALITY_DEVELOPMENT_PROFILE_URL),
        headers: {
          Accept: "application/json, text/plain, */*",
          "Cache-Control": "no-cache",
          Pragma: "no-cache"
        }
      }
    );
    validateStatus(profileResponse, "素质拓展个人汇总接口");
    return {
      profile: parseAuthenticatedProfile(
        profileResponse.body,
        username,
        authenticatedAt
      ),
      session: qualityCookies
    };
  }

  async request(
    credentials: ZjuAuthCredentials,
    request: ZjuQualityDevelopmentServiceRequest
  ): Promise<ZjuQualityDevelopmentServiceResponse> {
    const requestUrl = request.operation === "practice"
      ? QUALITY_DEVELOPMENT_PRACTICE_URL
      : QUALITY_DEVELOPMENT_PROFILE_URL;
    // B4-1：请求版本指纹在发起 HTTP 处构造（方法+主机+路径+静态字段名，不含任何值）。
    const requestFingerprint = request.operation === "practice"
      ? computeRequestFingerprint("GET", QUALITY_DEVELOPMENT_PRACTICE_URL)
      : computeRequestFingerprint("GET", QUALITY_DEVELOPMENT_PROFILE_URL);
    const username = credentials.username.trim();

    // Only the first expired response can continue; every later path exits.
    for (let attempt = 0; ; attempt += 1) {
      // A single in-flight login consumes a CAS ticket once; this map is the
      // TypeScript single-flight adaptation for concurrent practice/summary calls.
      const session = await this.#getSession(credentials);

      const response = await this.#host.request("GET", requestUrl, {
        cookie: session.header(requestUrl),
        headers: {
          Accept: request.operation === "practice"
            ? QUALITY_DEVELOPMENT_PRACTICE_ACCEPT
            : "application/json, text/plain, */*",
          "Cache-Control": "no-cache",
          Pragma: "no-cache"
        },
        // The practice request uses a 12-second timeout; #request supplies
        // AbortSignal to Node HTTPS.
        timeoutMs: request.operation === "practice"
          ? QUALITY_DEVELOPMENT_PRACTICE_TIMEOUT_MS
          : this.#host.timeoutMs
      });
      session.store(requestUrl, getHeaderValues(response.headers, "set-cookie"));

      const expired = response.status === 401 ||
        response.status === 403 ||
        isRedirect(response.status) ||
        serviceBodyIndicatesExpiredSession(response.body);
      if (expired && attempt === 0) {
        this.#sessions.delete(username);
        continue;
      }
      if (expired) {
        throw new ZjuUnifiedAuthError(
          "service-verification-failed",
          "素质拓展业务会话已失效，重新认证后仍无法访问。",
          { statusCode: response.status }
        );
      }

      validateStatus(
        response,
        request.operation === "practice"
          ? "素质拓展实践项目接口"
          : "素质拓展 getMyInfo 接口"
      );
      return { status: response.status, body: response.body, requestFingerprint };
    }
  }

  async #getSession(credentials: ZjuAuthCredentials): Promise<CookieJar> {
    const username = credentials.username.trim();
    const cached = this.#sessions.get(username);
    if (cached) return cached;

    const pending = this.#pendingSessions.get(username);
    if (pending) return pending;

    const operation = this.#host.authenticateCas(credentials).then(async (cas) => {
      const connected = await this.#connect(
        cas.cookies,
        username,
        this.#host.now().toISOString()
      );
      this.#sessions.set(username, connected.session);
      return connected.session;
    });
    this.#pendingSessions.set(username, operation);
    try {
      return await operation;
    } finally {
      if (this.#pendingSessions.get(username) === operation) {
        this.#pendingSessions.delete(username);
      }
    }
  }
}
