import type { AcademicProgram } from "../shared/credentialBridge";
import { DEFAULT_TIMEOUT_MS, GRADUATE_GRADES_URL, SSO_PROCESS_COOKIE_LIFETIME_MS, ZJU_AUTH_LOGIN_URL, ZJU_AUTH_PUBLIC_KEY_URL, ZJU_BROWSER_USER_AGENT } from "./zjuAuthConfig";
import { ZjuUnifiedAuthError } from "./zjuAuthContracts";
import type { ZjuAuthCredentials, ZjuAuthHttpResponse, ZjuAuthTransport, ZjuAuthenticatedProfile, ZjuAuthenticationResult, ZjuGraduateServiceRequest, ZjuGraduateServiceResponse, ZjuLearningDownloadRequest, ZjuLearningDownloadTransport, ZjuLearningServiceRequest, ZjuLearningServiceResponse, ZjuQualityDevelopmentServiceRequest, ZjuQualityDevelopmentServiceResponse, ZjuUndergraduateServiceRequest, ZjuUndergraduateServiceResponse, ZjuZhiyunServiceRequest, ZjuZhiyunServiceResponse } from "./zjuAuthContracts";
import { CookieJar, getHeaderValues } from "./zjuAuthCookies";
import type { ActiveCasSession } from "./zjuAuthCookies";
import { createFetchZjuLearningDownloadTransport, createNodeHttpsZjuAuthTransport } from "./zjuAuthTransports";
import { encryptPassword, findExecution, parseGraduateAuthenticatedProfile, serviceBodyIndicatesExpiredSession, validateStatus } from "./zjuAuthParsing";
import { ZjuGraduateApi } from "./zjuGraduateApi";
import { ZjuQualityApi } from "./zjuQualityApi";
import { ZjuUndergraduateApi } from "./zjuUndergraduateApi";
import { ZjuLearningApi } from "./zjuLearningApi";
import { ZjuZhiyunApi } from "./zjuZhiyunApi";
import { ZjuItcApi } from "./zjuItcApi";
import { ZjuEtaApi } from "./zjuEtaApi";

interface ZjuUnifiedAuthClientOptions {
  transport?: ZjuAuthTransport;
  learningDownloadTransport?: ZjuLearningDownloadTransport;
  timeoutMs?: number;
  now?: () => Date;
}

class ZjuUnifiedAuthClient {
  readonly #transport: ZjuAuthTransport;
  readonly #learningDownloadTransport: ZjuLearningDownloadTransport;
  readonly #timeoutMs: number;
  readonly #now: () => Date;
  readonly #undergraduate: ZjuUndergraduateApi;
  readonly #learning: ZjuLearningApi;
  readonly #zhiyun: ZjuZhiyunApi;
  readonly #quality: ZjuQualityApi;
  readonly #graduate: ZjuGraduateApi;
  readonly #itc: ZjuItcApi;
  readonly #eta: ZjuEtaApi;
  readonly #activeCasSessions = new Map<string, ActiveCasSession>();
  #sessionGeneration = 0;
  readonly #pendingCasLogins = new Map<
    string,
    Promise<{ username: string; cookies: CookieJar }>
  >();

  constructor(options: ZjuUnifiedAuthClientOptions = {}) {
    this.#transport = options.transport ?? createNodeHttpsZjuAuthTransport();
    this.#learningDownloadTransport = options.learningDownloadTransport ??
      createFetchZjuLearningDownloadTransport();
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#now = options.now ?? (() => new Date());
    this.#eta = new ZjuEtaApi({
      request: (method, url, options) => this.#request(method, url, options),
      authenticateCas: credentials => this.#authenticateCas(credentials),
      timeoutMs: this.#timeoutMs,
      now: () => this.#now()
    });
    this.#itc = new ZjuItcApi({
      request: (method, url, options) => this.#request(method, url, options),
      authenticateCas: (credentials) => this.#authenticateCas(credentials),
      invalidateCas: (username) => { this.#activeCasSessions.delete(username); },
      timeoutMs: this.#timeoutMs,
      now: () => this.#now()
    });
    this.#graduate = new ZjuGraduateApi({
      request: (method, url, options) => this.#request(method, url, options),
      authenticateCas: (credentials) => this.#authenticateCas(credentials),
      timeoutMs: this.#timeoutMs,
      now: () => this.#now()
    });
    this.#quality = new ZjuQualityApi({
      request: (method, url, options) => this.#request(method, url, options),
      authenticateCas: (credentials) => this.#authenticateCas(credentials),
      timeoutMs: this.#timeoutMs,
      now: () => this.#now()
    });
    this.#undergraduate = new ZjuUndergraduateApi({
      request: (method, url, options) => this.#request(method, url, options),
      authenticateCas: (credentials) => this.#authenticateCas(credentials),
      timeoutMs: this.#timeoutMs,
      now: () => this.#now()
    });
    this.#learning = new ZjuLearningApi(
      {
        request: (method, url, options) => this.#request(method, url, options),
        authenticateCas: (credentials) => this.#authenticateCas(credentials),
        timeoutMs: this.#timeoutMs,
        now: () => this.#now()
      },
      this.#learningDownloadTransport
    );
    // 智云课堂按需连接：不参与 authenticate() 的登录扇出，避免为一个入口拉长登录链路。
    this.#zhiyun = new ZjuZhiyunApi({
      request: (method, url, options) => this.#request(method, url, options),
      authenticateCas: (credentials) => this.#authenticateCas(credentials),
      timeoutMs: this.#timeoutMs,
      now: () => this.#now()
    });
  }

  async #request(
    method: "GET" | "POST",
    url: string,
    options: {
      body?: string;
      cookie?: string | null;
      headers?: Record<string, string>;
      minimalHeaders?: boolean;
      timeoutMs?: number;
    } = {}
  ): Promise<ZjuAuthHttpResponse> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const headers: Record<string, string> = options.minimalHeaders
      ? { "User-Agent": ZJU_BROWSER_USER_AGENT }
      : {
          "User-Agent": ZJU_BROWSER_USER_AGENT,
          Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
          "Cache-Control": "no-store"
        };
    if (options.cookie) headers.Cookie = options.cookie;
    if (method === "POST") {
      headers["Content-Type"] =
        "application/x-www-form-urlencoded; charset=UTF-8";
      headers["Content-Length"] = String(
        Buffer.byteLength(options.body ?? "", "utf8")
      );
    }
    Object.assign(headers, options.headers);

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(
          new ZjuUnifiedAuthError(
            "timeout",
            "连接统一认证服务超时，请检查网络后重试。"
          )
        );
      }, options.timeoutMs ?? this.#timeoutMs);
    });
    timeout?.unref?.();

    try {
      return await Promise.race([
        this.#transport({
          method,
          url,
          headers,
          body: options.body,
          signal: controller.signal
        }),
        timeoutPromise
      ]);
    } catch (error) {
      if (error instanceof ZjuUnifiedAuthError) {
        throw error;
      }

      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw new ZjuUnifiedAuthError(
          "timeout",
          "连接统一认证服务超时，请检查网络后重试。",
          { cause: error }
        );
      }

      throw new ZjuUnifiedAuthError(
        "network-error",
        "无法连接统一认证服务，请检查网络后重试。",
        { cause: error }
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async #createFreshCasSession(
    credentials: ZjuAuthCredentials
  ): Promise<{ username: string; cookies: CookieJar }> {
    const username = credentials.username.trim();
    const password = credentials.password;
    if (!username || !password) {
      throw new ZjuUnifiedAuthError(
        "invalid-input",
        "统一认证账号和密码不能为空。"
      );
    }

    const cookies = new CookieJar();
    const loginPage = await this.#request("GET", ZJU_AUTH_LOGIN_URL);
    validateStatus(loginPage, "统一认证登录页");
    cookies.store(
      ZJU_AUTH_LOGIN_URL,
      getHeaderValues(loginPage.headers, "set-cookie")
    );
    const execution = findExecution(loginPage.body);
    if (!execution) {
      throw new ZjuUnifiedAuthError(
        "protocol-error",
        "统一认证登录页结构已变化，无法安全提交账号。"
      );
    }

    const publicKeyResponse = await this.#request(
      "GET",
      ZJU_AUTH_PUBLIC_KEY_URL,
      { cookie: cookies.header(ZJU_AUTH_PUBLIC_KEY_URL) }
    );
    validateStatus(publicKeyResponse, "统一认证公钥服务");
    cookies.store(
      ZJU_AUTH_PUBLIC_KEY_URL,
      getHeaderValues(publicKeyResponse.headers, "set-cookie")
    );

    let publicKey: unknown;
    try {
      publicKey = JSON.parse(publicKeyResponse.body);
    } catch (error) {
      throw new ZjuUnifiedAuthError(
        "protocol-error",
        "统一认证公钥响应无法解析。",
        { cause: error, statusCode: publicKeyResponse.status }
      );
    }
    if (
      typeof publicKey !== "object" ||
      publicKey === null ||
      !("modulus" in publicKey) ||
      !("exponent" in publicKey) ||
      typeof publicKey.modulus !== "string" ||
      typeof publicKey.exponent !== "string"
    ) {
      throw new ZjuUnifiedAuthError(
        "protocol-error",
        "统一认证公钥响应缺少必要字段。"
      );
    }

    const form = new URLSearchParams({
      username,
      password: encryptPassword(
        password,
        publicKey.modulus,
        publicKey.exponent
      ),
      execution,
      _eventId: "submit",
      rememberMe: "true"
    });
    const loginResponse = await this.#request("POST", ZJU_AUTH_LOGIN_URL, {
      body: form.toString(),
      cookie: cookies.header(ZJU_AUTH_LOGIN_URL)
    });
    cookies.store(
      ZJU_AUTH_LOGIN_URL,
      getHeaderValues(loginResponse.headers, "set-cookie")
    );

    if (!cookies.has("iPlanetDirectoryPro")) {
      if (
        /用户名或密码错误|账号或密码错误|学号或密码错误|密码错误/i.test(
          loginResponse.body
        )
      ) {
        throw new ZjuUnifiedAuthError(
          "invalid-credentials",
          "统一认证拒绝了该账号或密码，请检查后重试。",
          { statusCode: loginResponse.status }
        );
      }
      if (/请输入验证码|验证码错误|captcha[^<]{0,40}required|滑块/i.test(loginResponse.body)) {
        throw new ZjuUnifiedAuthError(
          "interactive-verification-required",
          "统一认证要求完成验证码或其他交互验证，当前无法自动登录。",
          { statusCode: loginResponse.status }
        );
      }
      if (loginResponse.status === 429 || loginResponse.status >= 500) {
        throw new ZjuUnifiedAuthError(
          "service-unavailable",
          "统一认证服务暂时不可用，请稍后重试。",
          { statusCode: loginResponse.status }
        );
      }
      throw new ZjuUnifiedAuthError(
        "invalid-credentials",
        "统一认证未建立有效登录态，请检查账号状态或密码后重试。",
        { statusCode: loginResponse.status }
      );
    }

    return { username, cookies };
  }

  async #authenticateCas(
    credentials: ZjuAuthCredentials
  ): Promise<{ username: string; cookies: CookieJar }> {
    const username = credentials.username.trim();
    const active = this.#activeCasSessions.get(username);
    if (active && active.expiresAt > Date.now()) {
      return { username: active.username, cookies: active.cookies };
    }
    if (active) this.#activeCasSessions.delete(username);

    const pending = this.#pendingCasLogins.get(username);
    if (pending) return pending;

    const login = this.#createFreshCasSession(credentials);
    const generation = this.#sessionGeneration;
    this.#pendingCasLogins.set(username, login);
    try {
      const session = await login;
      if (generation !== this.#sessionGeneration) throw new ZjuUnifiedAuthError("service-verification-failed", "账号连接已变更，请重新刷新。");
      this.#activeCasSessions.set(username, {
        ...session,
        expiresAt: Date.now() + SSO_PROCESS_COOKIE_LIFETIME_MS
      });
      return session;
    } finally {
      if (this.#pendingCasLogins.get(username) === login) {
        this.#pendingCasLogins.delete(username);
      }
    }
  }

  requestLearningService(
    credentials: ZjuAuthCredentials,
    request: ZjuLearningServiceRequest
  ): Promise<ZjuLearningServiceResponse> {
    return this.#learning.requestService(credentials, request);
  }

  requestLearningDownload(
    credentials: ZjuAuthCredentials,
    request: ZjuLearningDownloadRequest
  ): Promise<Response> {
    return this.#learning.requestDownload(credentials, request);
  }

  requestZhiyunService(
    credentials: ZjuAuthCredentials,
    request: ZjuZhiyunServiceRequest
  ): Promise<ZjuZhiyunServiceResponse> {
    return this.#zhiyun.requestService(credentials, request);
  }

  requestQualityDevelopmentService(
    credentials: ZjuAuthCredentials,
    request: ZjuQualityDevelopmentServiceRequest
  ): Promise<ZjuQualityDevelopmentServiceResponse> {
    return this.#quality.request(credentials, request);
  }

  requestGraduateService(
    credentials: ZjuAuthCredentials,
    request: ZjuGraduateServiceRequest
  ): Promise<ZjuGraduateServiceResponse> {
    return this.#graduate.request(credentials, request);
  }

  requestUndergraduateService(
    credentials: ZjuAuthCredentials,
    request: ZjuUndergraduateServiceRequest
  ): Promise<ZjuUndergraduateServiceResponse> {
    return this.#undergraduate.request(credentials, request);
  }

  clearServiceSessions(): void {
    this.#sessionGeneration++;
    this.#itc.clear();
    this.#eta.clear();
    this.#undergraduate.clear();
    this.#learning.clear();
    this.#zhiyun.clear();
    this.#quality.clear();
    this.#graduate.clear();
    this.#activeCasSessions.clear();
    this.#pendingCasLogins.clear();
  }

  requestItcPage(credentials: ZjuAuthCredentials, url: string): Promise<{ status: number; body: string }> {
    return this.#itc.request(credentials, url);
  }

  requestEtaTimetable(credentials: ZjuAuthCredentials, year: number, semester: 1 | 2) {
    return this.#eta.timetable(credentials, year, semester);
  }

  async authenticate(
    credentials: ZjuAuthCredentials & { program: AcademicProgram }
  ): Promise<ZjuAuthenticationResult> {
    const initialCasSession = await this.#authenticateCas(credentials);
    const { username } = initialCasSession;

    if (credentials.program === "graduate") {
      const token = await this.#graduate.connect(initialCasSession.cookies);
      const gradesResponse = await this.#request("POST", GRADUATE_GRADES_URL, {
        body: "",
        headers: {
          Accept: "application/json, text/plain, */*",
          "X-Access-Token": token
        }
      });
      if (
        gradesResponse.status === 401 ||
        gradesResponse.status === 403 ||
        serviceBodyIndicatesExpiredSession(gradesResponse.body)
      ) {
        throw new ZjuUnifiedAuthError(
          "service-verification-failed",
          "研究生院业务令牌未能访问认证后成绩数据。",
          { statusCode: gradesResponse.status }
        );
      }
      validateStatus(gradesResponse, "研究生院认证后成绩接口");
      const authenticatedAt = this.#now().toISOString();
      const authenticatedProfile = parseGraduateAuthenticatedProfile(
        gradesResponse.body,
        username,
        authenticatedAt
      );
      this.#graduate.setSession(username, token);
      return {
        provider: "zju-unified-auth",
        username,
        authenticatedAt,
        program: "graduate",
        verifiedService: "graduate-academic-affairs",
        authenticatedProfile
      };
    }

    let casCookies = initialCasSession.cookies;
    // Only the first rejected SSO result can continue; every later path exits.
    for (let attempt = 0; ; attempt += 1) {
      const authenticatedAt = this.#now().toISOString();
      const serviceResults = await Promise.allSettled([
        this.#learning.connectWithRetry(casCookies),
        this.#undergraduate.connect(casCookies),
        this.#quality.connect(
          casCookies,
          username,
          authenticatedAt
        ),
      ] as const);
      const rejected = serviceResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      if (rejected) {
        const ssoRejected =
          rejected.reason instanceof ZjuUnifiedAuthError &&
          rejected.reason.code === "service-verification-failed" &&
          /统一认证登录态|登录态失效|统一身份认证凭据无效/.test(
            rejected.reason.message
          );
        if (attempt === 0 && ssoRejected) {
          this.#activeCasSessions.delete(username);
          casCookies = (await this.#authenticateCas(credentials)).cookies;
          continue;
        }
        throw rejected.reason;
      }
      const fulfilled = serviceResults as [
        PromiseFulfilledResult<CookieJar>,
        PromiseFulfilledResult<CookieJar>,
        PromiseFulfilledResult<{
          profile: ZjuAuthenticatedProfile;
          session: CookieJar;
        }>
      ];
      const learningCookies = fulfilled[0].value;
      const serviceCookies = fulfilled[1].value;
      const qualityResult = fulfilled[2].value;
      const authenticatedProfile = qualityResult.profile;
      this.#undergraduate.setSession(username, serviceCookies);
      this.#learning.setSession(username, learningCookies);
      this.#quality.setSession(username, qualityResult.session);

      return {
        provider: "zju-unified-auth",
        username,
        authenticatedAt,
        program: "undergraduate",
        verifiedService: "undergraduate-academic-affairs",
        authenticatedProfile
      };
    }
  }
}

export const createZjuUnifiedAuthClient = (
  options: ZjuUnifiedAuthClientOptions = {}
): ZjuUnifiedAuthClient => new ZjuUnifiedAuthClient(options);
