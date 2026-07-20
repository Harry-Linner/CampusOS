/**
 * Retry classification and backoff policy for network-bound connector operations.
 *
 * Connectors should wrap their HTTP calls with this to get:
 * - Automatic retry for transient errors (timeouts, 5xx, 429)
 * - Exponential backoff with jitter
 * - No retry for fatal errors (4xx except 429, DNS failures after N attempts)
 * - Consecutive failure tracking for diagnostic purposes
 */

export type RetryClassification = "retryable" | "fatal";

export interface RetryState {
  consecutiveFailures: number;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
  totalAttempts: number;
  totalFailures: number;
}

export interface RetryPolicyOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;

export const classifyError = (error: unknown): RetryClassification => {
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

const isRetryableHttpStatus = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { status?: number }).status;
  if (typeof status !== "number") return false;
  return status === 408 || status === 429 || status >= 500;
};

export const computeBackoffMs = (
  attempt: number,
  options: RetryPolicyOptions = {}
): number => {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  if (attempt < 1 || attempt > maxRetries) return maxDelayMs;

  // Exponential backoff: baseDelay * 2^(attempt-1)
  const exponential = baseDelayMs * Math.pow(2, attempt - 1);
  // Add random jitter of ±25%
  const jitter = exponential * (0.75 + Math.random() * 0.5);
  return Math.min(jitter, maxDelayMs);
};

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const createRetryState = (): RetryState => ({
  consecutiveFailures: 0,
  lastFailureAt: null,
  lastFailureMessage: null,
  totalAttempts: 0,
  totalFailures: 0
});

export const recordSuccess = (state: RetryState): void => {
  state.consecutiveFailures = 0;
  state.totalAttempts += 1;
};

export const recordFailure = (state: RetryState, error: unknown): void => {
  state.consecutiveFailures += 1;
  state.totalAttempts += 1;
  state.totalFailures += 1;
  state.lastFailureAt = new Date().toISOString();
  state.lastFailureMessage =
    error instanceof Error ? error.message.slice(0, 300) : "未知错误";
};

export const withRetry = async <T>(
  operation: () => Promise<T>,
  state: RetryState,
  options?: RetryPolicyOptions
): Promise<T> => {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const result = await operation();
      recordSuccess(state);
      return result;
    } catch (error) {
      lastError = error;
      recordFailure(state, error);

      const classification = classifyError(error);
      if (classification === "fatal") {
        throw error;
      }

      if (attempt < maxRetries) {
        const backoffMs = computeBackoffMs(attempt, options);
        await delay(backoffMs);
      }
    }
  }

  throw lastError;
};
