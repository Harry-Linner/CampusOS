import { describe, expect, it, vi } from "vitest";
import {
  classifyError,
  computeBackoffMs,
  createRetryState,
  recordFailure,
  recordSuccess,
  withRetry
} from "./retryPolicy";

describe("retryPolicy", () => {
  describe("classifyError", () => {
    it("classifies timeout as retryable", () => {
      expect(classifyError(new Error("request timeout"))).toBe("retryable");
      expect(classifyError(Object.assign(new Error("timeout"), { name: "AbortError" }))).toBe("retryable");
    });

    it("classifies connection refused as retryable", () => {
      expect(classifyError(new Error("ECONNREFUSED"))).toBe("retryable");
    });

    it("classifies 408 as retryable", () => {
      expect(classifyError({ status: 408 })).toBe("retryable");
    });

    it("classifies 500 as retryable", () => {
      expect(classifyError({ status: 500 })).toBe("retryable");
    });

    it("classifies 429 as retryable", () => {
      expect(classifyError({ status: 429 })).toBe("retryable");
    });

    it("classifies 400 as fatal", () => {
      expect(classifyError({ status: 400 })).toBe("fatal");
    });

    it("classifies arbitrary errors as fatal", () => {
      expect(classifyError(new Error("invalid credentials"))).toBe("fatal");
    });
  });

  describe("computeBackoffMs", () => {
    it("increases with each attempt", () => {
      const a1 = computeBackoffMs(1, { baseDelayMs: 1000, maxDelayMs: 30000 });
      const a2 = computeBackoffMs(2, { baseDelayMs: 1000, maxDelayMs: 30000 });
      const a3 = computeBackoffMs(3, { baseDelayMs: 1000, maxDelayMs: 30000 });
      expect(a2).toBeGreaterThanOrEqual(a1);
      expect(a3).toBeGreaterThanOrEqual(a2);
    });

    it("caps at maxDelayMs", () => {
      expect(computeBackoffMs(10, { baseDelayMs: 1000, maxDelayMs: 5000 })).toBeLessThanOrEqual(5000);
    });
  });

  describe("withRetry", () => {
    it("returns result on first success", async () => {
      const op = vi.fn().mockResolvedValue("ok");
      const state = createRetryState();
      const result = await withRetry(op, state, { maxRetries: 3, baseDelayMs: 1 });
      expect(result).toBe("ok");
      expect(op).toHaveBeenCalledTimes(1);
      expect(state.consecutiveFailures).toBe(0);
    });

    it("retries on retryable errors", async () => {
      const op = vi.fn()
        .mockRejectedValueOnce(new Error("timeout"))
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValue("finally ok");
      const state = createRetryState();
      const result = await withRetry(op, state, { maxRetries: 3, baseDelayMs: 1 });
      expect(result).toBe("finally ok");
      expect(op).toHaveBeenCalledTimes(3);
      expect(state.consecutiveFailures).toBe(0);
      expect(state.totalFailures).toBe(2);
    });

    it("does not retry on fatal errors", async () => {
      const op = vi.fn().mockRejectedValue(new Error("invalid credentials"));
      const state = createRetryState();
      await expect(withRetry(op, state, { maxRetries: 3, baseDelayMs: 1 })).rejects.toThrow("invalid credentials");
      expect(op).toHaveBeenCalledTimes(1);
    });

    it("throws after exhausting retries", async () => {
      const op = vi.fn().mockRejectedValue(new Error("timeout"));
      const state = createRetryState();
      await expect(withRetry(op, state, { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow("timeout");
      expect(op).toHaveBeenCalledTimes(2);
      expect(state.consecutiveFailures).toBe(2);
    });
  });

  describe("recordFailure/recordSuccess", () => {
    it("tracks consecutive failures and resets on success", () => {
      const state = createRetryState();
      recordFailure(state, new Error("timeout"));
      expect(state.consecutiveFailures).toBe(1);
      expect(state.totalFailures).toBe(1);
      recordFailure(state, new Error("timeout"));
      expect(state.consecutiveFailures).toBe(2);
      recordSuccess(state);
      expect(state.consecutiveFailures).toBe(0);
      expect(state.totalFailures).toBe(2);
    });
  });
});
