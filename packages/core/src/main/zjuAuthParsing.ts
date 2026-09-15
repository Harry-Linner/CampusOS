import { GRADUATE_ACADEMIC_SERVICE_URL, QUALITY_DEVELOPMENT_SERVICE_URL, UNDERGRADUATE_ACADEMIC_SERVICE_URL, ZJU_AUTH_LOGIN_URL } from "./zjuAuthConfig";
import { ZjuUnifiedAuthError } from "./zjuAuthContracts";
import type { ZjuAuthHttpResponse, ZjuAuthenticatedProfile } from "./zjuAuthContracts";
/*
 * Parsing, validation and encryption helpers of the ZJU unified-auth client.
 *
 * Moved out of zjuUnifiedAuth.ts. These are
 * the pure functions: HTML/JSON parsing, redirect and callback validation, session-expiry
 * detection, and the CAS password encryption.
 */

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

export const findExecution = (html: string): string | null => {
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

export const encryptPassword = (
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

export const isRedirect = (status: number): boolean =>
  status === 301 ||
  status === 302 ||
  status === 303 ||
  status === 307 ||
  status === 308;

export const normalizeServiceCallback = (location: string): URL => {
  const callback = new URL(location, ZJU_AUTH_LOGIN_URL);
  if (
    callback.protocol === "http:" &&
    callback.hostname === "zdbk.zju.edu.cn"
  ) {
    callback.protocol = "https:";
  }
  return callback;
};

export const validateServiceCallback = (callback: URL): void => {
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

export const validateQualityDevelopmentCallback = (callback: URL): void => {
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

export const validateGraduateCallback = (callback: URL): string => {
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

export const parseJsonObject = (body: string): Record<string, unknown> | null => {
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

export const isAuthenticatedQualityContext = (body: string): boolean => {
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

export const parseAuthenticatedProfile = (
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

export const parseGraduateAuthenticatedProfile = (
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

export const validateStatus = (
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

export const validateLearningRedirect = (target: URL): void => {
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

export const resolveLearningRedirect = (value: string, source: URL): URL => {
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

// 智云课堂登录链路上真实出现过的浙大主机：SSO 登录桥（tgmedia）签发后会把登录态
// 交回课堂门户（classroom）与其 CMC API（yjapi）；CAS 自身也允许出现。
const ZHIYUN_REDIRECT_HOSTS = new Set([
  "classroom.zju.edu.cn",
  "tgmedia.cmc.zju.edu.cn",
  "yjapi.cmc.zju.edu.cn",
  "zjuam.zju.edu.cn",
  "identity.zju.edu.cn"
]);

export const validateZhiyunRedirect = (target: URL): void => {
  if (
    target.protocol !== "https:" ||
    !ZHIYUN_REDIRECT_HOSTS.has(target.hostname.toLowerCase())
  ) {
    throw new ZjuUnifiedAuthError(
      "protocol-error",
      "智云课堂登录返回了不受信任的跳转地址。"
    );
  }
};

export const resolveZhiyunRedirect = (value: string, source: URL): URL => {
  let target: URL;
  try {
    target = new URL(value, source);
  } catch {
    throw new ZjuUnifiedAuthError(
      "protocol-error",
      "智云课堂登录返回了无法解析的跳转地址。"
    );
  }
  validateZhiyunRedirect(target);
  return target;
};

export const findLearningMetaRefreshTarget = (
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

export const serviceBodyIndicatesExpiredSession = (body: string): boolean => {
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
