import { app, dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  DiagnosticDataState,
  DiagnosticEntry,
  DiagnosticErrorCategory,
  DiagnosticSnapshot,
  HealthViewSnapshot,
  SourceHealthSummary
} from "../shared/diagnosticBridge";
import { assertTrustedRenderer } from "./ipcSecurity";
import { sanitizeDiagnosticText } from "./diagnosticSanitizer";
import type { RefreshSourceResult } from "./refreshCoordinator";

const DATA_VERSION = 2;
const MAX_ENTRIES = 2_000;
const UI_ENTRY_LIMIT = 200;
const HEALTH_TREND_LIMIT = 20;

interface StoredDiagnosticPayload {
  dataVersion: number;
  entries: DiagnosticEntry[];
}

export interface DiagnosticAppendInput {
  module: string;
  operation: string;
  state: DiagnosticDataState;
  durationMs: number;
  message?: string;
  requestFingerprint?: string | null;
  retryClassification?: "retryable" | "fatal" | null;
}

const getStoragePath = (): string =>
  join(app.getPath("userData"), "diagnostics", "refresh-log.json");

const classifyError = (
  state: DiagnosticDataState,
  message: string | null
): DiagnosticErrorCategory | null => {
  if (state !== "unavailable" || !message) return null;
  const normalized = message.toLowerCase();
  if (/认证|登录|login|session|ticket|credential/.test(normalized)) {
    return "authentication";
  }
  if (/超时|timeout|abort/.test(normalized)) return "timeout";
  if (/网络|network|fetch|econn|dns/.test(normalized)) return "network";
  if (/解析|parse|json|html|schema|格式/.test(normalized)) return "parsing";
  return "unknown";
};

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

const normalizeEntry = (entry: DiagnosticEntry): DiagnosticEntry => ({
  id: entry.id,
  timestamp: entry.timestamp,
  module: entry.module,
  operation: entry.operation,
  state: entry.state,
  durationMs: entry.durationMs,
  errorCategory: entry.errorCategory ?? null,
  message: entry.message ?? null,
  requestFingerprint: entry.requestFingerprint ?? null,
  retryClassification: entry.retryClassification ?? null,
  upstreamChange: entry.upstreamChange === true
});

const readPayload = async (): Promise<StoredDiagnosticPayload> => {
  try {
    const payload = JSON.parse(
      await readFile(getStoragePath(), "utf8")
    ) as Partial<StoredDiagnosticPayload> & {
      dataVersion?: number;
      entries?: DiagnosticEntry[];
    };
    const rawEntries = Array.isArray(payload.entries) ? payload.entries : [];
    const entries = rawEntries.map(normalizeEntry);
    // 兼容 v1：新字段缺失时补默认值并升级为 v2。
    if (payload.dataVersion !== DATA_VERSION) {
      const upgraded: StoredDiagnosticPayload = {
        dataVersion: DATA_VERSION,
        entries
      };
      await writePayload(upgraded);
      return upgraded;
    }
    return { dataVersion: DATA_VERSION, entries };
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    return { dataVersion: DATA_VERSION, entries: [] };
  }
};

const writePayload = async (payload: StoredDiagnosticPayload): Promise<void> => {
  const storagePath = getStoragePath();
  const operationId = randomUUID();
  const temporaryPath = `${storagePath}.${operationId}.tmp`;
  const backupPath = `${storagePath}.${operationId}.backup`;
  await mkdir(dirname(storagePath), { recursive: true });
  await writeFile(temporaryPath, JSON.stringify(payload, null, 2), "utf8");
  try {
    await rename(storagePath, backupPath).catch(() => {});
    await rename(temporaryPath, storagePath);
    await rm(backupPath, { force: true }).catch(() => {});
  } catch {
    await rename(temporaryPath, storagePath);
  }
};

const toSnapshot = (
  payload: StoredDiagnosticPayload
): DiagnosticSnapshot => ({
  entries: payload.entries.slice(-UI_ENTRY_LIMIT).reverse(),
  totalCount: payload.entries.length,
  storagePath: getStoragePath()
});

let updateQueue: Promise<void> = Promise.resolve();

export const appendDiagnosticEntry = async (
  input: DiagnosticAppendInput
): Promise<void> => {
  const message = input.message
    ? sanitizeDiagnosticText(input.message)
    : null;
  const fingerprint = input.requestFingerprint
    ? sanitizeDiagnosticText(input.requestFingerprint)
    : null;
  const operation = updateQueue.then(async () => {
    const payload = await readPayload();
    const previous = [...payload.entries]
      .reverse()
      .find(
        (entry) =>
          entry.module === sanitizeDiagnosticText(input.module) &&
          entry.operation === sanitizeDiagnosticText(input.operation)
      );
    const upstreamChange =
      previous !== undefined &&
      previous.requestFingerprint !== null &&
      fingerprint !== null &&
      previous.requestFingerprint !== fingerprint;
    const entry: DiagnosticEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      module: sanitizeDiagnosticText(input.module),
      operation: sanitizeDiagnosticText(input.operation),
      state: input.state,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      errorCategory: classifyError(input.state, message),
      message,
      requestFingerprint: fingerprint,
      retryClassification: input.retryClassification ?? null,
      upstreamChange
    };
    payload.entries = [...payload.entries, entry].slice(-MAX_ENTRIES);
    await writePayload(payload);
  });
  updateQueue = operation.then(
    () => undefined,
    () => undefined
  );
  await operation;
};

export const loadDiagnosticSnapshot = async (): Promise<DiagnosticSnapshot> => {
  await updateQueue;
  return toSnapshot(await readPayload());
};

export const clearDiagnosticEntries = async (): Promise<DiagnosticSnapshot> => {
  const operation = updateQueue.then(async () => {
    await writePayload({ dataVersion: DATA_VERSION, entries: [] });
  });
  updateQueue = operation.then(
    () => undefined,
    () => undefined
  );
  await operation;
  return loadDiagnosticSnapshot();
};

const formatExport = (entries: DiagnosticEntry[]): string =>
  entries
    .map((entry) =>
      [
        sanitizeDiagnosticText(entry.timestamp),
        sanitizeDiagnosticText(entry.module),
        sanitizeDiagnosticText(entry.operation),
        entry.state,
        `${entry.durationMs}ms`,
        entry.errorCategory ?? "-",
        entry.retryClassification ?? "-",
        entry.upstreamChange ? "changed" : "-",
        entry.requestFingerprint
          ? sanitizeDiagnosticText(entry.requestFingerprint)
          : "-",
        entry.message ? sanitizeDiagnosticText(entry.message) : "-"
      ].join("\t")
    )
    .join("\n");

const exportDiagnostics = async () => {
  await updateQueue;
  const payload = await readPayload();
  const result = await dialog.showSaveDialog({
    title: "导出 CampusOS 诊断日志",
    defaultPath: `campusos-diagnostics-${new Date().toISOString().slice(0, 10)}.txt`,
    filters: [{ name: "Text", extensions: ["txt"] }]
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true, path: null };
  }
  await writeFile(result.filePath, formatExport(payload.entries), "utf8");
  return { canceled: false, path: result.filePath };
};

export type SourceFailureSummary = Record<string, {
  module: string;
  totalRuns: number;
  liveRuns: number;
  cacheRuns: number;
  unavailableRuns: number;
  retryableFailures: number;
  fatalFailures: number;
  upstreamChangeCount: number;
  lastStatus: DiagnosticDataState;
  lastRunAt: string | null;
  lastMessage: string | null;
  lastFingerprint: string | null;
}>;

export const buildSourceFailureSummary = (
  entries: readonly DiagnosticEntry[]
): SourceFailureSummary => {
  const summary: SourceFailureSummary = {};
  for (const entry of entries) {
    const existing = summary[entry.module] ?? {
      module: entry.module,
      totalRuns: 0,
      liveRuns: 0,
      cacheRuns: 0,
      unavailableRuns: 0,
      retryableFailures: 0,
      fatalFailures: 0,
      upstreamChangeCount: 0,
      lastStatus: "live" as DiagnosticDataState,
      lastRunAt: null,
      lastMessage: null,
      lastFingerprint: null
    };
    existing.totalRuns += 1;
    if (entry.state === "live") existing.liveRuns += 1;
    else if (entry.state === "cache" || entry.state === "fallback") existing.cacheRuns += 1;
    else existing.unavailableRuns += 1;
    if (entry.retryClassification === "retryable") existing.retryableFailures += 1;
    else if (entry.retryClassification === "fatal") existing.fatalFailures += 1;
    if (entry.upstreamChange) existing.upstreamChangeCount += 1;
    existing.lastStatus = entry.state;
    existing.lastRunAt = entry.timestamp;
    existing.lastMessage = entry.message;
    if (entry.requestFingerprint) existing.lastFingerprint = entry.requestFingerprint;
    summary[entry.module] = existing;
  }
  return summary;
};

const buildSourceHealth = (
  module: string,
  entries: readonly DiagnosticEntry[]
): SourceHealthSummary => {
  const recentEntries = entries
    .filter((entry) => entry.module === module)
    .slice(-HEALTH_TREND_LIMIT);
  const summary = buildSourceFailureSummary(recentEntries)[module];
  const latest = recentEntries[recentEntries.length - 1];
  return {
    module,
    currentState: summary?.lastStatus ?? "unavailable",
    lastRunAt: summary?.lastRunAt ?? null,
    recentEntries,
    liveRuns: summary?.liveRuns ?? 0,
    cachedRuns: summary?.cacheRuns ?? 0,
    unavailableRuns: summary?.unavailableRuns ?? 0,
    retryableFailures: summary?.retryableFailures ?? 0,
    fatalFailures: summary?.fatalFailures ?? 0,
    upstreamChangeCount: summary?.upstreamChangeCount ?? 0,
    lastFingerprint: summary?.lastFingerprint ?? null,
    lastMessage: latest?.message ?? summary?.lastMessage ?? null
  };
};

export const buildHealthViewSnapshot = async (): Promise<HealthViewSnapshot> => {
  await updateQueue;
  const payload = await readPayload();
  const modules = [...new Set(payload.entries.map((entry) => entry.module))];
  return {
    sources: modules
      .map((module) => buildSourceHealth(module, payload.entries))
      .sort((left, right) => left.module.localeCompare(right.module)),
    totalRuns: payload.entries.length
  };
};

export type ProbeSource = (sourceId: string) => Promise<RefreshSourceResult | null>;

export const registerDiagnosticHandlers = (
  options: { probeSource?: ProbeSource } = {}
): void => {
  ipcMain.handle("campusos:diagnostics:load", async (event) => {
    assertTrustedRenderer(event);
    return loadDiagnosticSnapshot();
  });
  ipcMain.handle("campusos:diagnostics:clear", async (event) => {
    assertTrustedRenderer(event);
    return clearDiagnosticEntries();
  });
  ipcMain.handle("campusos:diagnostics:export", async (event) => {
    assertTrustedRenderer(event);
    return exportDiagnostics();
  });
  ipcMain.handle("campusos:diagnostics:health", async (event) => {
    assertTrustedRenderer(event);
    return buildHealthViewSnapshot();
  });
  ipcMain.handle("campusos:diagnostics:probe", async (event, sourceId: string) => {
    assertTrustedRenderer(event);
    if (typeof sourceId !== "string" || sourceId.length === 0) {
      throw new Error("连接器验证需要有效的来源标识。");
    }
    if (!options.probeSource) {
      throw new Error("连接器验证探针暂不可用。");
    }
    const result = await options.probeSource(sourceId);
    const snapshot = await buildHealthViewSnapshot();
    const summary = snapshot.sources.find((source) => source.module === sourceId);
    if (!summary) {
      throw new Error(`连接器 ${sourceId} 尚未产生任何刷新记录。`);
    }
    return {
      ok: result !== null && result.status !== "unavailable",
      summary,
      message: result?.message
    };
  });
};
