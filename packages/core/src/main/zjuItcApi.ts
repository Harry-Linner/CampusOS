import { load } from "cheerio";
import { ZJU_AUTH_LOGIN_URL, ZJU_BROWSER_USER_AGENT } from "./zjuAuthConfig";
import { CookieJar, getHeader, getHeaderValues } from "./zjuAuthCookies";
import { ZjuUnifiedAuthError } from "./zjuAuthContracts";
import type { ZjuAuthCredentials, ZjuAuthHttpResponse } from "./zjuAuthContracts";
import type { ZjuAuthRequestHost } from "./zjuAuthHost";

export const ITC_LIST_URL = "https://itc.zju.edu.cn/90618/list.psp";
const ITC_CAS_SERVICE = "http://itc.zju.edu.cn/90618/list.psp";
const redirects = new Set([301, 302, 303, 307, 308]);

export const isItcArticleRequest = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.origin === "https://itc.zju.edu.cn" && !url.username && !url.password && !url.search && !url.hash &&
      (url.pathname === "/90618/list.psp" || /^\/\d{4}\/\d{4}\/c\d+a\d+\/page\.(?:htm|psp)$/.test(url.pathname));
  } catch { return false; }
};

/** Fixed ITC service only. Passwords, SSO cookies and tickets never reach the feed/IPC. */
export class ZjuItcApi {
  readonly #sessions = new Map<string, CookieJar>();
  readonly #pending = new Map<string, Promise<{ cookies: CookieJar; page: ZjuAuthHttpResponse }>>();
  #generation = 0;
  constructor(private readonly host: ZjuAuthRequestHost & { invalidateCas?: (username: string) => void }, private readonly httpFetch: typeof fetch = fetch) {}
  clear(): void { this.#generation++; this.#sessions.clear(); this.#pending.clear(); }

  async #follow(start: string, cookies: CookieJar): Promise<ZjuAuthHttpResponse> {
    let current = new URL(start);
    // Celechron courses.dart _doLogin: store cookies before following each
    // redirect. ITC adaptation limits all hops to its own host. Its real
    // 2026-09-13 callback is HTTP -> HTTPS -> HTTP -> HTTPS, not a fallback.
    for (let hop = 0; hop < 15; hop++) {
      if (current.hostname !== "itc.zju.edu.cn" || current.port || current.username || current.password ||
        !["http:", "https:"].includes(current.protocol) ||
        (current.pathname !== "/90618/list.psp" && !/^\/\d{4}\/\d{4}\/c\d+a\d+\/page\.(?:htm|psp)$/.test(current.pathname))) {
        throw new ZjuUnifiedAuthError("service-verification-failed", "信息技术中心跳转超出已核验范围，请重新连接账号后重试。");
      }
      let response: ZjuAuthHttpResponse;
      if (current.protocol === "https:") {
        response = await this.host.request("GET", current.href, { cookie: cookies.header(current.href) });
      } else {
        // Mechanical transport adaptation for ITC's observed HTTP callback;
        // the shared Node HTTPS transport and other services remain strict.
        const result = await this.httpFetch(current.href, { redirect: "manual", signal: AbortSignal.timeout(this.host.timeoutMs), headers: { "user-agent": ZJU_BROWSER_USER_AGENT, ...(cookies.header(current.href) ? { cookie: cookies.header(current.href)! } : {}) } });
        const reader = result.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (reader) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 4_000_000) {
              await reader.cancel();
              throw new ZjuUnifiedAuthError("protocol-error", "信息技术中心响应过大。");
            }
            chunks.push(part.value);
          }
        } finally { reader?.releaseLock(); }
        response = { status: result.status, headers: { location: result.headers.get("location") ?? undefined, "set-cookie": result.headers.getSetCookie() }, body: Buffer.concat(chunks).toString("utf8") };
      }
      cookies.store(current.href, getHeaderValues(response.headers, "set-cookie"));
      const location = getHeader(response.headers, "location");
      if (redirects.has(response.status) && location) { current = new URL(location, current); continue; }
      const title = load(response.body)("title").text();
      if (response.status !== 200 || /统一身份认证|用户登录|访问验证/.test(title)) throw new ZjuUnifiedAuthError("service-verification-failed", "信息技术中心会话未通过验证，请重新连接账号后重试。");
      return response;
    }
    throw new ZjuUnifiedAuthError("protocol-error", "信息技术中心跳转次数超出已核验上限。");
  }

  async #connect(credentials: ZjuAuthCredentials, refreshed = false): Promise<{ cookies: CookieJar; page: ZjuAuthHttpResponse }> {
    const generation = this.#generation;
    // Celechron zjuam.dart getSsoCookie/getServiceCallback (46-74,108-181):
    // reuse the existing single-flight SSO and consume a fresh service ticket.
    const cas = await this.host.authenticateCas(credentials);
    const service = new URL(ZJU_AUTH_LOGIN_URL);
    service.searchParams.set("service", ITC_CAS_SERVICE);
    const response = await this.host.request("GET", service.href, { cookie: cas.cookies.header(service.href) });
    // Celechron zjuam.dart getServiceCallback classifies 200/401/403 as expired;
    // courses.dart retries with fresh SSO once, never loops authentication.
    if ([200, 401, 403].includes(response.status) && !refreshed && this.host.invalidateCas && generation === this.#generation) {
      this.host.invalidateCas(credentials.username.trim());
      return this.#connect(credentials, true);
    }
    const location = getHeader(response.headers, "location");
    if (!redirects.has(response.status) || !location) throw new ZjuUnifiedAuthError("service-verification-failed", "统一认证未签发信息技术中心访问票据。");
    const callback = new URL(location, service);
    if (callback.origin !== "http://itc.zju.edu.cn" || callback.pathname !== "/90618/list.psp" || callback.username || callback.password || !callback.searchParams.get("ticket")) {
      throw new ZjuUnifiedAuthError("service-verification-failed", "信息技术中心认证回调无效。");
    }
    // Celechron courses.dart _doLogin starts an isolated service jar with SSO.
    // ITC adaptation preserves the CAS-issued domain/path/security unchanged.
    const cookies = cas.cookies.createServiceSessionJar();
    const page = await this.#follow(callback.href, cookies);
    const $ = load(page.body);
    if ($('.col_news_list ul.news_list > li:has(.news_meta) .news_title a[href]').filter((_i, el) => /\/c90618a\d+\/page\.(?:htm|psp)/.test($(el).attr("href") ?? "")).length === 0) {
      throw new ZjuUnifiedAuthError("service-verification-failed", "信息技术中心未返回已核验的资讯页面。");
    }
    if (generation !== this.#generation) throw new ZjuUnifiedAuthError("service-verification-failed", "账号连接已变更，请重新刷新。");
    this.#sessions.set(credentials.username.trim(), cookies);
    return { cookies, page };
  }

  async request(credentials: ZjuAuthCredentials, url: string): Promise<{ status: number; body: string }> {
    if (!isItcArticleRequest(url)) throw new ZjuUnifiedAuthError("invalid-input", "信息技术中心请求地址无效。");
    const username = credentials.username.trim();
    const generation = this.#generation;
    try {
      let cookies = this.#sessions.get(username);
      if (!cookies) {
        let pending = this.#pending.get(username);
        if (!pending) {
          pending = this.#connect(credentials);
          this.#pending.set(username, pending);
          void pending.finally(() => { if (this.#pending.get(username) === pending) this.#pending.delete(username); }).catch(() => undefined);
        }
        const session = await pending;
        if (url === ITC_LIST_URL) return { status: session.page.status, body: session.page.body };
        cookies = session.cookies;
      }
      const response = await this.#follow(url, cookies);
      if (generation !== this.#generation) throw new ZjuUnifiedAuthError("service-verification-failed", "账号连接已变更，请重新刷新。");
      return { status: response.status, body: response.body };
    } catch (error) {
      if (generation === this.#generation) this.#sessions.delete(username);
      if (error instanceof ZjuUnifiedAuthError) throw error;
      throw new ZjuUnifiedAuthError("network-error", "信息技术中心请求失败，已保留缓存。");
    }
  }
}
