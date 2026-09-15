import { createHash } from "node:crypto";
import type { AcademicTimetableSession } from "@campusos/shared";
import { ZJU_AUTH_LOGIN_URL } from "./zjuAuthConfig";
import { CookieJar, getHeader, getHeaderValues } from "./zjuAuthCookies";
import { ZjuUnifiedAuthError } from "./zjuAuthContracts";
import type { ZjuAuthCredentials } from "./zjuAuthContracts";
import type { ZjuAuthRequestHost } from "./zjuAuthHost";

const BASE = "https://eta.zju.edu.cn/zftal-xgxt-web";
const SERVICE = "http://eta.zju.edu.cn/zftal-xgxt-web/teacher/xtgl/index/check.zf";
const redirects = new Set([301, 302, 303, 307, 308]);
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const integer = (value: unknown): number | null => {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(value);
  return String(value).trim() && Number.isSafeInteger(parsed) ? parsed : null;
};

/** Independently implemented from the observed ETA schema; no response text in errors. */
export const parseEtaTimetable = (body: string, year: number, semester: 1 | 2): AcademicTimetableSession[] => {
  let payload: Record<string, unknown> | null;
  try { payload = record(JSON.parse(body)); }
  catch { throw new ZjuUnifiedAuthError("protocol-error", "ETA 未返回可解析的课表数据。"); }
  const data = record(payload?.data);
  const list = record(data?.kbList);
  if (payload?.code !== 0 || !list) throw new ZjuUnifiedAuthError("service-verification-failed", "ETA 未返回有效课程列表。");
  const sessions: AcademicTimetableSession[] = [];
  let rawCount = 0;
  // Documents the xqj/ksj/ks, xxq and dsz fields.
  // Mechanical adaptation: publish typed sessions and stable local IDs instead
  // of provider session objects. Only the first ke record represents this entry.
  for (const group of Object.values(list)) {
    if (!Array.isArray(group)) throw new ZjuUnifiedAuthError("protocol-error", "ETA 课程分组格式异常。");
    for (const raw of group) {
      rawCount++;
      const entry = record(raw);
      const course = Array.isArray(entry?.ke) ? record(entry.ke[0]) : null;
      const day = integer(entry?.xqj);
      const first = integer(entry?.ksj);
      const name = typeof course?.kcmc === "string" ? course.kcmc.trim().replaceAll("(", "（").replaceAll(")", "）") : "";
      if (!entry || day === null || first === null || first <= 0 || !name) continue;
      const length = Math.max(1, integer(entry.ks) ?? 1);
      if (length > 24 || first > 24 || first + length > 25) continue;
      const half = typeof entry.xxq === "string" ? entry.xxq : "";
      const firstHalf = /秋|春/.test(half);
      const secondHalf = /冬|夏/.test(half);
      const repeat = String(entry.dsz ?? "").toLowerCase();
      const periods = Array.from({ length }, (_, i) => first + i);
      const courseId = typeof course?.kcdm === "string" ? course.kcdm : undefined;
      sessions.push({
        sourceId: `eta:${createHash("sha256").update(JSON.stringify([year, semester, courseId, name, day, periods, half, repeat])).digest("hex")}`,
        courseName: name,
        teacher: typeof course?.rkjs === "string" ? course.rkjs : "未知教师",
        location: typeof course?.jsmc === "string" ? course.jsmc : "",
        dayOfWeek: Math.min(7, Math.max(1, day)), periods,
        firstHalf: firstHalf || !secondHalf, secondHalf: secondHalf || !firstHalf,
        weekPattern: ["single", "1", "单"].includes(repeat) ? "odd" : ["double", "2", "双"].includes(repeat) ? "even" : "all",
        confirmed: integer(entry.sfqd) === 1
      });
    }
  }
  if (rawCount && !sessions.length) throw new ZjuUnifiedAuthError("protocol-error", "ETA 返回了课程条目，但无法解析。");
  return sessions;
};

/** Fixed ETA endpoints, isolated service cookies, shared CAS only; no renderer credentials. */
export class ZjuEtaApi {
  readonly #sessions = new Map<string, CookieJar>();
  readonly #pending = new Map<string, Promise<CookieJar>>();
  #generation = 0;
  constructor(private readonly host: ZjuAuthRequestHost) {}
  clear(): void { this.#generation++; this.#sessions.clear(); this.#pending.clear(); }

  async #connect(credentials: ZjuAuthCredentials): Promise<CookieJar> {
    const generation = this.#generation;
    // The ETA tier reuses the existing CAS SSO, its exact HTTP service,
    // then upgrades only that fixed ticket callback to HTTPS. Unlike zdbk,
    // this exchange must not depend on undergraduate service availability.
    const cas = await this.host.authenticateCas(credentials);
    const login = new URL(ZJU_AUTH_LOGIN_URL);
    login.searchParams.set("service", SERVICE);
    const response = await this.host.request("GET", login.href, { cookie: cas.cookies.header(login.href) });
    const location = getHeader(response.headers, "location");
    if (!redirects.has(response.status) || !location) throw new ZjuUnifiedAuthError("service-verification-failed", "统一认证未签发 ETA 访问票据。", { statusCode: response.status });
    const callback = new URL(location, login);
    if (!["http:", "https:"].includes(callback.protocol) || callback.hostname !== "eta.zju.edu.cn" || callback.port || callback.username || callback.password || callback.pathname !== new URL(SERVICE).pathname || !callback.searchParams.get("ticket")) {
      throw new ZjuUnifiedAuthError("service-verification-failed", "ETA 认证回调不属于已验证服务。");
    }
    callback.protocol = "https:";
    const issued = await this.host.request("GET", callback.href);
    if (issued.status < 200 || issued.status >= 400 || /<form[^>]+(?:login|casLoginForm)/i.test(issued.body)) throw new ZjuUnifiedAuthError("service-verification-failed", "ETA 登录未成功。", { statusCode: issued.status });
    const cookies = new CookieJar();
    cookies.store(callback.href, getHeaderValues(issued.headers, "set-cookie"));
    if (!cookies.header(`${BASE}/student/xtgl/index/getTableKcb.zf`)) throw new ZjuUnifiedAuthError("service-verification-failed", "ETA 未签发有效的业务会话。");
    if (generation !== this.#generation) throw new ZjuUnifiedAuthError("service-verification-failed", "账号已改变，请重新同步。");
    this.#sessions.set(credentials.username.trim(), cookies);
    return cookies;
  }

  async timetable(credentials: ZjuAuthCredentials, year: number, semester: 1 | 2): Promise<AcademicTimetableSession[]> {
    if (!Number.isSafeInteger(year) || year < 2000 || year > 2200 || ![1, 2].includes(semester)) throw new ZjuUnifiedAuthError("invalid-input", "ETA 学期参数无效。");
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
        cookies = await pending;
      }
      const url = new URL(`${BASE}/student/xtgl/index/getTableKcb.zf`);
      url.searchParams.set("xnxq", `${year}-${year + 1}-${semester}`);
      const response = await this.host.request("GET", url.href, { cookie: cookies.header(url.href) });
      if (response.status !== 200) throw new ZjuUnifiedAuthError("service-unavailable", "ETA 课表接口暂时不可用。", { statusCode: response.status });
      const sessions = parseEtaTimetable(response.body, year, semester);
      if (generation !== this.#generation) throw new ZjuUnifiedAuthError("service-verification-failed", "账号已改变，请重新同步。");
      return sessions;
    } catch (error) {
      if (generation === this.#generation) this.#sessions.delete(username);
      throw error;
    }
  }
}
