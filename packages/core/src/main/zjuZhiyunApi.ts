/*
 * 智云课堂（classroom.zju.edu.cn）family of the ZJU unified-auth client.
 *
 * 对照实现：PeiPei233/zju-learning-assistant（MIT）
 *   - 登录桥 src-tauri/src/zju_assist.rs:244-320（CAS 登录后 GET
 *     tgmedia.cmc.zju.edu.cn/index.php?r=auth/login&auType=cmc&tenant_code=112&forward=…）
 *   - `_token` 提取 src-tauri/src/zju_assist.rs:535-555（cookie 值 percent-decode 后取
 *     内层 `_token` 字段）
 *   - 课程接口 src-tauri/src/zju_assist.rs:568-610 / :612-668（带
 *     `Authorization: Bearer <token>` 调 `courseapi/v2/course-live/get-my-course-*`）
 * 站点自身前端（classroom.zju.edu.cn `static/js/app.*.js`）用的是同一批端点与同一个
 * `getToken()` 取法，说明这套契约仍在服役。
 *
 * CampusOS 的机械适配：HTTP/CAS 由核心统一认证客户端注入；这里只负责登录桥跳转、
 * 会话缓存与响应解析，解析函数是纯函数以便离线测试。
 */
import { ZHIYUN_API_TIMEOUT_MS, ZHIYUN_MY_COURSES_DAY_URL, ZHIYUN_MY_COURSES_MONTH_URL, ZHIYUN_SERVICE_HOME_URL, ZHIYUN_SSO_BRIDGE_URL, ZHIYUN_SUB_INFO_URL } from "./zjuAuthConfig";
import { ZjuUnifiedAuthError } from "./zjuAuthContracts";
import type { ZjuAuthCredentials, ZjuZhiyunServiceRequest, ZjuZhiyunServiceResponse } from "./zjuAuthContracts";
import { CookieJar, cookieValueFromHeader, getHeader, getHeaderValues } from "./zjuAuthCookies";
import { isRedirect, resolveZhiyunRedirect, serviceBodyIndicatesExpiredSession, validateStatus } from "./zjuAuthParsing";
import type { ZjuAuthRequestHost } from "./zjuAuthHost";
import type { ZhiyunCourseEntry } from "@campusos/shared";

export interface ZjuZhiyunSession {
  cookies: CookieJar;
  token: string;
}

const ZHIYUN_TOKEN_PATTERN = /\{i:\d+;s:\d+:"_token";i:\d+;s:\d+:"(.+?)";\}/;

/** 从 `_token` cookie 里取出接口要用的 Bearer token。 */
export const extractZhiyunToken = (cookieHeader: string | null): string | null => {
  const raw = cookieValueFromHeader(cookieHeader, "_token");
  if (!raw) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // 未编码或被截断的 cookie 直接按原文匹配，交给正则判定失败。
  }
  return ZHIYUN_TOKEN_PATTERN.exec(decoded)?.[1] ?? null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asText = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
};

const collectCourses = (
  value: unknown,
  observedDay: string | null,
  entries: Map<string, ZhiyunCourseEntry>
): void => {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const courseId = asText(record.id);
    const subId = asText(record.sub_id);
    const courseName = asText(record.title);
    if (!courseId || !subId || !courseName) continue;
    entries.set(`${courseId}\n${subId}`, {
      courseId,
      subId,
      courseName,
      subTitle: asText(record.sub_title),
      teacher: asText(record.realname),
      tenantCode: asText(record.tenant_code),
      observedDay
    });
  }
};

/**
 * 解析 `get-my-course-day|month` 的响应。
 * 两个端点的外壳不同（按天是 `list` 对象、按月是 `list` 数组），课程条目本身同构；
 * 同一门课在多天出现时按 course_id + sub_id 去重。
 */
export const parseZhiyunCourseListing = (
  body: string,
  observedDay: string | null
): ZhiyunCourseEntry[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const list = asRecord(parsed)?.list;
  const entries = new Map<string, ZhiyunCourseEntry>();
  if (Array.isArray(list)) {
    for (const bucket of list) collectCourses(asRecord(bucket)?.course, observedDay, entries);
  } else {
    const buckets = asRecord(list);
    if (buckets) {
      for (const bucket of Object.values(buckets)) {
        collectCourses(asRecord(bucket)?.course, observedDay, entries);
      }
    }
  }
  return [...entries.values()];
};

/**
 * 智云前端把用户送进回放页之前，要求节次的 `sub_status` 等于这个值（源码里写作
 * `if (6 == e.sub_status) window.open(replay)`）。其它取值对应「回放生成中」「该节次
 * 没有视频」等提示，都不会跳转。
 */
const ZHIYUN_PLAYABLE_SUB_STATUS = "6";

export interface ZhiyunSubInfo {
  /** 智云自己用来判断能不能进回放页的节次状态；取不到时为 null。 */
  subStatus: string | null;
  /** `content.save_playback.contents` 里的可播放条目数。 */
  playbackCount: number;
  /**
   * 这个节次现在能不能进回放页：与智云前端一致——`sub_status == 6`（回放已就绪），
   * 或者已经存在可播放条目。两者都不满足时打开回放页只会看到「不在回放内」。
   */
  playable: boolean;
}

/** 解析 `get-sub-info` 的响应；只取可播放性，不保留任何课程内容。 */
export const parseZhiyunSubInfo = (body: string): ZhiyunSubInfo => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { subStatus: null, playbackCount: 0, playable: false };
  }
  const data = asRecord(asRecord(parsed)?.data);
  const subStatus = asText(data?.sub_status);
  const contents = asRecord(asRecord(data?.content)?.save_playback)?.contents;
  const playbackCount = Array.isArray(contents) ? contents.length : 0;
  return {
    subStatus,
    playbackCount,
    playable: subStatus === ZHIYUN_PLAYABLE_SUB_STATUS || playbackCount > 0
  };
};

export class ZjuZhiyunApi {
  readonly #host: ZjuAuthRequestHost;
  readonly #sessions = new Map<string, ZjuZhiyunSession>();
  readonly #pendingSessions = new Map<string, Promise<ZjuZhiyunSession>>();

  constructor(host: ZjuAuthRequestHost) {
    this.#host = host;
  }

  clear(): void {
    this.#sessions.clear();
    this.#pendingSessions.clear();
  }

  setSession(username: string, session: ZjuZhiyunSession): void {
    this.#sessions.set(username, session);
  }

  connectWithRetry(casCookies: CookieJar): Promise<ZjuZhiyunSession> {
    return this.#connectWithRetry(casCookies);
  }

  /** 按天/按月拉取当前账号的智云课程（含 sub_id）。 */
  async requestService(
    credentials: ZjuAuthCredentials,
    request: ZjuZhiyunServiceRequest
  ): Promise<ZjuZhiyunServiceResponse> {
    const username = credentials.username.trim();
    let session = await this.#getSession(credentials);
    try {
      return await this.#requestCourses(session, request);
    } catch (error) {
      // 业务会话失效时清掉缓存重新走一次登录桥；其它错误原样抛出。
      if (
        error instanceof ZjuUnifiedAuthError &&
        error.code === "service-verification-failed"
      ) {
        this.#sessions.delete(username);
        session = await this.#getSession(credentials);
        return await this.#requestCourses(session, request);
      }
      throw error;
    }
  }

  async #requestCourses(
    session: ZjuZhiyunSession,
    request: ZjuZhiyunServiceRequest
  ): Promise<ZjuZhiyunServiceResponse> {
    const url = request.operation === "my-courses-day"
      ? `${ZHIYUN_MY_COURSES_DAY_URL}?day=${encodeURIComponent(request.day)}`
      : request.operation === "my-courses-month"
        ? `${ZHIYUN_MY_COURSES_MONTH_URL}?month=${encodeURIComponent(request.month)}`
        : `${ZHIYUN_SUB_INFO_URL}?course_id=${encodeURIComponent(request.courseId)}&sub_id=${encodeURIComponent(request.subId)}`;
    const response = await this.#host.request("GET", url, {
      cookie: session.cookies.header(url),
      minimalHeaders: true,
      headers: { Authorization: `Bearer ${session.token}` },
      timeoutMs: ZHIYUN_API_TIMEOUT_MS
    });
    session.cookies.store(url, getHeaderValues(response.headers, "set-cookie"));
    if (
      response.status === 401 ||
      response.status === 403 ||
      serviceBodyIndicatesExpiredSession(response.body)
    ) {
      throw new ZjuUnifiedAuthError(
        "service-verification-failed",
        "智云课堂登录态已失效，请稍后重试。",
        { statusCode: response.status }
      );
    }
    validateStatus(response, "智云课堂课程接口");
    return { status: response.status, body: response.body };
  }

  async #connect(casCookies: CookieJar): Promise<ZjuZhiyunSession> {
    const cookies = casCookies.createSsoScopedSessionJar();
    let current = new URL(ZHIYUN_SSO_BRIDGE_URL);

    for (let hop = 0; hop < 15; hop += 1) {
      const response = await this.#host.request("GET", current.href, {
        cookie: cookies.header(current.href),
        minimalHeaders: true,
        headers: {},
        timeoutMs: ZHIYUN_API_TIMEOUT_MS
      });
      cookies.store(current.href, getHeaderValues(response.headers, "set-cookie"));

      if (isRedirect(response.status)) {
        const location = getHeader(response.headers, "location");
        if (!location) {
          throw new ZjuUnifiedAuthError(
            "protocol-error",
            "智云课堂登录跳转缺少目标地址。",
            { statusCode: response.status }
          );
        }
        current = resolveZhiyunRedirect(location, current);
        continue;
      }

      const success = response.status >= 200 && response.status < 300;
      const token = success
        ? extractZhiyunToken(cookies.header(ZHIYUN_SERVICE_HOME_URL))
        : null;
      if (success && token) {
        return { cookies, token };
      }

      if (
        response.status === 401 ||
        response.status === 403 ||
        (current.hostname === "zjuam.zju.edu.cn" &&
          current.pathname.startsWith("/cas/login")) ||
        serviceBodyIndicatesExpiredSession(response.body)
      ) {
        throw new ZjuUnifiedAuthError(
          "service-verification-failed",
          "统一认证登录态未能建立智云课堂业务会话。",
          { statusCode: response.status }
        );
      }

      validateStatus(response, "智云课堂登录");
      throw new ZjuUnifiedAuthError(
        "service-verification-failed",
        "智云课堂没有签发可访问课程接口的业务会话。",
        { statusCode: response.status }
      );
    }

    throw new ZjuUnifiedAuthError(
      "protocol-error",
      "智云课堂登录跳转次数超过安全上限。"
    );
  }

  async #connectWithRetry(casCookies: CookieJar): Promise<ZjuZhiyunSession> {
    // 与学在浙大族一致：瞬时的超时/网络错误重试一次，其它错误直接抛出。
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

    throw new ZjuUnifiedAuthError(
      "service-verification-failed",
      "智云课堂业务会话建立失败。"
    );
  }

  async #getSession(credentials: ZjuAuthCredentials): Promise<ZjuZhiyunSession> {
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
}
