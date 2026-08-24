import { createHash } from "node:crypto";

/**
 * 请求版本指纹：把"方法 + 主机 + 路径 + 排序后的静态表单字段名"归一化后做 SHA-256。
 *
 * 只含结构信息、不含任何参数值，天然满足脱敏要求；用于上游兼容雷达
 * （同一来源指纹变化 → 上游页面/接口可能已改版）。
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
