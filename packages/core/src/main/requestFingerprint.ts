import { createHash } from "node:crypto";

/**
 * 请求版本指纹：把"方法 + 主机 + 路径 + 排序后的静态字段名"归一化后做 SHA-256。
 *
 * 只含结构信息、不含任何参数值，天然满足脱敏要求；用于上游兼容雷达
 * （同一来源指纹变化 → 上游页面/接口可能已改版）。字段名取"静态查询参数名 ∪
 * 表单字段名"，不包含任何值。
 */
export const computeRequestFingerprint = (
  method: string,
  url: string,
  formFieldNames: readonly string[] = []
): string => {
  let normalized: string;
  try {
    const parsed = new URL(url);
    normalized = [
      method.toUpperCase(),
      parsed.protocol,
      parsed.hostname.toLowerCase(),
      parsed.port,
      parsed.pathname
    ].join(" ");
  } catch {
    normalized = `${method.toUpperCase()} ${url}`;
  }
  const fields = [...new Set(formFieldNames)]
    .map((name) => name.toLowerCase())
    .sort()
    .join(",");
  return createHash("sha256")
    .update(`${normalized}|${fields}`)
    .digest("hex")
    .slice(0, 16);
};

/**
 * 把一个源当次刷新产生的多个请求指纹聚合为一个稳定指纹：
 * 去空 → 去重 → 排序 → 连接 → SHA-256。结果与请求顺序无关，
 * 任一请求的结构变化都会使聚合结果变化；空输入返回 null。
 */
export const combineRequestFingerprints = (
  values: readonly (string | null | undefined)[]
): string | null => {
  const present = [
    ...new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0
      )
    )
  ].sort();
  if (present.length === 0) return null;
  return createHash("sha256")
    .update(present.join("|"))
    .digest("hex")
    .slice(0, 16);
};

/** 一次刷新内收集各请求指纹的采集器（加载器层每连接器一个）。 */
export interface FingerprintCollector {
  add: (value: string | null | undefined) => void;
  /** 聚合当前已收集的全部指纹；无有效指纹时返回 null。 */
  combined: () => string | null;
  reset: () => void;
}

export const createFingerprintCollector = (): FingerprintCollector => {
  const values: string[] = [];
  return {
    add: (value) => {
      if (typeof value === "string" && value.length > 0) values.push(value);
    },
    combined: () => combineRequestFingerprints(values),
    reset: () => {
      values.length = 0;
    }
  };
};

/**
 * 包装刷新 job：运行前清空采集器，运行后把当次刷新聚合出的请求指纹写入结果的
 * `requestFingerprint`（无有效指纹时为 null）。用于加载器层把连接器的
 * `ConnectorRefreshResult` 穿透为 `RefreshSourceResult.requestFingerprint`。
 */
export const trackRefreshResultFingerprint = <T>(
  collector: FingerprintCollector,
  job: () => Promise<T>
): (() => Promise<T & { requestFingerprint?: string | null }>) => async () => {
  collector.reset();
  const result = await job();
  return { ...result, requestFingerprint: collector.combined() };
};
