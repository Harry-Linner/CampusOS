export type RefreshSourceStatus =
  | "live"
  | "cache"
  | "fallback"
  | "unavailable";

export interface RefreshSourceResult {
  sourceId: string;
  status: RefreshSourceStatus;
  updatedAt: string;
  message?: string;
  /** 请求版本指纹（URL/方法/表单结构的归一化摘要，脱敏），用于上游变化检测。 */
  requestFingerprint?: string | null;
  /** 失败分类：与 retryPolicy.classifyError 语义一致；成功可省略。 */
  retryClassification?: "retryable" | "fatal" | null;
}

export type RefreshJob = () => Promise<RefreshSourceResult>;

export interface RefreshJobOptions {
  after?: readonly string[];
}

export interface RefreshRunOptions {
  background?: boolean;
  /** Opaque identity of the currently verified account. Never persisted or logged. */
  scopeKey?: string;
}

const backgroundInterval = (sourceId: string): number => {
  // Academic sources use a 15-minute background refresh threshold.
  if (sourceId === "org.campusos.zju-undergraduate" || sourceId === "org.campusos.zju-graduate") return 15 * 60_000;
  if (sourceId === "org.campusos.zju-calendar-config") return 6 * 60 * 60_000;
  if (sourceId === "org.campusos.zju-learning") return 60_000;
  // Derived capabilities still publish in dependency order on every workspace refresh.
  return 0;
};

export interface RefreshCoordinator {
  register: (
    sourceId: string,
    job: RefreshJob,
    options?: RefreshJobOptions
  ) => () => void;
  runAll: (options?: RefreshRunOptions) => Promise<RefreshSourceResult[]>;
  /** 单独运行一个已注册的刷新源（连接器健康"手动验证探针"用）。 */
  runOne: (sourceId: string) => Promise<RefreshSourceResult | null>;
}

export const createRefreshCoordinator = ({
  recordResult,
  now = Date.now
}: {
  now?: () => number;
  recordResult?: (
    result: RefreshSourceResult,
    durationMs: number
  ) => Promise<void> | void;
} = {}): RefreshCoordinator => {
  const jobs = new Map<
    string,
    { job: RefreshJob; after: readonly string[] }
  >();
  const pending = new Map<string, { generation: number; job: RefreshJob; operation: Promise<RefreshSourceResult> }>();
  const recent = new Map<string, { result: RefreshSourceResult; failures: number; nextAt: number }>();
  let scopeKey: string | undefined;
  let generation = 0;

  const runJob = (
    sourceId: string,
    job: RefreshJob,
    runGeneration = generation,
    background = false
  ): Promise<RefreshSourceResult> => {
    const current = pending.get(sourceId);
    if (current) {
      if (current.generation === runGeneration && current.job === job) return current.operation;
      return current.operation.then(() => runJob(sourceId, job, runGeneration, background));
    }
    if (runGeneration !== generation) return Promise.reject(new Error("账号已改变，本次同步已取消。"));
    const last = recent.get(sourceId);
    if (background && last && now() < last.nextAt) return Promise.resolve(last.result);

    const startedAt = performance.now();
    const operation = job()
      .then((result) => {
        if (result.sourceId !== sourceId) {
          throw new Error(`Refresh source mismatch: ${sourceId}`);
        }
        return result;
      })
      .catch((error: unknown) => ({
        sourceId,
        status: "unavailable" as const,
        updatedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : "刷新失败"
      }))
      .then(async (result) => {
        if (runGeneration === generation && jobs.get(sourceId)?.job === job) {
          const failed = result.status !== "live";
          const failures = failed ? (last?.failures ?? 0) + 1 : 0;
          const interval = backgroundInterval(sourceId);
          // Only network-backed connectors are throttled; in-memory projections remain immediate.
          const delay = interval === 0 ? 0 : failed
            ? Math.min(30 * 60_000, 60_000 * 2 ** Math.min(failures - 1, 5))
            : interval;
          recent.set(sourceId, { result, failures, nextAt: now() + delay });
        }
        try {
          await recordResult?.(result, performance.now() - startedAt);
        } catch {
          // Diagnostics are best-effort and must never turn a completed refresh into a failure.
        }
        return result;
      })
      .finally(() => {
        if (pending.get(sourceId)?.operation === operation) {
          pending.delete(sourceId);
        }
      });

    pending.set(sourceId, { generation: runGeneration, job, operation });
    return operation;
  };

  return {
    register: (sourceId, job, options = {}) => {
      if (jobs.has(sourceId)) {
        throw new Error(`Refresh source already registered: ${sourceId}`);
      }
      const after = [...new Set(options.after ?? [])];
      if (after.includes(sourceId)) {
        throw new Error(`Refresh source cannot depend on itself: ${sourceId}`);
      }
      const registration = { job, after };
      jobs.set(sourceId, registration);

      return () => {
        if (jobs.get(sourceId) === registration) {
          jobs.delete(sourceId);
          recent.delete(sourceId);
        }
      };
    },
    runOne: async (sourceId) => {
      const registration = jobs.get(sourceId);
      if (!registration) return null;
      return runJob(sourceId, registration.job);
    },
    runAll: async (options = {}) => {
      if (options.scopeKey !== undefined && options.scopeKey !== scopeKey) {
        scopeKey = options.scopeKey;
        generation += 1;
        recent.clear();
      }
      const runGeneration = generation;
      const snapshot = new Map(jobs);
      const remaining = new Map(snapshot);
      const completed = new Set<string>();
      const results: RefreshSourceResult[] = [];
      const recordSyntheticResult = async (
        sourceId: string,
        message: string
      ): Promise<void> => {
        const result: RefreshSourceResult = {
          sourceId,
          status: "unavailable",
          updatedAt: new Date().toISOString(),
          message
        };
        try {
          await recordResult?.(result, 0);
        } catch {
          // Keep dependency failures observable without making diagnostics fatal.
        }
        results.push(result);
        completed.add(sourceId);
        remaining.delete(sourceId);
      };

      while (remaining.size > 0) {
        if (runGeneration !== generation) throw new Error("账号已改变，本次同步已取消。");
        const missingDependencies = [...remaining].filter(([, entry]) =>
          entry.after.some((dependency) => !snapshot.has(dependency))
        );
        if (missingDependencies.length > 0) {
          await Promise.all(
            missingDependencies.map(([sourceId, entry]) =>
              recordSyntheticResult(
                sourceId,
                `刷新依赖未注册：${entry.after.filter((dependency) => !snapshot.has(dependency)).join("、")}`
              )
            )
          );
          continue;
        }

        const ready = [...remaining].filter(([, entry]) =>
          entry.after.every((dependency) => completed.has(dependency))
        );
        if (ready.length === 0) {
          await Promise.all(
            [...remaining.keys()].map((sourceId) =>
              recordSyntheticResult(sourceId, "刷新依赖存在循环。")
            )
          );
          break;
        }

        const wave = await Promise.all(
          ready.map(([sourceId, entry]) => runJob(sourceId, entry.job, runGeneration, options.background === true))
        );
        for (let index = 0; index < ready.length; index += 1) {
          const sourceId = ready[index][0];
          results.push(wave[index]);
          completed.add(sourceId);
          remaining.delete(sourceId);
        }
      }

      if (runGeneration !== generation) throw new Error("账号已改变，本次同步已取消。");
      return results;
    }
  };
};

export const pluginRefreshCoordinator = createRefreshCoordinator({
  recordResult: async (result, durationMs) => {
    await appendDiagnosticEntry({
      module: result.sourceId,
      operation: "refresh",
      state: result.status,
      durationMs,
      message: result.message,
      requestFingerprint: result.requestFingerprint ?? null,
      retryClassification: result.retryClassification ?? null
    });
  }
});
import { appendDiagnosticEntry } from "./diagnosticLogStore";
