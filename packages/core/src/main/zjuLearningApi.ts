/*
 * Learning-platform (学在浙大) family of the ZJU unified-auth client.
 *
 * Split out of zjuUnifiedAuth.ts in batch 48 of the ADR-0006 program. The bodies are the
 * originals with only mechanical renames: the session maps belong to this class and the
 * shared request/CAS helpers arrive through the injected host, while the download transport
 * is passed in because only this family uses it. The connect path retries a transient
 * session timeout once and falls back to a fresh CAS login, as Celechron does.
 */
import { computeRequestFingerprint } from "./requestFingerprint";
import { LEARNING_API_INITIAL_RETRY_DELAY_MS, LEARNING_API_MAX_ATTEMPTS, LEARNING_API_TIMEOUT_MS, LEARNING_COURSES_URL, LEARNING_SEMESTERS_URL, LEARNING_SERVICE_HOME_URL, LEARNING_TODOS_URL, ZJU_BROWSER_USER_AGENT } from "./zjuAuthConfig";
import { ZjuUnifiedAuthError } from "./zjuAuthContracts";
import type { ZjuAuthCredentials, ZjuAuthHttpResponse, ZjuLearningDownloadRequest, ZjuLearningDownloadTransport, ZjuLearningServiceRequest, ZjuLearningServiceResponse } from "./zjuAuthContracts";
import { CookieJar, cookieHeaderHasName, getHeader, getHeaderValues } from "./zjuAuthCookies";
import { findLearningMetaRefreshTarget, isRedirect, resolveLearningRedirect, serviceBodyIndicatesExpiredSession, validateLearningRedirect, validateStatus } from "./zjuAuthParsing";
import type { ZjuAuthRequestHost } from "./zjuAuthHost";

export class ZjuLearningApi {
  readonly #host: ZjuAuthRequestHost;
  readonly #downloadTransport: ZjuLearningDownloadTransport;
  readonly #sessions = new Map<string, CookieJar>();
  readonly #pendingSessions = new Map<string, Promise<CookieJar>>();

  constructor(host: ZjuAuthRequestHost, downloadTransport: ZjuLearningDownloadTransport) {
    this.#host = host;
    this.#downloadTransport = downloadTransport;
  }

  clear(): void {
    this.#sessions.clear();
    this.#pendingSessions.clear();
  }

  setSession(username: string, session: CookieJar): void {
    this.#sessions.set(username, session);
  }

  connectWithRetry(casCookies: CookieJar): Promise<CookieJar> {
    return this.#connectWithRetry(casCookies);
  }

  async #requestEndpoint(
    session: CookieJar,
    url: string
  ): Promise<ZjuAuthHttpResponse> {
    let retryDelayMs = LEARNING_API_INITIAL_RETRY_DELAY_MS;
    for (let attempt = 0; attempt < LEARNING_API_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.#host.request("GET", url, {
          cookie: session.header(url),
          minimalHeaders: true,
          headers: {},
          timeoutMs: LEARNING_API_TIMEOUT_MS
        });
        session.store(
          url,
          getHeaderValues(response.headers, "set-cookie")
        );
        return response;
      } catch (error) {
        const transient =
          error instanceof ZjuUnifiedAuthError &&
          (error.code === "timeout" || error.code === "network-error");
        if (!transient || attempt === LEARNING_API_MAX_ATTEMPTS - 1) {
          throw error;
        }

        // zju-learning-assistant src-tauri/src/zju_assist.rs:65-122 retries
        // transport failures six times with exponential backoff. Electron has
        // one Node HTTPS transport, so only the proxy/no-proxy client switch is
        // a mechanical transport adaptation; attempt order and delays match.
        await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
        retryDelayMs *= 2;
      }
    }

    // Defensive invariant fallback: with a positive retry budget every current
    // path above returns a response or rethrows the final transport error.
    throw new ZjuUnifiedAuthError(
      "network-error",
      "学在浙大业务接口请求失败。"
    );
  }

  async #connect(casCookies: CookieJar): Promise<CookieJar> {
    const learningCookies = casCookies.createLearningServiceSessionJar();
    let current = new URL(LEARNING_SERVICE_HOME_URL);

    for (let hop = 0; hop < 15; hop += 1) {
      validateLearningRedirect(current);
      const response = await this.#host.request("GET", current.href, {
        cookie: learningCookies.header(current.href),
        minimalHeaders: true,
        headers: {}
      });
      learningCookies.store(
        current.href,
        getHeaderValues(response.headers, "set-cookie")
      );

      if (isRedirect(response.status)) {
        const location = getHeader(response.headers, "location");
        if (!location) {
          throw new ZjuUnifiedAuthError(
            "protocol-error",
            "学在浙大登录跳转缺少目标地址。",
            { statusCode: response.status }
          );
        }
        current = resolveLearningRedirect(location, current);
        continue;
      }

      const success = response.status >= 200 && response.status < 300;
      const metaRefresh = success
        ? findLearningMetaRefreshTarget(response.body, current.href)
        : null;
      if (metaRefresh) {
        current = metaRefresh;
        continue;
      }

      const apiSession = learningCookies.createLearningApiSessionJar();
      if (
        success &&
        current.hostname === "courses.zju.edu.cn" &&
        cookieHeaderHasName(apiSession.header(LEARNING_TODOS_URL), "session")
      ) {
        return apiSession;
      }

      if (
        response.status === 401 ||
        response.status === 403 ||
        current.hostname === "identity.zju.edu.cn" ||
        (current.hostname === "zjuam.zju.edu.cn" &&
          current.pathname.startsWith("/cas/login")) ||
        serviceBodyIndicatesExpiredSession(response.body)
      ) {
        throw new ZjuUnifiedAuthError(
          "service-verification-failed",
          "统一认证登录态未能建立学在浙大业务会话。",
          { statusCode: response.status }
        );
      }

      validateStatus(response, "学在浙大登录");
      throw new ZjuUnifiedAuthError(
        "service-verification-failed",
        "学在浙大没有签发可访问作业接口的业务会话。",
        { statusCode: response.status }
      );
    }

    throw new ZjuUnifiedAuthError(
      "protocol-error",
      "学在浙大登录跳转次数超过安全上限。"
    );
  }

  async #connectWithRetry(
    casCookies: CookieJar
  ): Promise<CookieJar> {
    // Celechron 1.3.0 lib/http/ugrs_spider.dart:_fetchWithRetry retries
    // transient timeout/network failures once after 300 ms.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.#connect(casCookies);
      } catch (error) {
        const transient =
          error instanceof ZjuUnifiedAuthError &&
          (error.code === "timeout" || error.code === "network-error");
        if (!transient || attempt === 1) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 300));
      }
    }

    // Defensive invariant fallback: both configured attempts currently return
    // a session or rethrow, including the last transient failure.
    throw new ZjuUnifiedAuthError(
      "service-verification-failed",
      "学在浙大业务会话建立失败。"
    );
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
        const session = await this.#connectWithRetry(cookies);
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

  async requestService(
    credentials: ZjuAuthCredentials,
    request: ZjuLearningServiceRequest
  ): Promise<ZjuLearningServiceResponse> {
    // B4-1：请求版本指纹在发起 HTTP 处构造（方法+主机+路径+静态字段名，不含任何值）。
    const { endpoint, requestFingerprint } = (() => {
      if (request.operation === "todos") {
        return {
          endpoint: LEARNING_TODOS_URL,
          requestFingerprint: computeRequestFingerprint("GET", LEARNING_TODOS_URL)
        };
      }
      if (request.operation === "semesters") {
        return {
          endpoint: LEARNING_SEMESTERS_URL,
          requestFingerprint: computeRequestFingerprint(
            "GET",
            LEARNING_SEMESTERS_URL
          )
        };
      }
      if (request.operation === "courses") {
        if (!Number.isSafeInteger(request.page) || request.page < 1) {
          throw new ZjuUnifiedAuthError("invalid-input", "学在浙大课程页码无效。");
        }
        const url = new URL(LEARNING_COURSES_URL);
        // CampusOS keeps the reference request shape but widens its active-course filter
        // at the main-process adapter boundary to satisfy historical Materials browsing.
        url.searchParams.set("conditions", JSON.stringify(
          request.scope === "all"
            ? {
                status: ["ongoing", "notStarted", "closed"],
                keyword: "",
                classify_type: "all",
                display_studio_list: false
              }
            : {
                status: ["ongoing", "notStarted"],
                keyword: "",
                classify_type: "recently_started",
                display_studio_list: false
              }
        ));
        url.searchParams.set(
          "fields",
          "id,name,course_code,department(id,name),grade(id,name),klass(id,name),course_type,cover,small_cover,start_date,end_date,is_started,is_closed,academic_year_id,semester_id,credit,compulsory,second_name,display_name,created_user(id,name),org(is_enterprise_or_organization),org_id,public_scope,audit_status,audit_remark,can_withdraw_course,imported_from,allow_clone,is_instructor,is_team_teaching,is_default_course_cover,instructors(id,name,email,avatar_small_url),course_attributes(teaching_class_name,is_during_publish_period,copy_status,tip,data),user_stick_course_record(id),classroom_schedule"
        );
        url.searchParams.set("page", String(request.page));
        url.searchParams.set("page_size", "100");
        url.searchParams.set("showScorePassedStatus", "false");
        return {
          endpoint: url.href,
          // 指纹只含查询参数名（静态结构），不含参数值。
          requestFingerprint: computeRequestFingerprint("GET", url.href, [
            "conditions",
            "fields",
            "page",
            "page_size",
            "showScorePassedStatus"
          ])
        };
      }
      if (!/^[1-9]\d*$/.test(request.courseId)) {
        throw new ZjuUnifiedAuthError("invalid-input", "学在浙大课程标识无效。");
      }
      // 路径中的动态 courseId 归一化为 {courseId}，避免课程列表变化引发上游变化误报。
      return {
        endpoint: `https://courses.zju.edu.cn/api/courses/${request.courseId}/activities`,
        requestFingerprint: computeRequestFingerprint(
          "GET",
          "https://courses.zju.edu.cn/api/courses/{courseId}/activities"
        )
      };
    })();

    const username = credentials.username.trim();
    // Only the first expired response can continue; every later path exits.
    for (let attempt = 0; ; attempt += 1) {
      const session = await this.#getSession(credentials);
      const response = await this.#requestEndpoint(session, endpoint);

      const redirected = isRedirect(response.status);
      const expired =
        response.status === 401 ||
        response.status === 403 ||
        redirected ||
        serviceBodyIndicatesExpiredSession(response.body);
      if (expired && attempt === 0) {
        this.#sessions.delete(username);
        continue;
      }
      if (expired) {
        throw new ZjuUnifiedAuthError(
          "service-verification-failed",
          "学在浙大业务会话已失效，重新认证后仍无法访问。",
          { statusCode: response.status }
        );
      }

      validateStatus(response, "学在浙大业务接口");
      return { status: response.status, body: response.body, requestFingerprint };
    }
  }

  async requestDownload(
    credentials: ZjuAuthCredentials,
    request: ZjuLearningDownloadRequest
  ): Promise<Response> {
    if (!/^[1-9]\d*$/.test(request.uploadId) ||
      !/^[1-9]\d*$/.test(request.referenceId)) {
      throw new ZjuUnifiedAuthError(
        "invalid-input",
        "学在浙大课件标识无效。"
      );
    }

    const referenceUrl =
      `https://courses.zju.edu.cn/api/uploads/reference/${request.referenceId}/blob`;
    const fallbackUrl =
      `https://courses.zju.edu.cn/api/uploads/${request.uploadId}/blob`;
    const username = credentials.username.trim();
    let reauthenticated = false;
    let delayMs = 100;

    // zju-learning-assistant src-tauri/src/zju_assist.rs:452-479 requests the
    // reference blob first, then the upload blob, with five exponential retries.
    // CampusOS returns the stream to its download engine instead of writing here.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const session = await this.#getSession(credentials);
      const requestEndpoint = (url: string) => this.#downloadTransport({
        method: "GET",
        url,
        signal: request.signal,
        headers: {
          "User-Agent": ZJU_BROWSER_USER_AGENT,
          ...(session.header(url) ? { Cookie: session.header(url)! } : {}),
          ...(request.range ? { Range: request.range } : {})
        }
      });

      let response = await requestEndpoint(referenceUrl);
      if (!response.ok) {
        await response.body?.cancel();
        response = await requestEndpoint(fallbackUrl);
      }

      const expired = response.status === 401 ||
        response.status === 403 ||
        isRedirect(response.status);
      if (expired && !reauthenticated) {
        await response.body?.cancel();
        this.#sessions.delete(username);
        reauthenticated = true;
        continue;
      }
      if (response.ok || attempt === 4 || expired) return response;

      await response.body?.cancel();
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }

    throw new ZjuUnifiedAuthError(
      "service-verification-failed",
      "学在浙大课件下载请求失败。"
    );
  }
}
