const DEFAULT_MIN_REFRESH_INTERVAL_MS = 60 * 1000;
const DEFAULT_MAX_REFRESH_INTERVAL_MS = 120 * 1000;

export interface WorkspaceRefreshScheduler {
  start: () => void;
  stop: () => void;
}

export const createWorkspaceRefreshScheduler = ({
  refresh,
  intervalMs,
  minIntervalMs = DEFAULT_MIN_REFRESH_INTERVAL_MS,
  maxIntervalMs = DEFAULT_MAX_REFRESH_INTERVAL_MS,
  randomFn = Math.random,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
}: {
  refresh: () => Promise<unknown>;
  intervalMs?: number;
  minIntervalMs?: number;
  maxIntervalMs?: number;
  randomFn?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}): WorkspaceRefreshScheduler => {
  let timer: NodeJS.Timeout | null = null;
  let pending: Promise<unknown> | null = null;
  let started = false;

  const nextDelay = (): number => {
    if (intervalMs !== undefined) return intervalMs;
    const lower = Math.max(0, Math.ceil(minIntervalMs));
    const upper = Math.max(lower, Math.ceil(maxIntervalMs));
    return lower + Math.floor(randomFn() * (upper - lower + 1));
  };

  const scheduleNext = (): void => {
    if (!started || timer) return;
    timer = setTimeoutFn(() => {
      timer = null;
      void run().catch(() => undefined);
    }, nextDelay());
  };

  const run = (): Promise<unknown> => {
    if (pending) return pending;
    pending = refresh().finally(() => {
      pending = null;
      scheduleNext();
    });
    return pending;
  };

  return {
    start: () => {
      if (started) return;
      started = true;
      void run().catch(() => undefined);
    },
    stop: () => {
      started = false;
      if (!timer) return;
      clearTimeoutFn(timer);
      timer = null;
    }
  };
};
