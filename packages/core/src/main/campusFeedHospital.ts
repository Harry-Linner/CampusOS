/** Public hospital embed API, verified against its app/detail JavaScript. */
import { CampusFeedSourceError } from "./campusFeedSourceError";
export const HOSPITAL_API_ORIGIN = "https://xyszyl.zju.edu.cn";
export const HOSPITAL_LIST_API = `${HOSPITAL_API_ORIGIN}/medical/health/article/listType`;
export const HOSPITAL_DETAIL_API = `${HOSPITAL_API_ORIGIN}/medical/health/article/getDetail`;

export interface HospitalArticle {
  id: number;
  articleTitle: string;
  articleContent: string;
  createTime: string;
  /** The upstream uses 0 for an external link and 1 for an embedded body. */
  isOuterChain: number;
}

export const readHospitalArticle = (value: unknown): HospitalArticle => {
  if (!value || typeof value !== "object") throw new CampusFeedSourceError("layout-changed", "校医院公告结构已变化。");
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.id) || Number(row.id) <= 0 ||
    typeof row.articleTitle !== "string" || !row.articleTitle.trim() ||
    typeof row.articleContent !== "string" || typeof row.createTime !== "string" ||
    (row.isOuterChain !== 0 && row.isOuterChain !== 1)) throw new CampusFeedSourceError("layout-changed", "校医院公告字段不完整。");
  return row as unknown as HospitalArticle;
};

export const readHospitalPayload = (body: string): unknown => {
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw new CampusFeedSourceError("layout-changed", "校医院未返回有效公告数据。"); }
  if (!value || typeof value !== "object" || !("code" in value) || value.code !== 200 || !("data" in value)) {
    throw new CampusFeedSourceError("layout-changed", "校医院公告服务未成功返回数据。");
  }
  return value.data;
};

export const hospitalArticleUrl = (article: HospitalArticle): string => article.isOuterChain === 0
  ? article.articleContent.trim()
  : `${HOSPITAL_API_ORIGIN}/medical/embed/index.html#/detail?artilceId=${article.id}`;

export const hospitalArticleId = (value: string): number | null => {
  const url = new URL(value);
  if (url.origin !== HOSPITAL_API_ORIGIN || url.pathname !== "/medical/embed/index.html" || !url.hash.startsWith("#/detail?")) return null;
  const id = new URLSearchParams(url.hash.slice("#/detail?".length)).get("artilceId");
  return id && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : null;
};
