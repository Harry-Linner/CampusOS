/*
 * Graduate academic-affairs family of the ZJU unified-auth client.
 *
 * Split out of zjuUnifiedAuth.ts in batch 45 of the ADR-0006 program. The bodies are the
 * originals with only mechanical renames: the session maps belong to this class and the
 * shared request/CAS helpers arrive through the injected host. The token handshake
 * (connect, then X-Access-Token on every call) mirrors Celechron's graduate service flow.
 */
import { computeRequestFingerprint } from "./requestFingerprint";
import { GRADUATE_ACADEMIC_SERVICE_URL, GRADUATE_EXAMS_URL, GRADUATE_GRADES_URL, GRADUATE_TIMETABLE_URL, GRADUATE_VALIDATE_LOGIN_URL, ZJU_AUTH_LOGIN_URL } from "./zjuAuthConfig";
import { ZjuUnifiedAuthError } from "./zjuAuthContracts";
import type { ZjuAuthCredentials, ZjuGraduateServiceRequest, ZjuGraduateServiceResponse } from "./zjuAuthContracts";
import { CookieJar, getHeader } from "./zjuAuthCookies";
import { isRedirect, parseJsonObject, serviceBodyIndicatesExpiredSession, validateGraduateCallback, validateStatus } from "./zjuAuthParsing";
import type { ZjuAuthRequestHost } from "./zjuAuthHost";

export class ZjuGraduateApi {
  readonly #host: ZjuAuthRequestHost;
  readonly #sessions = new Map<string, string>();
  readonly #pendingSessions = new Map<string, Promise<string>>();

  constructor(host: ZjuAuthRequestHost) {
    this.#host = host;
  }

  clear(): void {
    this.#sessions.clear();
    this.#pendingSessions.clear();
  }

  setSession(username: string, token: string): void {
    this.#sessions.set(username, token);
  }

  connect(casCookies: CookieJar): Promise<string> {
    return this.#connect(casCookies);
  }

  async #connect(casCookies: CookieJar): Promise<string> {
    const serviceLoginUrl = new URL(ZJU_AUTH_LOGIN_URL);
    serviceLoginUrl.searchParams.set("service", GRADUATE_ACADEMIC_SERVICE_URL);
    const serviceResponse = await this.#host.request("GET", serviceLoginUrl.href, {
      cookie: casCookies.header(serviceLoginUrl.href)
    });
    const location = getHeader(serviceResponse.headers, "location");
    if (!isRedirect(serviceResponse.status) || !location) {
      throw new ZjuUnifiedAuthError(
        "service-verification-failed",
        "统一认证登录态未能通过研究生院连接验证。",
        { statusCode: serviceResponse.status }
      );
    }

    const callback = new URL(location, GRADUATE_ACADEMIC_SERVICE_URL);
    const ticket = validateGraduateCallback(callback);
    const validateUrl = new URL(GRADUATE_VALIDATE_LOGIN_URL);
    validateUrl.searchParams.set("ticket", ticket);
    validateUrl.searchParams.set("service", GRADUATE_ACADEMIC_SERVICE_URL);
    const validateResponse = await this.#host.request("GET", validateUrl.href, {
      cookie: casCookies.header(validateUrl.href),
      headers: { Accept: "application/json, text/plain, */*" }
    });
    validateStatus(validateResponse, "研究生院 CAS 校验接口");
    const payload = parseJsonObject(validateResponse.body);
    const result = payload && typeof payload.result === "object" &&
      payload.result !== null && !Array.isArray(payload.result)
      ? payload.result as Record<string, unknown>
      : null;
    const token = result?.token;
    if (payload?.success !== true || typeof token !== "string" || !token) {
      throw new ZjuUnifiedAuthError(
        "service-verification-failed",
        "研究生院没有签发有效的业务访问令牌。",
        { statusCode: validateResponse.status }
      );
    }

    return token;
  }

  async #getSession(
    credentials: ZjuAuthCredentials
  ): Promise<string> {
    const username = credentials.username.trim();
    const cached = this.#sessions.get(username);
    if (cached) return cached;

    const pending = this.#pendingSessions.get(username);
    if (pending) return pending;

    const operation = this.#host.authenticateCas(credentials).then(
      async ({ username: authenticatedUsername, cookies }) => {
        const token = await this.#connect(cookies);
        this.#sessions.set(authenticatedUsername, token);
        return token;
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
    request: ZjuGraduateServiceRequest
  ): Promise<ZjuGraduateServiceResponse> {
    const termRequestValid = request.operation === "grades" ||
      (Number.isInteger(request.academicYearStart) &&
        request.academicYearStart >= 2000 &&
        request.academicYearStart <= 2200 &&
        ([11, 12, 13, 14, 15, 16] as const).includes(request.term));
    if (!termRequestValid) {
      throw new ZjuUnifiedAuthError(
        "invalid-input",
        "研究生院业务请求参数无效。"
      );
    }

    const requestUrl = new URL(
      request.operation === "timetable"
        ? GRADUATE_TIMETABLE_URL
        : request.operation === "exams"
          ? GRADUATE_EXAMS_URL
          : GRADUATE_GRADES_URL
    );
    let examQuery: Record<string, string> | null = null;
    if (request.operation === "timetable") {
      requestUrl.searchParams.set("xn", String(request.academicYearStart));
      requestUrl.searchParams.set("pkxq", String(request.term));
    } else if (request.operation === "exams") {
      const fields = "id,,kcbh,kcmc,rq,ksTime,xn,xq_dictText,ksdd,zwh";
      examQuery = {
        dm: "py_grks",
        mode: "2",
        role: "1",
        column: "createTime",
        order: "desc",
        queryMode: "1",
        field: fields,
        pageNo: "1",
        pageSize: "100",
        xn: String(request.academicYearStart),
        xq: String(request.term)
      };
      for (const [name, value] of Object.entries(examQuery)) {
        requestUrl.searchParams.set(name, value);
      }
    }

    // B4-1：请求版本指纹在发起 HTTP 处构造（方法+主机+路径+静态字段名，不含任何值）。
    const requestFingerprint = request.operation === "timetable"
      ? computeRequestFingerprint("GET", requestUrl.href, ["xn", "pkxq"])
      : request.operation === "exams"
        ? computeRequestFingerprint(
            "GET",
            requestUrl.href,
            examQuery !== null ? Object.keys(examQuery) : []
          )
        : computeRequestFingerprint("POST", requestUrl.href);

    const username = credentials.username.trim();
    const method = request.operation === "grades" ? "POST" : "GET";
    // Only the first expired response can continue; every later path exits.
    for (let attempt = 0; ; attempt += 1) {
      const token = await this.#getSession(credentials);
      const response = await this.#host.request(method, requestUrl.href, {
        body: method === "POST" ? "" : undefined,
        headers: {
          Accept: "application/json, text/plain, */*",
          "X-Access-Token": token
        }
      });
      const expired = response.status === 401 || response.status === 403 ||
        serviceBodyIndicatesExpiredSession(response.body);
      if (expired && attempt === 0) {
        this.#sessions.delete(username);
        continue;
      }
      if (expired) {
        throw new ZjuUnifiedAuthError(
          "service-verification-failed",
          "研究生院业务令牌已失效，重新认证后仍无法访问。",
          { statusCode: response.status }
        );
      }

      validateStatus(response, "研究生院业务接口");
      return { status: response.status, body: response.body, requestFingerprint };
    }
  }
}
