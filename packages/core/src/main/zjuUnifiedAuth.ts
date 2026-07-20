const ZJU_AUTH_LOGIN_URL = "https://zjuam.zju.edu.cn/cas/login";
const ZJU_AUTH_PUBLIC_KEY_URL =
  "https://zjuam.zju.edu.cn/cas/v2/getPubKey";
const UNDERGRADUATE_ACADEMIC_SERVICE_URL =
  "https://zdbk.zju.edu.cn/jwglxt/xtgl/login_ssologin.html";
const UNDERGRADUATE_TIMETABLE_URL =
  "https://zdbk.zju.edu.cn/jwglxt/kbcx/xskbcx_cxXsKb.html";
const UNDERGRADUATE_EXAMS_URL =
  "https://zdbk.zju.edu.cn/jwglxt/xskscx/kscx_cxXsgrksIndex.html?doType=query&queryModel.showCount=5000";
const UNDERGRADUATE_GRADES_URL =
  "https://zdbk.zju.edu.cn/jwglxt/cxdy/xscjcx_cxXscjIndex.html?doType=query&queryModel.showCount=5000";
const GRADUATE_ACADEMIC_SERVICE_URL = "https://yjsy.zju.edu.cn/";
const GRADUATE_VALIDATE_LOGIN_URL =
  "https://yjsy.zju.edu.cn/dataapi/sys/cas/client/validateLogin";
const GRADUATE_TIMETABLE_URL =
  "https://yjsy.zju.edu.cn/dataapi/py/pyKcbj/queryXskbByLoginUser";
const GRADUATE_EXAMS_URL =
  "https://yjsy.zju.edu.cn/dataapi/py/pyKsxsxx/queryPageByXs";
const GRADUATE_GRADES_URL =
  "https://yjsy.zju.edu.cn/dataapi/py/pyXsxk/queryXsxkByXnxqXs";
const LEARNING_SERVICE_HOME_URL = "https://courses.zju.edu.cn/user/index";
const LEARNING_TODOS_URL = "https://courses.zju.edu.cn/api/todos";
const QUALITY_DEVELOPMENT_SERVICE_URL = "https://sztz.zju.edu.cn/dekt/";
const QUALITY_DEVELOPMENT_CONTEXT_URL =
  "https://sztz.zju.edu.cn/dekt/ctx";
const QUALITY_DEVELOPMENT_PROFILE_URL =
  "https://sztz.zju.edu.cn/dekt/student/home/getMyInfo";
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_LENGTH = 1_048_576;

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
  | { operation: "grades" };

export interface ZjuUndergraduateServiceResponse {
  status: number;
  body: string;
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
}

export type ZjuLearningServiceRequest = { operation: "todos" };

export interface ZjuLearningServiceResponse {
  status: number;
  body: string;
}

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

interface ZjuUnifiedAuthClientOptions {
  transport?: ZjuAuthTransport;
  timeoutMs?: number;
  now?: () => Date;
}

interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  expiresAt: number | null;
}

const getHeaderValues = (
  headers: ZjuAuthHttpResponse["headers"],
  name: string
): readonly string[] => {
  const entry = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === name.toLowerCase()
  )?.[1];

  if (entry === undefined) {
    return [];
  }

  return typeof entry === "string" ? [entry] : entry;
};

const getHeader = (
  headers: ZjuAuthHttpResponse["headers"],
  name: string
): string | null => getHeaderValues(headers, name)[0] ?? null;

const defaultCookiePath = (url: URL): string => {
  const finalSlash = url.pathname.lastIndexOf("/");

  if (finalSlash <= 0) {
    return "/";
  }

  return url.pathname.slice(0, finalSlash + 1);
};

const domainMatches = (hostname: string, domain: string): boolean =>
  hostname === domain || hostname.endsWith(`.${domain}`);

const pathMatches = (requestPath: string, cookiePath: string): boolean =>
  requestPath === cookiePath ||
  (requestPath.startsWith(cookiePath) &&
    (cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/"));

class CookieJar {
  readonly #cookies = new Map<string, StoredCookie>();

  store(urlValue: string, setCookieHeaders: readonly string[]): void {
    const url = new URL(urlValue);

    for (const setCookie of setCookieHeaders) {
      const segments = setCookie.split(";");
      const nameValue = segments.shift()?.trim() ?? "";
      const separator = nameValue.indexOf("=");

      if (separator <= 0) {
        continue;
      }

      const name = nameValue.slice(0, separator).trim();
      const value = nameValue.slice(separator + 1).trim();
      let domain = url.hostname.toLowerCase();
      let hostOnly = true;
      let path = defaultCookiePath(url);
      let secure = false;
      let expiresAt: number | null = null;
      let deleteCookie = value.length === 0;

      for (const segment of segments) {
        const attribute = segment.trim();
        const attributeSeparator = attribute.indexOf("=");
        const attributeName = (
          attributeSeparator === -1
            ? attribute
            : attribute.slice(0, attributeSeparator)
        ).toLowerCase();
        const attributeValue =
          attributeSeparator === -1
            ? ""
            : attribute.slice(attributeSeparator + 1).trim();

        if (attributeName === "domain" && attributeValue) {
          const candidate = attributeValue.replace(/^\./, "").toLowerCase();
          if (domainMatches(url.hostname.toLowerCase(), candidate)) {
            domain = candidate;
            hostOnly = false;
          }
        } else if (attributeName === "path" && attributeValue.startsWith("/")) {
          path = attributeValue;
        } else if (attributeName === "secure") {
          secure = true;
        } else if (attributeName === "max-age") {
          const maxAge = Number.parseInt(attributeValue, 10);
          if (Number.isFinite(maxAge)) {
            deleteCookie ||= maxAge <= 0;
            expiresAt = Date.now() + maxAge * 1_000;
          }
        } else if (attributeName === "expires" && expiresAt === null) {
          const parsed = Date.parse(attributeValue);
          if (Number.isFinite(parsed)) {
            expiresAt = parsed;
            deleteCookie ||= parsed <= Date.now();
          }
        }
      }

      const key = `${domain}\n${path}\n${name}`;
      if (deleteCookie) {
        this.#cookies.delete(key);
        continue;
      }

      this.#cookies.set(key, {
        name,
        value,
        domain,
        hostOnly,
        path,
        secure,
        expiresAt
      });
    }
  }

  header(urlValue: string): string | null {
    const url = new URL(urlValue);
    const hostname = url.hostname.toLowerCase();
    const now = Date.now();
    const matching: StoredCookie[] = [];

    for (const [key, cookie] of this.#cookies) {
      if (cookie.expiresAt !== null && cookie.expiresAt <= now) {
        this.#cookies.delete(key);
        continue;
      }

      const matchesDomain = cookie.hostOnly
        ? hostname === cookie.domain
        : domainMatches(hostname, cookie.domain);
      if (
        matchesDomain &&
        pathMatches(url.pathname, cookie.path) &&
        (!cookie.secure || url.protocol === "https:")
      ) {
        matching.push(cookie);
      }
    }

    if (matching.length === 0) {
      return null;
    }

    return matching
      .sort((left, right) => right.path.length - left.path.length)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  }

  has(name: string): boolean {
    const now = Date.now();
    return [...this.#cookies.values()].some(
      (cookie) =>
        cookie.name === name &&
        (cookie.expiresAt === null || cookie.expiresAt > now) &&
        cookie.value.length > 0
    );
  }
}

const cookieHeaderHasName = (
  header: string | null,
  expectedName: string
): boolean =>
  header
    ?.split(";")
    .some((entry) => entry.trim().startsWith(`${expectedName}=`)) ?? false;

const splitCombinedSetCookieHeader = (value: string): string[] =>
  value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map((item) => item.trim());

export const createFetchZjuAuthTransport = (
  fetchImplementation: typeof fetch = globalThis.fetch
): ZjuAuthTransport => {
  if (typeof fetchImplementation !== "function") {
    throw new ZjuUnifiedAuthError(
      "network-error",
      "当前运行环境不支持安全网络请求。"
    );
  }

  return async (request) => {
    const response = await fetchImplementation(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "manual",
      signal: request.signal
    });
    const contentLength = Number.parseInt(
      response.headers.get("content-length") ?? "0",
      10
    );

    if (contentLength > MAX_RESPONSE_LENGTH) {
      throw new ZjuUnifiedAuthError(
        "protocol-error",
        "统一认证服务返回了超出限制的响应。",
        { statusCode: response.status }
      );
    }

    const body = await response.text();
    if (body.length > MAX_RESPONSE_LENGTH) {
      throw new ZjuUnifiedAuthError(
        "protocol-error",
        "统一认证服务返回了超出限制的响应。",
        { statusCode: response.status }
      );
    }

    const headers: Record<string, string | readonly string[]> = {};
    const location = response.headers.get("location");
    const contentType = response.headers.get("content-type");
    if (location) headers.location = location;
    if (contentType) headers["content-type"] = contentType;

    const headersWithSetCookie = response.headers as Headers & {
      getSetCookie?: () => string[];
    };
    const setCookieHeaders = headersWithSetCookie.getSetCookie?.() ?? [];
    const combinedSetCookie = response.headers.get("set-cookie");
    if (setCookieHeaders.length > 0) {
      headers["set-cookie"] = setCookieHeaders;
    } else if (combinedSetCookie) {
      headers["set-cookie"] = splitCombinedSetCookieHeader(combinedSetCookie);
    }

    return {
      status: response.status,
      headers,
      body
    };
  };
};

const decodeHtmlAttribute = (value: string): string =>
  value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    );

const readHtmlAttribute = (tag: string, attributeName: string): string | null => {
  const match = new RegExp(
    `(?:^|\\s)${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  ).exec(tag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? null : decodeHtmlAttribute(value);
};

const findExecution = (html: string): string | null => {
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    if (readHtmlAttribute(match[0], "name") === "execution") {
      return readHtmlAttribute(match[0], "value");
    }
  }

  return null;
};

const modularExponentiation = (
  baseValue: bigint,
  exponentValue: bigint,
  modulusValue: bigint
): bigint => {
  let base = baseValue % modulusValue;
  let exponent = exponentValue;
  let result = 1n;

  while (exponent > 0n) {
    if (exponent % 2n === 1n) {
      result = (result * base) % modulusValue;
    }
    exponent /= 2n;
    base = (base * base) % modulusValue;
  }

  return result;
};

const encryptPassword = (
  password: string,
  modulusHex: string,
  exponentHex: string
): string => {
  if (!/^[0-9a-f]+$/i.test(modulusHex) || !/^[0-9a-f]+$/i.test(exponentHex)) {
    throw new ZjuUnifiedAuthError(
      "protocol-error",
      "统一认证 RSA 公钥格式无效。"
    );
  }

  const passwordHex = Buffer.from(password, "utf8").toString("hex");
  const passwordValue = BigInt(`0x${passwordHex}`);
  const modulusValue = BigInt(`0x${modulusHex}`);
  const exponentValue = BigInt(`0x${exponentHex}`);

  if (passwordValue >= modulusValue) {
    throw new ZjuUnifiedAuthError(
      "invalid-input",
      "密码长度超出统一认证接口当前支持的范围。"
    );
  }

  // ZJUAM currently requires its legacy textbook-RSA wire format.
  return modularExponentiation(passwordValue, exponentValue, modulusValue)
    .toString(16)
    .padStart(modulusHex.length, "0");
};

const isRedirect = (status: number): boolean =>
  status === 301 ||
  status === 302 ||
  status === 303 ||
  status === 307 ||
  status === 308;

const normalizeServiceCallback = (location: string): URL => {
  const callback = new URL(location, ZJU_AUTH_LOGIN_URL);
  if (
    callback.protocol === "http:" &&
    callback.hostname === "zdbk.zju.edu.cn"
  ) {
    callback.protocol = "https:";
  }
  return callback;
};

const validateServiceCallback = (callback: URL): void => {
  const expected = new URL(UNDERGRADUATE_ACADEMIC_SERVICE_URL);
  if (
    callback.protocol !== expected.protocol ||
    callback.hostname !== expected.hostname ||
    callback.port !== expected.port ||
    callback.pathname !== expected.pathname ||
    !callback.searchParams.get("ticket")
  ) {
    throw new ZjuUnifiedAuthError(
      "service-verification-failed",
      "统一认证没有返回有效的教务网一次性凭证。"
    );
  }
};

const validateQualityDevelopmentCallback = (callback: URL): void => {
  const expected = new URL(QUALITY_DEVELOPMENT_SERVICE_URL);
  if (
    callback.protocol !== expected.protocol ||
    callback.hostname !== expected.hostname ||
    callback.port !== expected.port ||
    callback.pathname !== expected.pathname ||
    !callback.searchParams.get("ticket")
  ) {
    throw new ZjuUnifiedAuthError(
      "service-verification-failed",
      "统一认证没有返回有效的素质拓展平台一次性凭证。"
    );
  }
};

const validateGraduateCallback = (callback: URL): string => {
  const expected = new URL(GRADUATE_ACADEMIC_SERVICE_URL);
  const ticket = callback.searchParams.get("ticket");
  if (
    callback.protocol !== expected.protocol ||
    callback.hostname !== expected.hostname ||
    callback.port !== expected.port ||
    callback.pathname !== expected.pathname ||
    !ticket
  ) {
    throw new ZjuUnifiedAuthError(
      "service-verification-failed",
      "统一认证没有返回有效的研究生院一次性凭证。"
    );
  }

  return ticket;
};

const parseJsonObject = (body: string): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(body) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const parseInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value, 10);
  }
  return null;
};

const containsAnonymousRole = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsAnonymousRole);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some(containsAnonymousRole);
  }
  return (
    typeof value === "string" &&
    value
      .split(/[\s,;]+/)
      .some((role) => role.trim() === "ANONYMOUS_USER_ROLE")
  );
};

const isAuthenticatedQualityContext = (body: string): boolean => {
  const envelope = parseJsonObject(body);
  if (
    envelope?.success !== true ||
    parseInteger(envelope.code) !== 0 ||
    typeof envelope.data !== "string" ||
    envelope.data.length === 0
  ) {
    return false;
  }

  try {
    const context = parseJsonObject(
      Buffer.from(envelope.data, "base64").toString("utf8")
    );
    const userId = context?.userId;
    return (
      context?.anonymous === false &&
      typeof userId === "string" &&
      userId.trim().length > 0 &&
      userId.trim().toUpperCase() !== "ANONYMOUS" &&
      !containsAnonymousRole(context.roles)
    );
  } catch {
    return false;
  }
};

const parsePracticePoints = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = typeof value === "number" ? value :
    typeof value === "string" ? Number(value.trim()) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const parseAuthenticatedProfile = (
  body: string,
  expectedStudentId: string,
  fetchedAt: string
): ZjuAuthenticatedProfile => {
  const envelope = parseJsonObject(body);
  const extend =
    typeof envelope?.extend === "object" &&
    envelope.extend !== null &&
    !Array.isArray(envelope.extend)
      ? (envelope.extend as Record<string, unknown>)
      : null;
  const myInfo =
    typeof extend?.myInfo === "object" &&
    extend.myInfo !== null &&
    !Array.isArray(extend.myInfo)
      ? (extend.myInfo as Record<string, unknown>)
      : null;
  const studentId =
    typeof myInfo?.xh === "string"
      ? myInfo.xh.trim()
      : typeof myInfo?.xh === "number" && Number.isSafeInteger(myInfo.xh)
        ? String(myInfo.xh)
        : "";
  const hasPointField = ["dektJf", "dsktJf", "dsiktJf"].some(
    (field) => myInfo !== null && Object.hasOwn(myInfo, field)
  );
  const secondClassPoints = parsePracticePoints(myInfo?.dektJf);
  const thirdClassPoints = parsePracticePoints(myInfo?.dsktJf);
  const fourthClassPoints = parsePracticePoints(myInfo?.dsiktJf);

  if (
    parseInteger(envelope?.code) !== 0 ||
    !myInfo ||
    studentId !== expectedStudentId ||
    !hasPointField ||
    secondClassPoints === null ||
    thirdClassPoints === null ||
    fourthClassPoints === null
  ) {
    throw new ZjuUnifiedAuthError(
      "service-verification-failed",
      "素质拓展平台没有返回与当前账号一致的有效业务数据。"
    );
  }

  return {
    source: "zju-quality-development",
    studentId,
    secondClassPoints,
    thirdClassPoints,
    fourthClassPoints,
    fetchedAt
  };
};

const parseGraduateAuthenticatedProfile = (
  body: string,
  studentId: string,
  fetchedAt: string
): ZjuAuthenticatedProfile => {
  const envelope = parseJsonObject(body);
  const result =
    typeof envelope?.result === "object" &&
    envelope.result !== null &&
    !Array.isArray(envelope.result)
      ? envelope.result as Record<string, unknown>
      : null;
  const records = result?.xxjhnList;
  if (!Array.isArray(records)) {
    throw new ZjuUnifiedAuthError(
      "service-verification-failed",
      "研究生院没有返回有效的认证后成绩数据结构。"
    );
  }

  return {
    source: "zju-graduate-academic-affairs",
    studentId,
    verifiedDataset: "graduate-grades",
    recordCount: records.length,
    fetchedAt
  };
};

const validateStatus = (
  response: ZjuAuthHttpResponse,
  context: string,
  expectedStatus = 200
): void => {
  if (response.status === expectedStatus) {
    return;
  }

  const unavailable = response.status === 429 || response.status >= 500;
  throw new ZjuUnifiedAuthError(
    unavailable ? "service-unavailable" : "protocol-error",
    unavailable
      ? `${context}暂时不可用，请稍后重试。`
      : `${context}返回了无法识别的状态。`,
    { statusCode: response.status }
  );
};

const LEARNING_REDIRECT_HOSTS = new Set([
  "courses.zju.edu.cn",
  "identity.zju.edu.cn",
  "zjuam.zju.edu.cn"
]);

const validateLearningRedirect = (target: URL): void => {
  if (
    target.protocol !== "https:" ||
    !LEARNING_REDIRECT_HOSTS.has(target.hostname.toLowerCase())
  ) {
    throw new ZjuUnifiedAuthError(
      "protocol-error",
      "学在浙大登录返回了不受信任的跳转地址。"
    );
  }
};

const resolveLearningRedirect = (value: string, source: URL): URL => {
  let target: URL;
  try {
    target = new URL(value, source);
  } catch {
    throw new ZjuUnifiedAuthError(
      "protocol-error",
      "学在浙大登录返回了无法解析的跳转地址。"
    );
  }
  validateLearningRedirect(target);
  return target;
};

const findLearningMetaRefreshTarget = (
  body: string,
  sourceUrl: string
): URL | null => {
  const source = new URL(sourceUrl);
  for (const match of body.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/http-equiv\s*=\s*["']?refresh/i.test(tag)) continue;

    const contentMatch = tag.match(
      /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
    );
    const content = decodeHtmlAttribute(
      contentMatch?.[1] ?? contentMatch?.[2] ?? contentMatch?.[3] ?? ""
    );
    const targetMatch = content.match(/\burl\s*=\s*["']?([^"';\s>]+)/i);
    if (!targetMatch) continue;

    return resolveLearningRedirect(targetMatch[1], source);
  }
  return null;
};

const serviceBodyIndicatesExpiredSession = (body: string): boolean => {
  if (
    /^\s*</.test(body) &&
    /<input[^>]+name=["'](?:execution|username|password)["']|统一身份认证|请先登录|登录已失效|unauthorized/i.test(
      body
    )
  ) {
    return true;
  }

  try {
    const payload = JSON.parse(body) as Record<string, unknown>;
    const code = Number(payload.code ?? payload.status);
    const kickout = Number(payload.kickout);
    const success = payload.success;
    const message = [payload.message, payload.msg, payload.error]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    const authenticationMessage =
      /token|登录|认证|过期|unauthorized|kickout/i.test(message);
    return (
      kickout === 1 ||
      code === 401 ||
      code === 403 ||
      (authenticationMessage &&
        (success === false || (Number.isFinite(code) && code !== 0 && code !== 200)))
    );
  } catch {
    return false;
  }
};

class ZjuUnifiedAuthClient {
  readonly #transport: ZjuAuthTransport;
  readonly #timeoutMs: number;
  readonly #now: () => Date;
  readonly #undergraduateSessions = new Map<string, CookieJar>();
  readonly #pendingUndergraduateSessions = new Map<
    string,
    Promise<CookieJar>
  >();
  readonly #learningSessions = new Map<string, CookieJar>();
  readonly #pendingLearningSessions = new Map<string, Promise<CookieJar>>();
  readonly #graduateSessions = new Map<string, string>();
  readonly #pendingGraduateSessions = new Map<string, Promise<string>>();

  constructor(options: ZjuUnifiedAuthClientOptions = {}) {
    this.#transport = options.transport ?? createFetchZjuAuthTransport();
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#now = options.now ?? (() => new Date());
  }

  async #request(
    method: "GET" | "POST",
    url: string,
    options: {
      body?: string;
      cookie?: string | null;
      headers?: Record<string, string>;
    } = {}
  ): Promise<ZjuAuthHttpResponse> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const headers: Record<string, string> = {
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      "Cache-Control": "no-store"
    };
    if (options.cookie) headers.Cookie = options.cookie;
    if (method === "POST") {
      headers["Content-Type"] =
        "application/x-www-form-urlencoded; charset=UTF-8";
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
      }, this.#timeoutMs);
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

  async #authenticateCas(
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

  async #connectUndergraduateSession(
    casCookies: CookieJar
  ): Promise<CookieJar> {
    const serviceLoginUrl = new URL(ZJU_AUTH_LOGIN_URL);
    serviceLoginUrl.searchParams.set(
      "service",
      UNDERGRADUATE_ACADEMIC_SERVICE_URL
    );
    const serviceResponse = await this.#request("GET", serviceLoginUrl.href, {
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
    const callbackResponse = await this.#request("GET", callback.href);
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

  async #getUndergraduateSession(
    credentials: ZjuAuthCredentials
  ): Promise<CookieJar> {
    const username = credentials.username.trim();
    const cached = this.#undergraduateSessions.get(username);
    if (cached) return cached;

    const pending = this.#pendingUndergraduateSessions.get(username);
    if (pending) return pending;

    const operation = this.#authenticateCas(credentials).then(
      async ({ username: authenticatedUsername, cookies }) => {
        const session = await this.#connectUndergraduateSession(cookies);
        this.#undergraduateSessions.set(authenticatedUsername, session);
        return session;
      }
    );
    this.#pendingUndergraduateSessions.set(username, operation);
    try {
      return await operation;
    } finally {
      if (this.#pendingUndergraduateSessions.get(username) === operation) {
        this.#pendingUndergraduateSessions.delete(username);
      }
    }
  }

  async #connectLearningSession(casCookies: CookieJar): Promise<CookieJar> {
    let current = new URL(LEARNING_SERVICE_HOME_URL);

    for (let hop = 0; hop < 15; hop += 1) {
      validateLearningRedirect(current);
      const response = await this.#request("GET", current.href, {
        cookie: casCookies.header(current.href)
      });
      casCookies.store(
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

      if (
        success &&
        current.hostname === "courses.zju.edu.cn" &&
        cookieHeaderHasName(casCookies.header(LEARNING_TODOS_URL), "session")
      ) {
        return casCookies;
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

  async #getLearningSession(
    credentials: ZjuAuthCredentials
  ): Promise<CookieJar> {
    const username = credentials.username.trim();
    const cached = this.#learningSessions.get(username);
    if (cached) return cached;

    const pending = this.#pendingLearningSessions.get(username);
    if (pending) return pending;

    const operation = this.#authenticateCas(credentials).then(
      async ({ username: authenticatedUsername, cookies }) => {
        const session = await this.#connectLearningSession(cookies);
        this.#learningSessions.set(authenticatedUsername, session);
        return session;
      }
    );
    this.#pendingLearningSessions.set(username, operation);
    try {
      return await operation;
    } finally {
      if (this.#pendingLearningSessions.get(username) === operation) {
        this.#pendingLearningSessions.delete(username);
      }
    }
  }

  async #connectGraduateSession(casCookies: CookieJar): Promise<string> {
    const serviceLoginUrl = new URL(ZJU_AUTH_LOGIN_URL);
    serviceLoginUrl.searchParams.set("service", GRADUATE_ACADEMIC_SERVICE_URL);
    const serviceResponse = await this.#request("GET", serviceLoginUrl.href, {
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
    const validateResponse = await this.#request("GET", validateUrl.href, {
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

  async #getGraduateSession(
    credentials: ZjuAuthCredentials
  ): Promise<string> {
    const username = credentials.username.trim();
    const cached = this.#graduateSessions.get(username);
    if (cached) return cached;

    const pending = this.#pendingGraduateSessions.get(username);
    if (pending) return pending;

    const operation = this.#authenticateCas(credentials).then(
      async ({ username: authenticatedUsername, cookies }) => {
        const token = await this.#connectGraduateSession(cookies);
        this.#graduateSessions.set(authenticatedUsername, token);
        return token;
      }
    );
    this.#pendingGraduateSessions.set(username, operation);
    try {
      return await operation;
    } finally {
      if (this.#pendingGraduateSessions.get(username) === operation) {
        this.#pendingGraduateSessions.delete(username);
      }
    }
  }

  async requestLearningService(
    credentials: ZjuAuthCredentials,
    request: ZjuLearningServiceRequest
  ): Promise<ZjuLearningServiceResponse> {
    if (request.operation !== "todos") {
      throw new ZjuUnifiedAuthError(
        "invalid-input",
        "学在浙大业务请求参数无效。"
      );
    }

    const username = credentials.username.trim();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = await this.#getLearningSession(credentials);
      const response = await this.#request("GET", LEARNING_TODOS_URL, {
        cookie: session.header(LEARNING_TODOS_URL),
        headers: {
          Accept: "application/json, text/plain, */*",
          Referer: LEARNING_SERVICE_HOME_URL,
          "X-Requested-With": "XMLHttpRequest"
        }
      });
      session.store(
        LEARNING_TODOS_URL,
        getHeaderValues(response.headers, "set-cookie")
      );

      const redirected = isRedirect(response.status);
      const expired =
        response.status === 401 ||
        response.status === 403 ||
        redirected ||
        serviceBodyIndicatesExpiredSession(response.body);
      if (expired && attempt === 0) {
        this.#learningSessions.delete(username);
        continue;
      }
      if (expired) {
        throw new ZjuUnifiedAuthError(
          "service-verification-failed",
          "学在浙大业务会话已失效，重新认证后仍无法访问。",
          { statusCode: response.status }
        );
      }

      validateStatus(response, "学在浙大作业接口");
      return { status: response.status, body: response.body };
    }

    throw new ZjuUnifiedAuthError(
      "service-verification-failed",
      "学在浙大业务会话建立失败。"
    );
  }

  async requestGraduateService(
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
    if (request.operation === "timetable") {
      requestUrl.searchParams.set("xn", String(request.academicYearStart));
      requestUrl.searchParams.set("pkxq", String(request.term));
    } else if (request.operation === "exams") {
      const fields = "id,,kcbh,kcmc,rq,ksTime,xn,xq_dictText,ksdd,zwh";
      const query = {
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
      for (const [name, value] of Object.entries(query)) {
        requestUrl.searchParams.set(name, value);
      }
    }

    const username = credentials.username.trim();
    const method = request.operation === "grades" ? "POST" : "GET";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.#getGraduateSession(credentials);
      const response = await this.#request(method, requestUrl.href, {
        body: method === "POST" ? "" : undefined,
        headers: {
          Accept: "application/json, text/plain, */*",
          "X-Access-Token": token
        }
      });
      const expired = response.status === 401 || response.status === 403 ||
        serviceBodyIndicatesExpiredSession(response.body);
      if (expired && attempt === 0) {
        this.#graduateSessions.delete(username);
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
      return { status: response.status, body: response.body };
    }

    throw new ZjuUnifiedAuthError(
      "service-verification-failed",
      "研究生院业务会话建立失败。"
    );
  }

  async requestUndergraduateService(
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
        : UNDERGRADUATE_GRADES_URL;
    const requestBody =
      request.operation === "timetable"
        ? new URLSearchParams({
            xnm: String(request.academicYearStart),
            xqm: request.season,
            captcha_value: ""
          }).toString()
        : "";
    const requestContext = request.operation === "timetable"
      ? "教务网课表接口"
      : request.operation === "exams"
        ? "教务网考试接口"
        : "教务网成绩接口";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = await this.#getUndergraduateSession(credentials);
      const response = await this.#request("POST", requestUrl, {
        body: requestBody,
        cookie: session.header(requestUrl),
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          Referer:
            "https://zdbk.zju.edu.cn/jwglxt/xtgl/index_initMenu.html",
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
        this.#undergraduateSessions.delete(username);
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
      return { status: response.status, body: response.body };
    }

    throw new ZjuUnifiedAuthError(
      "service-verification-failed",
      "教务网会话建立失败。"
    );
  }

  clearServiceSessions(): void {
    this.#undergraduateSessions.clear();
    this.#pendingUndergraduateSessions.clear();
    this.#learningSessions.clear();
    this.#pendingLearningSessions.clear();
    this.#graduateSessions.clear();
    this.#pendingGraduateSessions.clear();
  }

  async authenticate(
    credentials: ZjuAuthCredentials & { program: AcademicProgram }
  ): Promise<ZjuAuthenticationResult> {
    const { username, cookies: casCookies } =
      await this.#authenticateCas(credentials);

    if (credentials.program === "graduate") {
      const token = await this.#connectGraduateSession(casCookies);
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
      this.#graduateSessions.set(username, token);
      return {
        provider: "zju-unified-auth",
        username,
        authenticatedAt,
        program: "graduate",
        verifiedService: "graduate-academic-affairs",
        authenticatedProfile
      };
    }

    const serviceCookies = await this.#connectUndergraduateSession(casCookies);
    this.#undergraduateSessions.set(username, serviceCookies);

    const qualityServiceLoginUrl = new URL(ZJU_AUTH_LOGIN_URL);
    qualityServiceLoginUrl.searchParams.set(
      "service",
      QUALITY_DEVELOPMENT_SERVICE_URL
    );
    const qualityServiceResponse = await this.#request(
      "GET",
      qualityServiceLoginUrl.href,
      { cookie: casCookies.header(qualityServiceLoginUrl.href) }
    );
    const qualityLocation = getHeader(
      qualityServiceResponse.headers,
      "location"
    );
    if (!isRedirect(qualityServiceResponse.status) || !qualityLocation) {
      throw new ZjuUnifiedAuthError(
        "service-verification-failed",
        "统一认证登录态未能通过素质拓展平台连接验证。",
        { statusCode: qualityServiceResponse.status }
      );
    }

    const qualityCallback = new URL(
      qualityLocation,
      QUALITY_DEVELOPMENT_SERVICE_URL
    );
    validateQualityDevelopmentCallback(qualityCallback);
    const qualityCallbackResponse = await this.#request(
      "GET",
      qualityCallback.href
    );
    const qualityCookies = new CookieJar();
    qualityCookies.store(
      qualityCallback.href,
      getHeaderValues(qualityCallbackResponse.headers, "set-cookie")
    );
    if (
      qualityCallbackResponse.status !== 200 ||
      !cookieHeaderHasName(
        qualityCookies.header(QUALITY_DEVELOPMENT_CONTEXT_URL),
        "SESSION"
      )
    ) {
      throw new ZjuUnifiedAuthError(
        "service-verification-failed",
        "素质拓展平台没有建立正式的已认证会话。",
        { statusCode: qualityCallbackResponse.status }
      );
    }

    const contextResponse = await this.#request(
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

    const profileResponse = await this.#request(
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
    const authenticatedAt = this.#now().toISOString();
    const authenticatedProfile = parseAuthenticatedProfile(
      profileResponse.body,
      username,
      authenticatedAt
    );

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

export const createZjuUnifiedAuthClient = (
  options: ZjuUnifiedAuthClientOptions = {}
): ZjuUnifiedAuthClient => new ZjuUnifiedAuthClient(options);
import type {
  AcademicAuthenticatedProfile,
  AcademicProgram
} from "../shared/credentialBridge";
