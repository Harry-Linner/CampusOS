/**
 * Campus-feed (校园资讯) source definitions and list-page fetcher (Core, main).
 *
 * Sources are declared with RSSHub-style selectors that match the 博达 (sudy)
 * CMS list pages used by ZJU official sites, or with an `adapterId` for
 * non-HTML sources (Drupal RSS). Fetching happens only in the main process;
 * the renderer and plugin sandboxes never receive a network handle.
 *
 * 这些 descriptor 中的 enabled 仅用于从旧版 SQLite 配置迁移；新安装是否订阅由
 * campusFeedStore 中的用户偏好决定。可推荐性以 campusFeedCatalog 的 verification
 * 元数据为准，不能从 HTTP 200 或这个旧标志推断。
 */
import { createHash } from "node:crypto";
import type {
  FeedItemRecord,
  FeedSourceDescriptor,
  CampusFeedItemDetail
} from "@campusos/shared";
import { computeRequestFingerprint } from "./requestFingerprint";
import { HOSPITAL_LIST_API, HOSPITAL_DETAIL_API, hospitalArticleId, hospitalArticleUrl, readHospitalArticle, readHospitalPayload } from "./campusFeedHospital";
import { CampusFeedSourceError } from "./campusFeedSourceError";
export { CampusFeedSourceError } from "./campusFeedSourceError";

export const isFeedSourceUrl = (
  descriptor: FeedSourceDescriptor,
  value: string
): boolean => {
  try {
    const url = new URL(value);
    if (!url.username && !url.password && (url.protocol === "https:" || url.protocol === "http:")) {
      const base = new URL(descriptor.baseUrl);
      const allowed = new Set([
        base.hostname.toLowerCase(),
        ...(descriptor.extraHosts ?? []).map((host) => host.toLowerCase())
      ]);
      return allowed.has(url.hostname.toLowerCase()) &&
        !(base.protocol === "https:" && url.protocol !== "https:");
    }
  } catch {
    return false;
  }
  return false;
};

const canonicalUrl = (value: string, base?: string): string | null => {
  try {
    if (!value.trim() || value.startsWith("#")) return null;
    const url = new URL(value, base);
    if (url.username || url.password || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
};

const normalizeSourceLink = (descriptor: FeedSourceDescriptor, value: string): string => {
  const url = new URL(value);
  if (descriptor.linkNormalization && url.hostname === new URL(descriptor.baseUrl).hostname) {
    url.protocol = "https:";
    if (descriptor.linkNormalization === "webplus-https-psp") {
      url.pathname = url.pathname.replace(/\/(page|list\d*)\.htm$/, "/$1.psp");
    }
  }
  return url.toString();
};

const normalizePublishedAt = (
  value: string | null | undefined
): string | null => {
  if (!value) return null;
  const match = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/.exec(value);
  if (match) {
    const [, year, month, day] = match;
    const check = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (check.getUTCFullYear() !== Number(year) || check.getUTCMonth() !== Number(month) - 1 || check.getUTCDate() !== Number(day)) return null;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00+08:00`;
  }
  if (!/[A-Za-z]{3}/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

export interface FetchSourceListOptions {
  fetchFn?: typeof fetch;
  now?: () => Date;
  fetchTimeoutMs?: number;
  /** A previously observed next-page link, never a guessed URL. */
  historyUrl?: string;
  historyPage?: number;
}

/**
 * 该订阅源列表请求的版本指纹（方法+主机+路径，脱敏），供上游兼容雷达。
 * 成功与失败路径共用同一来源，保证台账中指纹一致。
 */
export const feedSourceRequestFingerprint = (
  descriptor: FeedSourceDescriptor
): string => descriptor.adapterId === "zju-hospital"
  ? computeRequestFingerprint("POST", HOSPITAL_LIST_API)
  : computeRequestFingerprint("GET", descriptor.listUrl);

export interface FeedSourceListResult {
  items: FeedItemRecord[];
  requestFingerprint: string;
  /** Set when page 1 succeeded but a later declared page failed. */
  partialWarning?: string;
  nextPageUrl?: string;
  nextPageNumber?: number;
}

const MAX_PAGE_BYTES = 4_000_000;

const assertPublicContent = async (html: string): Promise<void> => {
  const { load } = await import("cheerio");
  const $ = load(html);
  const title = $("title").text().trim();
  $("script,style,nav,footer,a").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  // A link to SSO or an article explaining verification is not itself a gate.
  if (/^(?:浙江大学\s*)?(?:统一身份认证平台|安全验证|访问验证|用户登录)/.test(title) ||
    (text.length < 2000 && /仅允许校内地址访问|当前\s*ip\s*并非校内|请先登录后|登录后方可|访问过于频繁/i.test(text))) {
    throw new CampusFeedSourceError("restricted", "官网要求校园网、登录或访问验证，请在浏览器查看原文。");
  }
};

/** WebPlus can list one article under two column ids on the same page. */
const articleLinkKey = (url: string): string => {
  const parsed = new URL(url);
  const article = /\/c\d+a(\d+)\/page(?:m)?\.(?:htm|psp)$/.exec(parsed.pathname);
  return article ? `${parsed.hostname}:article:${article[1]}` : url;
};

const makeItem = (
  descriptor: FeedSourceDescriptor,
  rawTitle: string,
  resolvedUrl: string,
  publishedAt: string | null,
  summary: string | null,
  now: () => Date
): FeedItemRecord => ({
  // New columns retain independent membership even when they link to the same
  // URL. Keep legacy ids intact for saved read states and notification links.
  id: createHash("sha256").update(descriptor.itemIdScope === "source" ? `${descriptor.id}:${resolvedUrl}` : resolvedUrl, "utf8").digest("hex"),
  sourceId: descriptor.id,
  title: rawTitle,
  url: resolvedUrl,
  publishedAt,
  summary,
  contentHash: createHash("sha256")
    .update(`${rawTitle}\n${resolvedUrl}`, "utf8")
    .digest("hex"),
  fetchedAt: now().toISOString(),
  state: "new"
});

const readLimitedBody = async (response: Response): Promise<Uint8Array> => {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_PAGE_BYTES) {
        await reader.cancel("CampusOS page byte limit exceeded");
        throw new CampusFeedSourceError("layout-changed", "页面过大，无法安全解析。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

/** 按响应解码 HTML：显式 `encoding:"gbk"` 用 TextDecoder(gbk)，否则按 UTF-8 解码。 */
const readHtml = async (
  response: Response,
  encoding?: string
): Promise<string> => {
  const buffer = await readLimitedBody(response);
  if (encoding && encoding.toLowerCase() === "gbk") {
    // Node/Electron 的 TextDecoder 带 full-icu，支持 "gbk"；失败时退回 UTF-8。
    try {
      return new TextDecoder("gbk").decode(buffer);
    } catch {
      return new TextDecoder("utf-8").decode(buffer);
    }
  }
  return new TextDecoder("utf-8").decode(buffer);
};

const fetchPage = async (
  url: string,
  options: FetchSourceListOptions,
  fetchTimeoutMs: number,
  encoding?: string,
  jsonBody?: unknown
): Promise<{ html: string; url: string }> => {
  const { fetchFn = fetch } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    let currentUrl = url;
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 5; redirects++) {
      response = await fetchFn(currentUrl, {
        signal: controller.signal,
        ...(jsonBody === undefined ? {} : { method: "POST", body: JSON.stringify(jsonBody) }),
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", ...(jsonBody === undefined ? {} : { "content-type": "application/json" }) },
        redirect: "manual"
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (jsonBody !== undefined) throw new CampusFeedSourceError("restricted", "公告接口发生了未核验的跳转。");
      const next = canonicalUrl(response.headers.get("location") ?? "", currentUrl);
      if (!next || new URL(next).hostname !== new URL(url).hostname ||
        (new URL(url).protocol === "https:" && new URL(next).protocol !== "https:")) {
        throw new CampusFeedSourceError("restricted", "官网跳转到其他站点或不安全连接，请打开原文确认。");
      }
      await response.body?.cancel();
      if (redirects === 5) throw new CampusFeedSourceError("network-error", "官网跳转次数过多，请稍后重试。");
      currentUrl = next;
    }
    if (!response) throw new CampusFeedSourceError("network-error", "官网未返回响应。");
    assertOk(response, "信息源");
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PAGE_BYTES) {
      await response.body?.cancel();
      throw new CampusFeedSourceError("layout-changed", "页面过大，无法安全解析。");
    }
    const finalUrl = response.url || currentUrl;
    if (new URL(finalUrl).hostname !== new URL(url).hostname) {
      throw new CampusFeedSourceError("restricted", "官网跳转到其他站点，请打开原文确认。");
    }
    const html = await readHtml(response, encoding);
    await assertPublicContent(html);
    return { html, url: finalUrl };
  } catch (cause) {
    if (cause instanceof Error && (cause.name === "AbortError" || cause.name === "TypeError")) {
      throw new CampusFeedSourceError("network-error", "无法连接官网或请求超时，已保留缓存。");
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
};

const assertOk = (response: Response, name: string): void => {
  if (!response.ok) {
    if (response.status === 401 || response.status === 403 || response.status === 407) {
      throw new CampusFeedSourceError("restricted", `${name} 要求登录、校园网或访问验证。`);
    }
    // 附带 status 供 classifyRetryError 按 408/429/5xx 判定为可重试。
    throw Object.assign(new Error(`${name} 返回 ${response.status}。`), {
      status: response.status
    });
  }
};

/** RSS adapter（Drupal 站）：解析 <item> 的 title/link/pubDate/description。 */
const fetchRssList = async (
  descriptor: FeedSourceDescriptor,
  options: FetchSourceListOptions,
  fetchTimeoutMs: number
): Promise<FeedSourceListResult> => {
  const { now = () => new Date() } = options;
  const requestFingerprint = feedSourceRequestFingerprint(descriptor);
  const { html: xml } = await fetchPage(descriptor.listUrl, options, fetchTimeoutMs);
  const cheerio = await import("cheerio");
  const $ = cheerio.load(xml, { xmlMode: true });
  const items: FeedItemRecord[] = [];
  const seen = new Set<string>();
  $("item").each((_index, element) => {
    const $item = $(element);
    const title = ($item.find("title").first().text() ?? "").trim();
    const rawLink = ($item.find("link").first().text() ?? "").trim();
    const pubDate = ($item.find("pubDate").first().text() ?? "").trim();
    const summary = cheerio.load($item.find("description").first().text()).text().replace(/\s+/g, " ").trim();
    if (!title || !rawLink) return;
    const canonical = canonicalUrl(rawLink, descriptor.listUrl);
    const resolved = canonical ? normalizeSourceLink(descriptor, canonical) : null;
    if (!resolved || !isFeedSourceUrl(descriptor, resolved) || seen.has(resolved)) return;
    seen.add(resolved);
    items.push(
      makeItem(
        descriptor,
        title,
        resolved,
        normalizePublishedAt(pubDate),
        summary || null,
        now
      )
    );
  });
  if ($("rss, feed").length === 0) throw new CampusFeedSourceError("layout-changed", "官网返回的内容不是 RSS。");
  if ($("item, entry").length > 0 && items.length === 0) throw new CampusFeedSourceError("layout-changed", "官网包含资讯，但所有条目均未通过解析或链接校验，已保留缓存。");
  return { items, requestFingerprint };
};

/**
 * Fetches one source's list page(s) and normalizes its items. Titles prefer the
 * anchor's title attribute (full titles) over its text (often truncated).
 * Supports: 声明式 selectors（含可选分页 maxPages）与 adapterId:"rss"。
 */
export const fetchSourceList = async (
  descriptor: FeedSourceDescriptor,
  options: FetchSourceListOptions = {}
): Promise<FeedSourceListResult> => {
  const { now = () => new Date(), fetchTimeoutMs = 20_000 } = options;
  const requestFingerprint = feedSourceRequestFingerprint(descriptor);

  if (descriptor.adapterId === "zju-hospital") {
    const pageNum = options.historyPage ?? 1;
    const { html } = await fetchPage(HOSPITAL_LIST_API, options, fetchTimeoutMs, undefined, { articleTypeId: 107, pageNum, pageSize: 20 });
    const data = readHospitalPayload(html);
    if (!Array.isArray(data)) throw new CampusFeedSourceError("layout-changed", "校医院公告列表结构已变化。");
    const items = data.map((value) => {
      const article = readHospitalArticle(value);
      const url = hospitalArticleUrl(article);
      if (!isFeedSourceUrl(descriptor, url)) throw new CampusFeedSourceError("layout-changed", "校医院公告包含未核验的外部链接。");
      return makeItem(descriptor, article.articleTitle.trim(), url, normalizePublishedAt(article.createTime), null, now);
    });
    return { items, requestFingerprint, ...(items.length === 20 ? { nextPageNumber: pageNum + 1 } : {}) };
  }

  if (descriptor.adapterId === "rss") {
    return fetchRssList(descriptor, options, fetchTimeoutMs);
  }
  if (!descriptor.selectors) {
    throw new Error(`${descriptor.name} 没有可用的抓取规则。`);
  }

  // B4-1：请求版本指纹在发起 HTTP 处构造，随结果穿透到刷新台账。
  const selectors = descriptor.selectors;
  const pages = options.historyUrl ? 1 : Math.min(5, Math.max(1, Math.floor(descriptor.maxPages ?? 1)));
  const items: FeedItemRecord[] = [];
  let rejectedLinks = 0;
  const seen = new Set<string>();
  if (options.historyUrl && (new URL(options.historyUrl).hostname !== new URL(descriptor.listUrl).hostname || !["http:", "https:"].includes(new URL(options.historyUrl).protocol) || (new URL(descriptor.listUrl).protocol === "https:" && new URL(options.historyUrl).protocol !== "https:") || new URL(options.historyUrl).username || new URL(options.historyUrl).password)) {
    throw new Error("历史分页地址不属于当前信息源。");
  }
  let nextPageUrl: string | null = options.historyUrl ?? descriptor.listUrl;
  const visited = new Set<string>();

  for (let page = 1; page <= pages; page++) {
    const pageUrl = nextPageUrl;
    if (!pageUrl || visited.has(pageUrl)) break;
    visited.add(pageUrl);
    let pageResult: Awaited<ReturnType<typeof fetchPage>>;
    try {
      pageResult = await fetchPage(pageUrl, options, fetchTimeoutMs, selectors.encoding);
    } catch (cause) {
      if (page === 1 || items.length === 0) throw cause;
      return {
        items,
        requestFingerprint,
        nextPageUrl: pageUrl,
        partialWarning: `第 ${page} 页抓取失败，已保留前 ${page - 1} 页结果。`
      };
    }
    const { html, url: responseUrl } = pageResult;

    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);

    $(selectors.container).each((_index, element) => {
      const $container = $(element);
      const $title = $container.find(selectors.title).first();
      const $link = $container.find(selectors.link).first();
      if ($title.length === 0 || $link.length === 0) return;

      const rawTitle = (($title.attr("title") ?? "").trim() || ($link.attr("title") ?? "").trim() || $title.text()).replace(/\s+/g, " ").trim();
      if (!rawTitle) return;

      const rawHref = $link.attr(selectors.linkAttr ?? "href") ?? "";
      const canonical = canonicalUrl(rawHref, responseUrl);
      const resolved = canonical ? normalizeSourceLink(descriptor, canonical) : null;
      if (!resolved || !isFeedSourceUrl(descriptor, resolved)) { rejectedLinks++; return; }
      if (seen.has(articleLinkKey(resolved))) return;
      seen.add(articleLinkKey(resolved));

      let publishedAt: string | null = null;
      if (selectors.dateParts) {
        publishedAt = normalizePublishedAt(`${selectors.dateParts.yearPrefix ?? ""}${$container.find(selectors.dateParts.yearMonth).first().text().trim()}-${$container.find(selectors.dateParts.day).first().text().trim()}`);
      } else if (selectors.time) {
        const $time = $container.find(selectors.time).first();
        const rawTime = selectors.timeAttr
          ? $time.attr(selectors.timeAttr) ?? ""
          : $time.text();
        const pattern = selectors.timePattern ?? "\\d{4}-\\d{2}-\\d{2}";
        const match = new RegExp(pattern).exec(rawTime.replace(/\s+/g, " ").trim());
        publishedAt = normalizePublishedAt(`${selectors.timePrefix ?? ""}${match?.[0] ?? rawTime}`);
      }

      items.push(makeItem(descriptor, rawTitle, resolved, publishedAt, null, now));
    });
    if (page === 1 && items.length === 0 && !/(?:总共\s*0\s*记录|共\s*0\s*条|暂无(?:内容|信息|记录)|<!--\s*No Data\s*-->)/i.test(html)) {
      throw new CampusFeedSourceError("layout-changed", "未找到资讯列表，官网可能已改版或栏目地址已变更。");
    }
    const nextAnchor = selectors.nextPage
      ? $(selectors.nextPage).first()
      : $("a[href]").filter((_i, el) => /^(下一页|下页|next)/i.test($(el).text().trim())).first();
    const rawNext = canonicalUrl(nextAnchor.attr("href") ?? "", responseUrl);
    const actualNext = rawNext ? normalizeSourceLink(descriptor, rawNext) : null;
    const currentProtocol = new URL(responseUrl).protocol;
    nextPageUrl = actualNext &&
      new URL(actualNext).hostname === new URL(descriptor.baseUrl).hostname &&
      !(currentProtocol === "https:" && new URL(actualNext).protocol !== "https:")
      ? actualNext
      : null;
  }

  return { items, requestFingerprint, ...(nextPageUrl && !visited.has(nextPageUrl) ? { nextPageUrl } : {}), ...(rejectedLinks ? { partialWarning: `官网列表中有 ${rejectedLinks} 条链接未通过来源范围校验，未纳入资讯。` } : {}) };
};

/** Read only the article content area; never feed navigation or access prompts to AI. */
export const fetchSourceDetail = async (
  descriptor: FeedSourceDescriptor,
  item: FeedItemRecord,
  options: FetchSourceListOptions = {}
): Promise<CampusFeedItemDetail> => {
  if (!isFeedSourceUrl(descriptor, item.url)) throw new CampusFeedSourceError("restricted", "原文链接不在该信息源允许的范围内。");
  const hospitalId = descriptor.adapterId === "zju-hospital" ? hospitalArticleId(item.url) : null;
  let page: { html: string; url: string };
  if (hospitalId !== null) {
    const response = await fetchPage(HOSPITAL_DETAIL_API, options, options.fetchTimeoutMs ?? 20_000, undefined, { id: String(hospitalId) });
    const article = readHospitalArticle(readHospitalPayload(response.html));
    if (article.id !== hospitalId || article.isOuterChain !== 1) throw new CampusFeedSourceError("layout-changed", "校医院正文与所选公告不一致。");
    page = { html: `<div class="wp_articlecontent">${article.articleContent}</div>`, url: item.url };
  } else {
    page = await fetchPage(normalizeSourceLink(descriptor, item.url), options, options.fetchTimeoutMs ?? 20_000, descriptor.selectors?.encoding);
  }
  const { html, url } = page;
  const { load } = await import("cheerio");
  const $ = load(html);
  const body = $(descriptor.id === "tyys-tzgg" ? ".article-content, #js_content" : ".wp_articlecontent, .v_news_content, #js_content, article .content, .field--name-body").first();
  body.find("script,style,iframe,nav,form").remove();
  body.find("br").replaceWith("\n");
  body.find("p,div,tr,li,h2,h3").append("\n");
  const content = body.text().replace(/[\t ]+/g, " ").replace(/\n\s*\n/g, "\n").trim().slice(0, 24_000);
  if (!content || content.length < 12) throw new CampusFeedSourceError("layout-changed", "原文未提供可解析正文，请打开原文或将文字/截图交给 AI 助手。");
  const attachments: CampusFeedItemDetail["attachments"] = [];
  body.find("a[href]").each((_index, el) => {
    const canonical = canonicalUrl($(el).attr("href") ?? "", url);
    const target = canonical ? normalizeSourceLink(descriptor, canonical) : null;
    if (target && /\.(?:pdf|docx?|xlsx?|pptx?|zip)(?:[?#]|$)/i.test(target) && isFeedSourceUrl(descriptor, target)) {
      attachments.push({ name: $(el).text().trim().slice(0, 180) || "附件", url: target });
    }
  });
  return { itemId: item.id, title: item.title, url: item.url, text: content, attachments: attachments.slice(0, 30), fetchedAt: (options.now?.() ?? new Date()).toISOString(), contentHash: createHash("sha256").update(content).digest("hex") };
};
