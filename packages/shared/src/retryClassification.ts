/**
 * 网络错误的可重试分类：供主进程 retryPolicy 与各连接器共用，
 * 保证"连接器健康台账"里的失败分类与重试策略语义完全一致。
 */
export type RetryClassification = "retryable" | "fatal";

const isRetryableHttpStatus = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { status?: number }).status;
  if (typeof status !== "number") return false;
  return status === 408 || status === 429 || status >= 500;
};

export const classifyRetryError = (error: unknown): RetryClassification => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("timeout") || message.includes("abort")) return "retryable";
    if (message.includes("econnrefused") || message.includes("enotfound")) return "retryable";
    if (message.includes("econnreset") || message.includes("socket hang")) return "retryable";
    if (error.name === "AbortError") return "retryable";
  }
  if (isRetryableHttpStatus(error)) return "retryable";
  return "fatal";
};
