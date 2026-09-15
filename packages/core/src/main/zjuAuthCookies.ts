import { LEARNING_TODOS_URL } from "./zjuAuthConfig";
import type { ZjuAuthHttpResponse } from "./zjuAuthContracts";
/*
 * Cookie jar and header helpers of the ZJU unified-auth client.
 *
 * Moved verbatim out of zjuUnifiedAuth.ts in batch 43 of the ADR-0006 program.
 * Celechron's Dart implementation keeps the same rules (domain/path matching, splitting a
 * combined Set-Cookie header), so the behaviour here mirrors lib/http/zjuServices.
 */

interface StoredCookie {
  name: string;
  value: string;
  sourceHost: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  expiresAt: number | null;
}

export interface ActiveCasSession {
  username: string;
  cookies: CookieJar;
  expiresAt: number;
}

export const getHeaderValues = (
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

export const getHeader = (
  headers: ZjuAuthHttpResponse["headers"],
  name: string
): string | null => getHeaderValues(headers, name)[0] ?? null;

export const defaultCookiePath = (url: URL): string => {
  const finalSlash = url.pathname.lastIndexOf("/");

  if (finalSlash <= 0) {
    return "/";
  }

  return url.pathname.slice(0, finalSlash + 1);
};

export const domainMatches = (hostname: string, domain: string): boolean =>
  hostname === domain || hostname.endsWith(`.${domain}`);

export const pathMatches = (requestPath: string, cookiePath: string): boolean =>
  requestPath === cookiePath ||
  (requestPath.startsWith(cookiePath) &&
    (cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/"));

export class CookieJar {
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
        sourceHost: url.hostname.toLowerCase(),
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

  /** Isolate a service redirect chain without widening any CAS cookie scope. */
  createServiceSessionJar(): CookieJar {
    const jar = new CookieJar();
    for (const [key, cookie] of this.#cookies) {
      if (cookie.name === "iPlanetDirectoryPro") jar.#cookies.set(key, { ...cookie });
    }
    return jar;
  }

  createLearningServiceSessionJar(): CookieJar {
    const now = Date.now();
    const trustedSsoCookie = [...this.#cookies.values()].find(
      (cookie) =>
        cookie.name === "iPlanetDirectoryPro" &&
        cookie.value.length > 0 &&
        (cookie.expiresAt === null || cookie.expiresAt > now)
    );
    const learningCookies = new CookieJar();

    if (!trustedSsoCookie) {
      return learningCookies;
    }

    // Celechron scopes the CAS-issued SSO credential to zju.edu.cn before
    // starting the courses redirect chain. The server may omit Domain, which
    // otherwise makes this cookie host-only for zjuam.zju.edu.cn.
    learningCookies.#cookies.set(
      `zju.edu.cn\n/\n${trustedSsoCookie.name}`,
      {
        ...trustedSsoCookie,
        domain: "zju.edu.cn",
        hostOnly: false,
        path: "/"
      }
    );

    return learningCookies;
  }

  /**
   * 把 CAS 签发的 SSO 凭据放宽到 `zju.edu.cn`，用于「登录桥 + 业务域名」这类
   * 非 courses.zju.edu.cn 的服务（智云课堂走 tgmedia.cmc.zju.edu.cn 登录桥）。
   */
  createSsoScopedSessionJar(): CookieJar {
    return this.createLearningServiceSessionJar();
  }

  createLearningApiSessionJar(targetUrl = LEARNING_TODOS_URL): CookieJar {
    const target = new URL(targetUrl);
    const hostname = target.hostname.toLowerCase();
    const now = Date.now();
    const session = [...this.#cookies.values()].find((cookie) => {
      const matchesDomain = cookie.hostOnly
        ? hostname === cookie.domain
        : domainMatches(hostname, cookie.domain);
      return (
        cookie.name === "session" &&
        cookie.sourceHost === "courses.zju.edu.cn" &&
        cookie.value.length > 0 &&
        (cookie.expiresAt === null || cookie.expiresAt > now) &&
        matchesDomain &&
        pathMatches(target.pathname, cookie.path) &&
        (!cookie.secure || target.protocol === "https:")
      );
    });
    const apiSession = new CookieJar();
    if (session) {
      apiSession.#cookies.set(
        `${session.domain}\n${session.path}\n${session.name}`,
        { ...session }
      );
    }
    return apiSession;
  }
}

export const cookieHeaderHasName = (
  header: string | null,
  expectedName: string
): boolean =>
  header
    ?.split(";")
    .some((entry) => entry.trim().startsWith(`${expectedName}=`)) ?? false;

/** 取出 `name=value` Cookie 头里某个 cookie 的原始值（未解码）。 */
export const cookieValueFromHeader = (
  header: string | null,
  expectedName: string
): string | null => {
  if (!header) return null;
  for (const entry of header.split(";")) {
    const trimmed = entry.trim();
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    if (trimmed.slice(0, separator) === expectedName) {
      return trimmed.slice(separator + 1);
    }
  }
  return null;
};

export const splitCombinedSetCookieHeader = (value: string): string[] =>
  value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map((item) => item.trim());
