/*
 * Undergraduate academic-affairs family of the ZJU unified-auth client.
 *
 * Split out of zjuUnifiedAuth.ts. The bodies are the
 * originals with only mechanical renames: the session maps belong to this class and the
 * shared request/CAS helpers arrive through the injected host. The 教务处 session is a
 * cookie jar established through the CAS service callback, cached per username.
 */
import { computeRequestFingerprint } from "./requestFingerprint";
import { UNDERGRADUATE_ACADEMIC_SERVICE_URL, UNDERGRADUATE_EXAMS_URL, UNDERGRADUATE_GRADES_URL, UNDERGRADUATE_MAJOR_GRADES_URL, UNDERGRADUATE_TIMETABLE_URL, ZJU_AUTH_LOGIN_URL, ZJU_BROWSER_USER_AGENT } from "./zjuAuthConfig";
import { ZjuUnifiedAuthError } from "./zjuAuthContracts";
import type { ZjuAuthCredentials, ZjuUndergraduateServiceRequest, ZjuUndergraduateServiceResponse } from "./zjuAuthContracts";
import { CookieJar, getHeader, getHeaderValues } from "./zjuAuthCookies";
import { isRedirect, normalizeServiceCallback, validateServiceCallback, validateStatus } from "./zjuAuthParsing";
import type { ZjuAuthRequestHost } from "./zjuAuthHost";

export class ZjuUndergraduateApi {
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

  connect(casCookies: CookieJar): Promise<CookieJar> {
    return this.#connect(casCookies);
  }

  async #connect(
    casCookies: CookieJar
  ): Promise<CookieJar> {
    const serviceLoginUrl = new URL(ZJU_AUTH_LOGIN_URL);
    serviceLoginUrl.searchParams.set(
      "service",
      UNDERGRADUATE_ACADEMIC_SERVICE_URL
    );
    const serviceResponse = await this.#host.request("GET", serviceLoginUrl.href, {
      cookie: casCookies.header(serviceLoginUrl.href)
    });
    const location = getHeader(serviceResponse.headers, "location");
    if (!isRedirect(serviceResponse.status) || !location) {
      throw new ZjuUnifiedAuthError(
        "service-verification-failed",
        "统一认证登录态未能通过教务网连接验证。",
        { statusCode: serviceResponse.status }
      );
    }

    const callback = normalizeServiceCallback(location);
    validateServiceCallback(callback);
    const callbackResponse = await this.#host.request("GET", callback.href);
    const serviceCookies = new CookieJar();
    serviceCookies.store(
      callback.href,
      getHeaderValues(callbackResponse.headers, "set-cookie")
    );
    if (
      callbackResponse.status < 200 ||
      callbackResponse.status >= 400 ||
      !serviceCookies.has("JSESSIONID") ||
      !serviceCookies.has("route")
    ) {
      throw new ZjuUnifiedAuthError(
        "service-verification-failed",
        "教务网没有建立完整的已认证会话，请稍后重试。",
        { statusCode: callbackResponse.status }
      );
    }

    return serviceCookies;
  }

  async #getSession(
    credentials: ZjuAuthCredentials
  ): Promise<CookieJar> {
    const username = credentials.username.trim();
    const cached = this.#sessions.get(username);
    if (cached) return cached;

    const pending = this.#pendingSessions.get(username);
    if (pending) return pending;

    const operation = this.#host.authenticateCas(credentials).then(
      async ({ username: authenticatedUsername, cookies }) => {
        const session = await this.#connect(cookies);
        this.#sessions.set(authenticatedUsername, session);
        return session;
      }
    );
    this.#pendingSessions.set(username, operation);
    try {
      return await operation;
    } finally {
      if (this.#pendingSessions.get(username) === operation) {
        this.#pendingSessions.delete(username);
      }
    }
  }

  async request(
    credentials: ZjuAuthCredentials,
    request: ZjuUndergraduateServiceRequest
  ): Promise<ZjuUndergraduateServiceResponse> {
    const timetableRequestValid =
      request.operation !== "timetable" ||
      (Number.isInteger(request.academicYearStart) &&
        request.academicYearStart >= 2000 &&
        request.academicYearStart <= 2200 &&
        (["1|秋", "1|冬", "2|春", "2|夏"] as const).includes(
          request.season
        ));
    if (!timetableRequestValid) {
      throw new ZjuUnifiedAuthError(
        "invalid-input",
        "教务网业务请求参数无效。"
      );
    }

    const username = credentials.username.trim();
    const requestUrl = request.operation === "timetable"
      ? UNDERGRADUATE_TIMETABLE_URL
      : request.operation === "exams"
        ? UNDERGRADUATE_EXAMS_URL
        : request.operation === "major-grades"
          ? UNDERGRADUATE_MAJOR_GRADES_URL
          : UNDERGRADUATE_GRADES_URL;
    const requestBody =
      request.operation === "timetable"
        // The full academic year label is sent. The endpoint accepts a start
        // year but can silently return another schedule instead of the
        // requested term.
        ? `xnm=${request.academicYearStart}-${request.academicYearStart + 1}&xqm=${request.season}&captcha_value=null`
        : "";
    const requestContext = request.operation === "timetable"
      ? "教务网课表接口"
      : request.operation === "exams"
        ? "教务网考试接口"
        : request.operation === "major-grades"
          ? "教务网主修成绩接口"
        : "教务网成绩接口";
    // B4-1：请求版本指纹在发起 HTTP 处构造（方法+主机+路径+静态字段名，不含任何值）。
    const requestFingerprint = request.operation === "timetable"
      ? computeRequestFingerprint("POST", requestUrl, [
          "xnm",
          "xqm",
          "captcha_value"
        ])
      : computeRequestFingerprint("POST", requestUrl, [
          "doType",
          "queryModel.showCount"
        ]);
    // Only the first expired response can continue; every later path exits.
    for (let attempt = 0; ; attempt += 1) {
      const session = await this.#getSession(credentials);
      const response = await this.#host.request("POST", requestUrl, {
        body: requestBody,
        cookie: session.header(requestUrl),
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          Connection: "close",
          Referer:
            "https://zdbk.zju.edu.cn/jwglxt/xtgl/index_initMenu.html",
          "User-Agent": ZJU_BROWSER_USER_AGENT,
          "X-Requested-With": "XMLHttpRequest"
        }
      });
      session.store(
        requestUrl,
        getHeaderValues(response.headers, "set-cookie")
      );

      const location = getHeader(response.headers, "location");
      const redirectedToLogin =
        isRedirect(response.status) &&
        location !== null &&
        new URL(location, requestUrl).hostname ===
          "zjuam.zju.edu.cn";
      const expired =
        response.status === 401 ||
        response.status === 403 ||
        redirectedToLogin ||
        /<input[^>]+name=["']execution["']|统一身份认证/i.test(response.body);
      if (expired && attempt === 0) {
        this.#sessions.delete(username);
        continue;
      }
      if (expired) {
        throw new ZjuUnifiedAuthError(
          "service-verification-failed",
          "教务网会话已失效，重新认证后仍无法访问。",
          { statusCode: response.status }
        );
      }
      if (request.operation === "timetable" && /captcha_error/i.test(response.body)) {
        throw new ZjuUnifiedAuthError(
          "interactive-verification-required",
          "教务网课表接口要求完成验证码。",
          { statusCode: response.status }
        );
      }
      validateStatus(response, requestContext);
      return { status: response.status, body: response.body, requestFingerprint };
    }
  }
}
