import { computeRequestFingerprint } from "./requestFingerprint";

const OFFICIAL_CALENDAR_URL =
  "https://www.zju.edu.cn/english/19600/list.htm";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ATTEMPTS = 2;

export interface OfficialCalendarPage {
  body: string;
  sourceUrl: string;
  /** 请求版本指纹：结构变化（URL 改版）时随之变化，用于上游兼容雷达。 */
  requestFingerprint: string;
}

const E2E_OFFICIAL_CALENDAR_PAGE = `
  <div class="title">Autumn Quarter 2026</div>
  <table>
    <tr><th>September 1, 2026 - January 10, 2027</th></tr>
    <tr><td>September 14, 2026</td><td>Classes begin</td></tr>
  </table>
`;

export const useE2eFixtureSources = (): boolean =>
  process.env.CAMPUSOS_E2E_FIXTURE === "1";

export const requestE2eOfficialCalendar = async (): Promise<OfficialCalendarPage> => ({
  body: E2E_OFFICIAL_CALENDAR_PAGE,
  sourceUrl: "https://www.zju.edu.cn/english/19600/list.htm",
  requestFingerprint: computeRequestFingerprint(
    "GET",
    "https://www.zju.edu.cn/english/19600/list.htm"
  )
});

const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 429 || status >= 500;

export const requestOfficialAcademicCalendar = async (): Promise<OfficialCalendarPage> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(OFFICIAL_CALENDAR_URL, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml"
        }
      });
      const finalUrl = new URL(response.url);
      if (
        finalUrl.protocol !== "https:" ||
        finalUrl.hostname !== "www.zju.edu.cn"
      ) {
        throw new Error("浙江大学官网校历发生了不受信任的跨站重定向。");
      }
      if (!response.ok) {
        const error = new Error(`浙江大学官网校历返回 HTTP ${response.status}。`);
        if (attempt < MAX_ATTEMPTS && isRetryableStatus(response.status)) {
          lastError = error;
          continue;
        }
        throw error;
      }

      const contentLength = Number.parseInt(
        response.headers.get("content-length") ?? "0",
        10
      );
      if (contentLength > MAX_RESPONSE_BYTES) {
        throw new Error("浙江大学官网校历响应超过安全大小限制。");
      }
      const contentType = response.headers.get("content-type")?.toLowerCase();
      if (!contentType?.includes("text/html")) {
        throw new Error("浙江大学官网校历返回了非 HTML 内容。");
      }
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
        throw new Error("浙江大学官网校历响应超过安全大小限制。");
      }

      return {
        body,
        sourceUrl: response.url,
        requestFingerprint: computeRequestFingerprint("GET", response.url)
      };
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_ATTEMPTS) break;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof Error && lastError.name === "AbortError") {
    throw new Error("浙江大学官网校历请求超时。", { cause: lastError });
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("浙江大学官网校历请求失败。");
};
