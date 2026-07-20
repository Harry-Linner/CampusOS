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
}

export type RefreshJob = () => Promise<RefreshSourceResult>;

export interface RefreshJobOptions {
  after?: readonly string[];
}

export interface RefreshCoordinator {
  register: (
    sourceId: string,
    job: RefreshJob,
    options?: RefreshJobOptions
  ) => () => void;
  runAll: () => Promise<RefreshSourceResult[]>;
}

export const createRefreshCoordinator = ({
  recordResult
}: {
  recordResult?: (
    result: RefreshSourceResult,
    durationMs: number
  ) => Promise<void> | void;
} = {}): RefreshCoordinator => {
  const jobs = new Map<
    string,
    { job: RefreshJob; after: readonly string[] }
  >();
  const pending = new Map<string, Promise<RefreshSourceResult>>();

  const runJob = (
    sourceId: string,
    job: RefreshJob
  ): Promise<RefreshSourceResult> => {
    const current = pending.get(sourceId);
    if (current) return current;

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
        try {
          await recordResult?.(result, performance.now() - startedAt);
        } catch {
          // Diagnostics are best-effort and must never turn a completed refresh into a failure.
        }
        return result;
      })
      .finally(() => {
        if (pending.get(sourceId) === operation) {
          pending.delete(sourceId);
        }
      });

    pending.set(sourceId, operation);
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
        }
      };
    },
    runAll: async () => {
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
          ready.map(([sourceId, entry]) => runJob(sourceId, entry.job))
        );
        for (let index = 0; index < ready.length; index += 1) {
          const sourceId = ready[index][0];
          results.push(wave[index]);
          completed.add(sourceId);
          remaining.delete(sourceId);
        }
      }

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
      message: result.message
    });
  }
});
import { appendDiagnosticEntry } from "./diagnosticLogStore";
